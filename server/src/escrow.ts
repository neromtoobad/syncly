// JobEscrow on Arc: the chain side of a paid job. The CFO opens a job for the customer's wallet, the
// customer funds it from that wallet, the CFO submits a hash of the delivery, and only the customer can
// accept, ask for a revision or reject. orders.ts mirrors what the chain says; it never decides for them.
//
// Escrow is on when deployments/<net>.json exists. net = OUTLAY_ESCROW_NET, which defaults to 'arc' in
// live mode and to nothing in demo mode ('local' runs it against anvil; see scripts/escrow-local.ts).
import { existsSync, readFileSync } from 'node:fs';
import { createPublicClient, createWalletClient, http, keccak256, toBytes, parseAbi, parseGwei, type Abi, type Address, type Chain, type Hex } from 'viem';
import { CHAIN_CONFIGS } from '@circle-fin/x402-batching/client';
import { ARC, DRY } from './config.ts';
import { account } from './wallets.ts';

const NET = process.env.OUTLAY_ESCROW_NET ?? (DRY ? '' : 'arc');

type Deployment = { network: string; chainId: number; rpc?: string; escrow: Address; vault: Address; usdc: Address; gatewayWallet: Address; boss: Address };
function load(): Deployment | null {
  if (!NET) return null;
  const f = new URL(`../../deployments/${NET}.json`, import.meta.url).pathname;
  return existsSync(f) ? JSON.parse(readFileSync(f, 'utf8')) : null;
}
export const DEP = load();

export const RPC = NET === 'arc' ? ARC.rpc : DEP?.rpc ?? 'http://127.0.0.1:8545';
const EXPLORER = NET === 'arc' ? ARC.explorer : null;
export const chain: Chain = NET === 'arc'
  ? CHAIN_CONFIGS.arc.chain
  : { id: DEP?.chainId ?? 31337, name: `Arc (${NET})`, nativeCurrency: { name: 'USDC', symbol: 'USDC', decimals: 18 }, rpcUrls: { default: { http: [RPC] } } };
// Arc silently drops transactions priced under 20 gwei, so set a floor (the base fee is ~20 gwei).
export const FEES = NET === 'arc' ? { maxFeePerGas: parseGwei('60'), maxPriorityFeePerGas: parseGwei('1') } : {};

export const ESCROW_ABI = parseAbi([
  'function open(bytes32 id, address customer, uint96 amount, uint96 bond, bytes32 specHash, uint64 fundBy, uint64 deliverBy)',
  'function submit(bytes32 id, bytes32 deliverableHash)',
  'function autoRelease(bytes32 id)',
  'function refundLate(bytes32 id)',
  'function cancelUnfunded(bytes32 id)',
  'function jobs(bytes32) view returns (address customer, uint96 amount, uint96 bond, uint64 fundBy, uint64 deliverBy, uint64 acceptBy, bool revised, uint8 state, bytes32 specHash, bytes32 deliverableHash)',
  'event JobFunded(bytes32 indexed id, address indexed payer, uint256 amount)',
  'event RevisionRequested(bytes32 indexed id, uint64 deliverBy)',
  'event JobAccepted(bytes32 indexed id, bool auto_)',
  'event JobRejected(bytes32 indexed id, uint256 refund, uint256 bond)',
]);
export const VAULT_ABI = parseAbi([
  'function bucket(uint256) view returns (uint256)',
  'function balances() view returns (uint256[5])',
  'function bondsOutstanding() view returns (uint256)',
  'function reserveFloor() view returns (uint256)',
]);

export const STATES = ['None', 'Open', 'Funded', 'Submitted', 'Accepted', 'Rejected', 'Refunded', 'Cancelled'] as const;
export type EscrowState = (typeof STATES)[number];

/** What the browser needs to pay into the escrow and decide from the customer's wallet. */
export function escrowConfig() {
  if (!DEP) return { enabled: false as const };
  return { enabled: true as const, network: NET, chainId: chain.id, chainName: NET === 'arc' ? 'Arc' : chain.name, rpc: RPC, explorer: EXPLORER, escrow: DEP.escrow, vault: DEP.vault, usdc: DEP.usdc };
}

export const jobKey = (orderId: string): Hex => keccak256(toBytes(orderId));
export const hashText = (s: string): Hex => keccak256(toBytes(s));
const units = (usd: number) => BigInt(Math.round(usd * 1e6));

export const pub = createPublicClient({ chain, transport: http(RPC) });
let cfoWallet: ReturnType<typeof createWalletClient> | undefined;
const wallet = () => (cfoWallet ??= createWalletClient({ chain, transport: http(RPC), account: account('cfo') }));

