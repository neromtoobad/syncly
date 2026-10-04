// The customer's wallet (any EIP-1193 browser wallet: MetaMask, Rabby, Coinbase Wallet, OKX…) talking to
// JobEscrow on Arc. The customer funds the escrow and decides on the work from this wallet; the server
// only reads the chain afterwards.
import { createPublicClient, createWalletClient, custom, parseAbi, parseGwei, type Address, type Chain, type EIP1193Provider, type Hex } from 'viem';

export type EscrowCfg = { enabled: true; network: string; chainId: number; chainName: string; rpc: string; explorer: string | null; escrow: Address; vault: Address; usdc: Address };

const ERC20 = parseAbi([
  'function balanceOf(address) view returns (uint256)',
  'function allowance(address owner, address spender) view returns (uint256)',
  'function approve(address spender, uint256 value) returns (bool)',
  'function transfer(address to, uint256 value) returns (bool)',
]);
const ESCROW = parseAbi([
  'function fund(bytes32 id)',
  'function accept(bytes32 id)',
  'function reject(bytes32 id)',
  'function requestRevision(bytes32 id)',
]);

const provider = () => (typeof window === 'undefined' ? undefined : ((window as any).ethereum as EIP1193Provider | undefined));
export const hasWallet = () => !!provider();
export const getProvider = provider;

const chainOf = (c: EscrowCfg): Chain => ({
  id: c.chainId, name: c.chainName,
  nativeCurrency: { name: 'USDC', symbol: 'USDC', decimals: 18 }, // Arc pays gas in USDC
  rpcUrls: { default: { http: [c.rpc] } },
  blockExplorers: c.explorer ? { default: { name: 'Arc explorer', url: c.explorer } } : undefined,
});
// Arc drops transactions priced under 20 gwei; set a floor so no wallet underprices them.
const fees = (c: EscrowCfg) => (c.chainId === 5042 ? { maxFeePerGas: parseGwei('60'), maxPriorityFeePerGas: parseGwei('1') } : {});

/** Plain-English wallet errors. */
export function walletError(e: any): string {
  const m = String(e?.shortMessage ?? e?.message ?? e);
  if (e?.code === 4001 || /reject|denied|cancel/i.test(m)) return 'You cancelled in your wallet. Nothing was paid.';
  if (/insufficient funds/i.test(m)) return 'Not enough USDC on Arc to pay and cover gas (a few cents).';
  return m.split('\n')[0];
}

export async function connect(c: EscrowCfg): Promise<Address> {
  const p = provider();
  if (!p) throw new Error('No wallet found in this browser.');
  const [a] = (await p.request({ method: 'eth_requestAccounts' })) as Address[];
  await ensureChain(c);
  return a;
}

/** Switch the wallet to Arc, adding the network first if the wallet doesn't know it. */
export async function ensureChain(c: EscrowCfg) {
  const p = provider()!;
  const hex = `0x${c.chainId.toString(16)}` as Hex;
  if (parseInt(String(await p.request({ method: 'eth_chainId' })), 16) === c.chainId) return;
  try {
    await p.request({ method: 'wallet_switchEthereumChain', params: [{ chainId: hex }] });
  } catch (e: any) {
    if (e?.code !== 4902 && !/unrecognized|not added|unknown chain/i.test(String(e?.message))) throw e;
    await p.request({
      method: 'wallet_addEthereumChain',
      params: [{ chainId: hex, chainName: c.chainName, nativeCurrency: { name: 'USDC', symbol: 'USDC', decimals: 18 }, rpcUrls: [c.rpc], blockExplorerUrls: c.explorer ? [c.explorer] : undefined }],
    });
  }
}

function clients(c: EscrowCfg, account: Address) {
  const chain = chainOf(c);
  const transport = custom(provider()!);
  return { pub: createPublicClient({ chain, transport }), wallet: createWalletClient({ chain, transport, account }) };
}

export async function usdcBalance(c: EscrowCfg, who: Address): Promise<number> {
  const { pub } = clients(c, who);
  return Number(await pub.readContract({ address: c.usdc, abi: ERC20, functionName: 'balanceOf', args: [who] })) / 1e6;
}

/** Approve (if needed) and fund the job's escrow. Reports each step; returns the fund transaction. */
export async function fundEscrow(c: EscrowCfg, who: Address, id: Hex, priceUsd: number, onStep: (s: 'approve' | 'approving' | 'fund' | 'funding') => void): Promise<Hex> {
  await ensureChain(c);
  const { pub, wallet } = clients(c, who);
  const amount = BigInt(Math.round(priceUsd * 1e6));
  const allowance = await pub.readContract({ address: c.usdc, abi: ERC20, functionName: 'allowance', args: [who, c.escrow] });
  if (allowance < amount) {
    onStep('approve');
    const h = await wallet.writeContract({ address: c.usdc, abi: ERC20, functionName: 'approve', args: [c.escrow, amount], ...fees(c) });
    onStep('approving');
    const r = await pub.waitForTransactionReceipt({ hash: h });
    if (r.status !== 'success') throw new Error('The approval failed on-chain.');
  }
  onStep('fund');
  const hash = await wallet.writeContract({ address: c.escrow, abi: ESCROW, functionName: 'fund', args: [id], ...fees(c) });
  onStep('funding');
  const r = await pub.waitForTransactionReceipt({ hash });
  if (r.status !== 'success') throw new Error('Funding the escrow failed on-chain. Nothing was taken.');
  return hash;
}

