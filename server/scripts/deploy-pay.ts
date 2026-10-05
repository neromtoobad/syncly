// Deploy Syncly Pay's contracts next to the vault and escrow, and record them in deployments/<network>.json.
// Each is deployed once; running it again deploys only what's missing.
//   node scripts/deploy-pay.ts local     → the anvil rig from scripts/escrow-local.ts
//   node scripts/deploy-pay.ts arc       → Arc mainnet (the treasury key pays a few cents of gas)
// InvoiceBook: owner = the Boss, fees = 0.5% to SynclyVault, booker = the CFO key.
// PayVault (autopay): agent = the CFO key, admin = the Boss (who can only rotate the agent key).
// NairaDesk (the naira float): agent = the CFO key, owner = the Boss; caps NAIRA_PER_PAY_CAP / NAIRA_DAY_CAP (USDC, default 10 / 50).
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { createPublicClient, createWalletClient, http, parseGwei, type Address, type Chain, type Hex } from 'viem';
import { CHAIN_CONFIGS } from '@circle-fin/x402-batching/client';
import { account } from '../src/wallets.ts';
import { ARC } from '../src/config.ts';

const network = process.argv[2] ?? 'local';
if (network !== 'local' && network !== 'arc') { console.error('usage: node scripts/deploy-pay.ts local|arc'); process.exit(1); }
const FEE_BPS = 50; // 0.5%, capped at 1% by the contract

const root = new URL('../../', import.meta.url).pathname;
const depFile = join(root, 'deployments', `${network}.json`);
const dep = JSON.parse(readFileSync(depFile, 'utf8'));

execFileSync(join(process.env.HOME!, '.foundry/bin/forge'), ['build', '--silent'], { cwd: join(root, 'contracts'), stdio: 'inherit' });
const art = (name: string) => JSON.parse(readFileSync(join(root, `contracts/out/${name}.sol/${name}.json`), 'utf8'));

const rpc = network === 'arc' ? ARC.rpc : (process.env.LOCAL_RPC ?? dep.rpc ?? 'http://127.0.0.1:8545');
const chain: Chain = network === 'arc' ? CHAIN_CONFIGS.arc.chain : { id: dep.chainId ?? 31337, name: 'anvil', nativeCurrency: { name: 'ETH', symbol: 'ETH', decimals: 18 }, rpcUrls: { default: { http: [rpc] } } };
const fees = network === 'arc' ? { maxFeePerGas: parseGwei('60'), maxPriorityFeePerGas: parseGwei('1') } : {}; // Arc drops txs under 20 gwei
const deployer = account('treasury');
const pub = createPublicClient({ chain, transport: http(rpc) });
const wallet = createWalletClient({ chain, transport: http(rpc), account: deployer });

async function deploy(name: string, args: unknown[]) {
  const a = art(name);
  const hash = await wallet.deployContract({ abi: a.abi, bytecode: a.bytecode.object as Hex, args, ...fees } as any);
  const r = await pub.waitForTransactionReceipt({ hash });
  if (r.status !== 'success' || !r.contractAddress) throw new Error(`${name} deploy failed: ${hash}`);
  dep.txs = { ...(dep.txs ?? {}), [`deploy${name}`]: hash };
  console.log(`  ${name} → ${r.contractAddress} (gas ${r.gasUsed})${network === 'arc' ? `\n  https://explorer.arc.io/tx/${hash}` : ''}`);
  return { address: r.contractAddress, block: Number(r.blockNumber) };
}

if (!dep.invoiceBook) {
  console.log(`deploying InvoiceBook to ${network} from ${deployer.address}\n  owner ${dep.boss} · fees ${FEE_BPS / 100}% to the vault ${dep.vault} · booker (CFO) ${account('cfo').address}`);
  const d = await deploy('InvoiceBook', [dep.usdc as Address, dep.boss as Address, dep.vault as Address, FEE_BPS, account('cfo').address]);
  dep.invoiceBook = d.address; dep.invoiceBookBlock = d.block;
  writeFileSync(depFile, JSON.stringify(dep, null, 2));
} else console.log(`InvoiceBook already on ${network}: ${dep.invoiceBook}`);

if (!dep.payVault) {
  console.log(`deploying PayVault (autopay) to ${network}\n  book ${dep.invoiceBook} · agent (CFO) ${account('cfo').address} · admin ${dep.boss}`);
  const d = await deploy('PayVault', [dep.usdc as Address, dep.invoiceBook as Address, account('cfo').address, dep.boss as Address]);
  dep.payVault = d.address; dep.payVaultBlock = d.block;
  writeFileSync(depFile, JSON.stringify(dep, null, 2));
} else console.log(`PayVault already on ${network}: ${dep.payVault}`);
if (!dep.nairaDesk) {
  const per = Number(process.env.NAIRA_PER_PAY_CAP ?? 10), day = Number(process.env.NAIRA_DAY_CAP ?? 50);
  console.log(`deploying NairaDesk (the naira float) to ${network}\n  escrow ${dep.escrow} · agent (CFO) ${account('cfo').address} · owner ${dep.boss} · caps ${per} per payment, ${day} per day`);
  const d = await deploy('NairaDesk', [dep.usdc as Address, dep.escrow as Address, account('cfo').address, dep.boss as Address, BigInt(Math.round(per * 1e6)), BigInt(Math.round(day * 1e6))]);
  dep.nairaDesk = d.address; dep.nairaDeskBlock = d.block;
  writeFileSync(depFile, JSON.stringify(dep, null, 2));
  console.log(`  fund it by sending USDC on ${network} to ${d.address}`);
} else console.log(`NairaDesk already on ${network}: ${dep.nairaDesk}`);
console.log(`→ deployments/${network}.json`);
process.exit(0);