// Every transaction the CFO key sends (escrow and vault) goes through one queue, so nonces never collide.
let queue: Promise<unknown> = Promise.resolve();
export function cfoWrite(address: Address, abi: Abi, functionName: string, args: readonly unknown[]) {
  const p = queue.then(async () => {
    const hash = await wallet().writeContract({ address, abi, functionName, args, chain, account: wallet().account!, ...FEES } as any);
    const r = await pub.waitForTransactionReceipt({ hash });
    if (r.status !== 'success') throw new Error(`${functionName} reverted (${hash})`);
    return { hash, block: r.blockNumber };
  });
  queue = p.catch(() => {});
  return p;
}
const send = (functionName: 'open' | 'submit' | 'autoRelease' | 'refundLate' | 'cancelUnfunded', args: readonly unknown[]) => cfoWrite(DEP!.escrow, ESCROW_ABI, functionName, args);
export const cfoAddress = () => wallet().account!.address;
/** Arc gas is paid in USDC: give a wallet a few cents so it can send its own transaction (a Gateway withdrawal's mint). */
export async function cfoSendGas(to: Address, minUsd = 0.01, topTo = 0.03): Promise<Hex | null> {
  const have = Number(await pub.getBalance({ address: to })) / 1e18;
  if (have >= minUsd) return null;
  const w = wallet();
  const hash: Hex = await (w as any).sendTransaction({ to, value: BigInt(Math.round((topTo - have) * 1e6)) * 10n ** 12n, chain, account: w.account!, ...FEES });
  await pub.waitForTransactionReceipt({ hash });
  return hash;
}

export const openJob = (id: Hex, customer: Address, priceUsd: number, bondUsd: number, specHash: Hex, fundBy: number, deliverBy: number) =>
  send('open', [id, customer, units(priceUsd), units(bondUsd), specHash, BigInt(fundBy), BigInt(deliverBy)]);
export const submitJob = (id: Hex, deliverableHash: Hex) => send('submit', [id, deliverableHash]);
export const autoRelease = (id: Hex) => send('autoRelease', [id]);
export const refundLate = (id: Hex) => send('refundLate', [id]);
export const cancelUnfunded = (id: Hex) => send('cancelUnfunded', [id]);

const ERC20 = parseAbi(['function balanceOf(address) view returns (uint256)']);
export const usdcOf = async (who: Address) => Number(await pub.readContract({ address: DEP!.usdc, abi: ERC20, functionName: 'balanceOf', args: [who] })) / 1e6;

/** The chain's clock: the escrow's deadlines are judged by block time, not the server's. */
export const chainNow = async () => Number((await pub.getBlock({ blockTag: 'latest' })).timestamp);

export async function readEscrow(id: Hex) {
  const j = await pub.readContract({ address: DEP!.escrow, abi: ESCROW_ABI, functionName: 'jobs', args: [id] });
  const [customer, , , fundBy, deliverBy, acceptBy, revised, state] = j;
  return { customer, fundBy: Number(fundBy), deliverBy: Number(deliverBy), acceptBy: Number(acceptBy), revised, state: STATES[state] ?? 'None' };
}

/** The transaction that emitted `event` for this job (the customer's fund / accept / reject / revision). */
export async function txOf(event: 'JobFunded' | 'RevisionRequested' | 'JobAccepted' | 'JobRejected', id: Hex, fromBlock: bigint): Promise<Hex | undefined> {
  const logs = await pub.getContractEvents({ address: DEP!.escrow, abi: ESCROW_ABI, eventName: event, args: { id } as any, fromBlock, toBlock: 'latest' });
  return logs.at(-1)?.transactionHash ?? undefined;
}

/** A transaction hash the browser reported, checked on-chain: it must have emitted `event` for this job. */
export async function txEmitted(hash: string, event: 'JobFunded' | 'RevisionRequested' | 'JobAccepted' | 'JobRejected', id: Hex): Promise<boolean> {
  if (!/^0x[0-9a-fA-F]{64}$/.test(hash)) return false;
  try {
    const r = await pub.getTransactionReceipt({ hash: hash as Hex });
    const logs = await pub.getContractEvents({ address: DEP!.escrow, abi: ESCROW_ABI, eventName: event, args: { id } as any, fromBlock: r.blockNumber, toBlock: r.blockNumber });
    return logs.some((l) => l.transactionHash === hash);
  } catch {
    return false;
  }
}

/** Free bond cover in the vault: BOND bucket minus bonds already locked by open escrows. */
let bondFree: number | null = null;
export const bondFreeUsd = () => bondFree;
export async function refreshBondFree(): Promise<number | null> {
  if (!DEP) return null;
  const [b, out] = await Promise.all([
    pub.readContract({ address: DEP.vault, abi: VAULT_ABI, functionName: 'bucket', args: [2n] }),
    pub.readContract({ address: DEP.vault, abi: VAULT_ABI, functionName: 'bondsOutstanding' }),
  ]);
  return (bondFree = Math.max(0, Number(b - out) / 1e6));
}

/** The vault's five buckets, for the public books. */
export async function readVault() {
  if (!DEP) return null;
  const [b, bonds, floor] = await Promise.all([
    pub.readContract({ address: DEP.vault, abi: VAULT_ABI, functionName: 'balances' }),
    pub.readContract({ address: DEP.vault, abi: VAULT_ABI, functionName: 'bondsOutstanding' }),
    pub.readContract({ address: DEP.vault, abi: VAULT_ABI, functionName: 'reserveFloor' }),
  ]);
  const n = (x: bigint) => Number(x) / 1e6;
  return { vault: DEP.vault, escrow: DEP.escrow, explorer: EXPLORER, buckets: { operating: n(b[0]), tools: n(b[1]), bond: n(b[2]), reserve: n(b[3]), promo: n(b[4]) }, bondsOutstanding: n(bonds), reserveFloor: n(floor) };
}