const BOOK = parseAbi(['function pay(bytes32 id)']);
/** Pay an invoice on InvoiceBook: approve exactly its amount (if needed), then pay it once. Returns the pay transaction. */
export async function payInvoiceOnChain(c: EscrowCfg, who: Address, book: Address, key: Hex, amountUsd: number, onStep: (s: 'approve' | 'approving' | 'pay' | 'paying') => void): Promise<Hex> {
  await ensureChain(c);
  const { pub, wallet } = clients(c, who);
  const amount = BigInt(Math.round(amountUsd * 1e6));
  const allowance = await pub.readContract({ address: c.usdc, abi: ERC20, functionName: 'allowance', args: [who, book] });
  if (allowance < amount) {
    onStep('approve');
    const h = await wallet.writeContract({ address: c.usdc, abi: ERC20, functionName: 'approve', args: [book, amount], ...fees(c) });
    onStep('approving');
    const r = await pub.waitForTransactionReceipt({ hash: h });
    if (r.status !== 'success') throw new Error('The approval failed on-chain.');
  }
  onStep('pay');
  const hash = await wallet.writeContract({ address: book, abi: BOOK, functionName: 'pay', args: [key], ...fees(c) });
  onStep('paying');
  const r = await pub.waitForTransactionReceipt({ hash });
  if (r.status !== 'success') throw new Error('The payment failed on-chain. Nothing was taken.');
  return hash;
}

const PAYVAULT = parseAbi([
  'function open(bytes32 biz, uint96 perPayCap, uint96 weekCap, address[] payees)',
  'function deposit(bytes32 biz, uint96 amount)',
  'function withdraw(bytes32 biz, uint96 amount, address to)',
  'function setLimits(bytes32 biz, uint96 perPayCap, uint96 weekCap)',
  'function setPayee(bytes32 biz, address payee, bool ok)',
  'function approve(bytes32 biz, bytes32 invoice)',
]);
export type VaultCall = 'open' | 'deposit' | 'withdraw' | 'setLimits' | 'setPayee' | 'approve';
/** The business owner's own wallet acts on its PayVault account: setting rules, adding or taking money, approving. */
export async function vaultWrite(c: EscrowCfg, who: Address, vault: Address, functionName: VaultCall, args: readonly unknown[]): Promise<Hex> {
  await ensureChain(c);
  const { pub, wallet } = clients(c, who);
  const hash = await wallet.writeContract({ address: vault, abi: PAYVAULT, functionName, args, ...fees(c) } as any);
  const r = await pub.waitForTransactionReceipt({ hash });
  if (r.status !== 'success') throw new Error(`${functionName} failed on-chain.`);
  return hash;
}
/** Let `spender` take up to `amountUsd` USDC from this wallet (skipped when it already may). */
export async function approveUsdc(c: EscrowCfg, who: Address, spender: Address, amountUsd: number): Promise<void> {
  await ensureChain(c);
  const { pub, wallet } = clients(c, who);
  const amount = BigInt(Math.round(amountUsd * 1e6));
  const allowance = await pub.readContract({ address: c.usdc, abi: ERC20, functionName: 'allowance', args: [who, spender] });
  if (allowance >= amount) return;
  const h = await wallet.writeContract({ address: c.usdc, abi: ERC20, functionName: 'approve', args: [spender, amount], ...fees(c) });
  const r = await pub.waitForTransactionReceipt({ hash: h });
  if (r.status !== 'success') throw new Error('The approval failed on-chain.');
}

/** The customer's decision, signed by the wallet that paid. */
export async function decideOnChain(c: EscrowCfg, who: Address, id: Hex, action: 'accept' | 'reject' | 'requestRevision'): Promise<Hex> {
  await ensureChain(c);
  const { pub, wallet } = clients(c, who);
  const hash = await wallet.writeContract({ address: c.escrow, abi: ESCROW, functionName: action, args: [id], ...fees(c) });
  const r = await pub.waitForTransactionReceipt({ hash });
  if (r.status !== 'success') throw new Error('The transaction failed on-chain.');
  return hash;
}

export const short = (a: string) => `${a.slice(0, 6)}…${a.slice(-4)}`;
export const txUrl = (c: { explorer: string | null } | null | undefined, hash?: string) => (c?.explorer && hash ? `${c.explorer}/tx/${hash}` : undefined);

const VAULT = parseAbi(['function coSign(uint256 id)']);
/** The Boss approves a CFO proposal from the vault owner's wallet. */
export async function coSignOnChain(c: EscrowCfg, who: Address, id: number): Promise<Hex> {
  await ensureChain(c);
  const { pub, wallet } = clients(c, who);
  const hash = await wallet.writeContract({ address: c.vault, abi: VAULT, functionName: 'coSign', args: [BigInt(id)], ...fees(c) });
  const r = await pub.waitForTransactionReceipt({ hash });
  if (r.status !== 'success') throw new Error('The co-sign failed on-chain.');
  return hash;
}

/** Send USDC to the company's vault. The CFO credits it to OPERATING and puts it to work inside the vault's limits. */
export async function fundVault(c: EscrowCfg, who: Address, amountUsd: number): Promise<Hex> {
  await ensureChain(c);
  const { pub, wallet } = clients(c, who);
  const hash = await wallet.writeContract({ address: c.usdc, abi: ERC20, functionName: 'transfer', args: [c.vault, BigInt(Math.round(amountUsd * 1e6))], ...fees(c) });
  const r = await pub.waitForTransactionReceipt({ hash });
  if (r.status !== 'success') throw new Error('The transfer failed on-chain.');
  return hash;
}
