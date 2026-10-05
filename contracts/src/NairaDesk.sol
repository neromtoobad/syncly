// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {IERC20} from "./SynclyVault.sol";
import {JobEscrow} from "./JobEscrow.sol";

/// @title NairaDesk: a USDC float on Arc that pays Syncly's own escrow for customers who paid in naira.
/// @notice A customer without a wallet pays a job's naira price through a local payment processor (Bachs).
/// Once that payment is confirmed off-chain, the CFO's key may fund that job's escrow from this float: only a
/// job whose escrow customer is this desk, only once per naira payment, and under a per-payment and a daily
/// cap. The desk is the escrow's customer, so the CFO's key can also relay that customer's accept, revision
/// or reject; a refund and the bond come back here, and the naira is refunded off-chain. The float can go
/// nowhere but into JobEscrow, and only the owner (the Boss's wallet) can withdraw it or change the caps.
contract NairaDesk {
    IERC20 public immutable usdc;
    JobEscrow public immutable escrow;
    address public owner; // the Boss: withdraws, sets caps, rotates the agent key
    address public agent; // Syncly's CFO key: funds jobs and relays the customer's decision
    uint96 public perPayCap; // the most for one job
    uint96 public dayCap; // the most per rolling day
    uint96 public spentToday;
    uint64 public dayStart;

    mapping(bytes32 => bytes32) public jobFor; // naira payment ref (hash of the processor's checkout id) → job
    mapping(bytes32 => bytes32) public refFor; // job → naira payment ref

    event Funded(bytes32 indexed job, bytes32 indexed ref, uint256 amount, uint256 spentToday);
    event Decided(bytes32 indexed job, uint8 decision); // 1 accept, 2 revision, 3 reject
    event Withdrawn(address indexed to, uint256 amount);
    event CapsSet(uint256 perPayCap, uint256 dayCap);
    event AgentSet(address agent);
    event OwnerSet(address owner);

    error NotAgent();
    error NotOwner();
    error AlreadyPaid();
    error NotOurJob();
    error NotOpen();
    error OverPerPayCap();
    error OverDayCap();
    error UnknownJob();

    modifier onlyAgent() {
        if (msg.sender != agent) revert NotAgent();
        _;
    }

    modifier onlyOwner() {
        if (msg.sender != owner) revert NotOwner();
        _;
    }

    constructor(IERC20 usdc_, JobEscrow escrow_, address agent_, address owner_, uint96 perPayCap_, uint96 dayCap_) {
        usdc = usdc_;
        escrow = escrow_;
        agent = agent_;
        owner = owner_;
        perPayCap = perPayCap_;
        dayCap = dayCap_;
        dayStart = uint64(block.timestamp);
        emit CapsSet(perPayCap_, dayCap_);
    }

    /// Fund `job`'s escrow for the naira payment `ref`. The job must be open, for this desk as its customer;
    /// the escrow pulls exactly its price. A ref pays once, and a job is paid once.
    function fund(bytes32 job, bytes32 ref) external onlyAgent {
        if (ref == bytes32(0) || jobFor[ref] != bytes32(0) || refFor[job] != bytes32(0)) revert AlreadyPaid();
        (address customer, uint96 amount,,,,,, JobEscrow.State state,,) = escrow.jobs(job);
        if (customer != address(this)) revert NotOurJob();
        if (state != JobEscrow.State.Open) revert NotOpen();
        if (amount > perPayCap) revert OverPerPayCap();
        if (block.timestamp >= dayStart + 1 days) {
            dayStart = uint64(block.timestamp);
            spentToday = 0;
        }
        if (spentToday + amount > dayCap) revert OverDayCap();
        spentToday += amount;
        jobFor[ref] = job;
        refFor[job] = ref;
        require(usdc.approve(address(escrow), amount), "approve");
        escrow.fund(job);
        emit Funded(job, ref, amount, spentToday);
    }

    /// The customer's decision on a delivered job, relayed by the CFO's key (the customer has no wallet).
    function accept(bytes32 job) external onlyAgent {
        if (refFor[job] == bytes32(0)) revert UnknownJob();
        escrow.accept(job);
        emit Decided(job, 1);
    }

    function requestRevision(bytes32 job) external onlyAgent {
        if (refFor[job] == bytes32(0)) revert UnknownJob();
        escrow.requestRevision(job);
        emit Decided(job, 2);
    }

    /// The refund and the bond come back to this desk; the customer's naira is refunded off-chain.
    function reject(bytes32 job) external onlyAgent {
        if (refFor[job] == bytes32(0)) revert UnknownJob();
        escrow.reject(job);
        emit Decided(job, 3);
    }

    function withdraw(address to, uint256 amount) external onlyOwner {
        require(usdc.transfer(to, amount), "transfer");
        emit Withdrawn(to, amount);
    }

    function setCaps(uint96 perPayCap_, uint96 dayCap_) external onlyOwner {
        perPayCap = perPayCap_;
        dayCap = dayCap_;
        emit CapsSet(perPayCap_, dayCap_);
    }

    function setAgent(address agent_) external onlyOwner {
        agent = agent_;
        emit AgentSet(agent_);
    }

    function setOwner(address owner_) external onlyOwner {
        owner = owner_;
        emit OwnerSet(owner_);
    }
}
