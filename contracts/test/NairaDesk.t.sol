// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {SynclyVault, IERC20, IGatewayWallet} from "../src/SynclyVault.sol";
import {JobEscrow} from "../src/JobEscrow.sol";
import {NairaDesk} from "../src/NairaDesk.sol";
import {MockUSDC, MockGateway, Vm} from "./Syncly.t.sol";

contract NairaDeskTest {
    Vm constant vm = Vm(address(uint160(uint256(keccak256("hevm cheat code")))));
    uint256 constant U = 1e6;

    MockUSDC usdc;
    SynclyVault vault;
    JobEscrow esc;
    NairaDesk desk;
    address boss = address(0xB055);
    address cfo = address(0xCF0); // the vault's CFO, the escrow's operator and the desk's agent
    address someone = address(0xC0FFEE); // a wallet customer
    address stranger = address(0xBAD);

    function setUp() public {
        usdc = new MockUSDC();
        vault = new SynclyVault(IERC20(address(usdc)), IGatewayWallet(address(new MockGateway(usdc))), boss, cfo);
        esc = new JobEscrow(IERC20(address(usdc)), vault, cfo, boss);
        vm.startPrank(boss);
        vault.setEscrow(address(esc));
        vault.setPolicy({reserveFloor_: 1 * U, maxMove_: 5 * U, epochToolBudget_: 5 * U, promoCap_: 1 * U});
        vm.stopPrank();
        usdc.mint(address(vault), 10 * U);
        vault.sync();
        vm.prank(cfo);
        vault.move(SynclyVault.Bucket.OPERATING, SynclyVault.Bucket.BOND, 3 * U, "bond pool");
        desk = new NairaDesk(IERC20(address(usdc)), esc, cfo, boss, uint96(5 * U), uint96(8 * U));
        usdc.mint(address(desk), 20 * U); // the Boss's float
    }

    function open(bytes32 id, address customer, uint96 price) internal {
        vm.prank(cfo);
        esc.open(id, customer, price, uint96(5e5), keccak256("spec"), uint64(block.timestamp + 2 hours), uint64(block.timestamp + 1 days));
    }

    function state(bytes32 id) internal view returns (JobEscrow.State s) {
        (,,,,,,, s,,) = esc.jobs(id);
    }

    function test_funds_a_naira_job_from_the_float() public {
        open("j1", address(desk), uint96(2 * U));
        vm.prank(cfo);
        desk.fund("j1", keccak256("chk_1"));
        require(state("j1") == JobEscrow.State.Funded, "escrow funded");
        require(usdc.balanceOf(address(desk)) == 18 * U, "price taken from the float");
        require(desk.jobFor(keccak256("chk_1")) == "j1" && desk.refFor("j1") == keccak256("chk_1"), "payment recorded");
        require(desk.spentToday() == 2 * U, "counted against the day");
    }

    function test_a_naira_payment_pays_once() public {
        open("j1", address(desk), uint96(2 * U));
        open("j2", address(desk), uint96(2 * U));
        vm.prank(cfo);
        desk.fund("j1", keccak256("chk_1"));
        vm.expectRevert(NairaDesk.AlreadyPaid.selector);
        vm.prank(cfo);
        desk.fund("j2", keccak256("chk_1")); // the same checkout for another job
        vm.expectRevert(NairaDesk.AlreadyPaid.selector);
        vm.prank(cfo);
        desk.fund("j1", keccak256("chk_2")); // a second checkout for the same job
        vm.expectRevert(NairaDesk.AlreadyPaid.selector);
        vm.prank(cfo);
        desk.fund("j2", bytes32(0));
    }

    function test_only_pays_jobs_whose_customer_is_the_desk() public {
        open("w1", someone, uint96(2 * U));
        vm.expectRevert(NairaDesk.NotOurJob.selector);
        vm.prank(cfo);
        desk.fund("w1", keccak256("chk_1"));
        vm.expectRevert(NairaDesk.NotOurJob.selector);
        vm.prank(cfo);
        desk.fund("never-opened", keccak256("chk_2"));
    }

    function test_caps_per_payment_and_per_day() public {
        open("big", address(desk), uint96(6 * U));
        vm.expectRevert(NairaDesk.OverPerPayCap.selector);
        vm.prank(cfo);
        desk.fund("big", keccak256("chk_big"));
        open("a", address(desk), uint96(5 * U));
        open("b", address(desk), uint96(4 * U));
        vm.prank(cfo);
        desk.fund("a", keccak256("chk_a"));
        vm.expectRevert(NairaDesk.OverDayCap.selector); // 5 + 4 > 8
        vm.prank(cfo);
        desk.fund("b", keccak256("chk_b"));
        vm.warp(block.timestamp + 1 days);
        open("c", address(desk), uint96(4 * U));
        vm.prank(cfo);
        desk.fund("c", keccak256("chk_c")); // a new day
        require(desk.spentToday() == 4 * U, "the day reset");
    }

    function test_only_the_agent_moves_the_float() public {
        open("j1", address(desk), uint96(2 * U));
        vm.expectRevert(NairaDesk.NotAgent.selector);
        vm.prank(stranger);
        desk.fund("j1", keccak256("chk_1"));
        vm.expectRevert(NairaDesk.NotOwner.selector);
        vm.prank(cfo);
        desk.withdraw(cfo, 1 * U); // the CFO can't take the float out
        vm.expectRevert(NairaDesk.NotOwner.selector);
        vm.prank(cfo);
        desk.setCaps(uint96(100 * U), uint96(100 * U));
    }

    function deliver(bytes32 id) internal {
        vm.prank(cfo);
        esc.submit(id, keccak256("work"));
    }

    function test_accept_pays_syncly() public {
        open("j1", address(desk), uint96(2 * U));
        vm.prank(cfo);
        desk.fund("j1", keccak256("chk_1"));
        deliver("j1");
        vm.prank(cfo);
        desk.accept("j1");
        require(state("j1") == JobEscrow.State.Accepted, "accepted");
        require(vault.bucket(uint256(SynclyVault.Bucket.OPERATING)) == 7 * U + 2 * U, "revenue in the vault");
    }

    function test_reject_returns_price_and_bond_to_the_desk() public {
        open("j1", address(desk), uint96(2 * U));
        vm.prank(cfo);
        desk.fund("j1", keccak256("chk_1"));
        deliver("j1");
        vm.prank(cfo);
        desk.reject("j1");
        require(state("j1") == JobEscrow.State.Rejected, "rejected");
        require(usdc.balanceOf(address(desk)) == 20 * U + 5e5, "float back, plus the bond (owed to the customer in naira)");
    }

    function test_revision_is_relayed() public {
        open("j1", address(desk), uint96(2 * U));
        vm.prank(cfo);
        desk.fund("j1", keccak256("chk_1"));
        deliver("j1");
        vm.prank(cfo);
        desk.requestRevision("j1");
        require(state("j1") == JobEscrow.State.Funded, "back to work");
    }

    function test_decisions_only_for_naira_jobs_it_funded() public {
        vm.expectRevert(NairaDesk.UnknownJob.selector);
        vm.prank(cfo);
        desk.reject("j1");
        open("j2", address(desk), uint96(2 * U));
        vm.prank(cfo);
        desk.fund("j2", keccak256("chk_2"));
        deliver("j2");
        vm.expectRevert(NairaDesk.NotAgent.selector);
        vm.prank(stranger);
        desk.reject("j2");
    }

    function test_owner_withdraws_and_sets_caps() public {
        vm.prank(boss);
        desk.withdraw(boss, 5 * U);
        require(usdc.balanceOf(boss) == 5 * U, "withdrawn");
        vm.prank(boss);
        desk.setCaps(uint96(10 * U), uint96(30 * U));
        require(desk.perPayCap() == 10 * U && desk.dayCap() == 30 * U, "caps set");
    }
}
