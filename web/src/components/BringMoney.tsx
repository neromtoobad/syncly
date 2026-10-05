'use client';
// Bring money to Arc: USDC from another chain over Circle's CCTP (Fast, with Circle's forwarder minting on
// Arc, so the payer needs no Arc gas), or ETH/USDT swapped into USDC on Arc, or a withdrawal from an exchange.
// Built on Circle App Kit, loaded only when this panel is used. The payer's own wallet signs everything;
// Syncly never holds the money.
import { useEffect, useRef, useState } from 'react';
import type { Address } from 'viem';
import { connect, getProvider, hasWallet, short, usdcBalance, walletError, type EscrowCfg } from '@/wallet.ts';
import { useApi } from '@/lib.tsx';

const BRIDGE_FROM: [string, string][] = [['Base', 'Base'], ['Ethereum', 'Ethereum'], ['Arbitrum', 'Arbitrum'], ['Optimism', 'Optimism'], ['Polygon', 'Polygon'], ['Avalanche', 'Avalanche'], ['Linea', 'Linea'], ['Unichain', 'Unichain'], ['World_Chain', 'World Chain']];
const SWAP_FROM: [string, string, string][] = [['Base', 'Base', 'ETH'], ['Ethereum', 'Ethereum', 'ETH'], ['Arbitrum', 'Arbitrum', 'ETH'], ['Optimism', 'Optimism', 'ETH'], ['Polygon', 'Polygon', 'POL'], ['Avalanche', 'Avalanche', 'AVAX']];
const EXCHANGES = ['Binance', 'Bybit', 'OKX', 'Kraken', 'KuCoin', 'Gate', 'Bitget'];
const STEP: Record<string, string> = { approve: 'Approved', burn: 'Sent', fetchAttestation: 'Confirmed by Circle', mint: 'Arrived on Arc', forward: 'Arrived on Arc', swap: 'Swapped' };

type Tab = 'bridge' | 'swap' | 'card' | 'exchange';
type Step = { label: string; tx?: string; url?: string };
type Kit = { kit: any; adapter: any };

const fmt = (n: number) => (Math.round(n * 100) / 100).toFixed(2);
const sum = (fees: { token: string; amount: string }[] | undefined, token: string) => (fees ?? []).filter((f) => f.token === token).reduce((t, f) => t + Number(f.amount), 0);

async function loadKit(): Promise<Kit> {
  const [{ AppKit }, { createViemAdapterFromProvider }] = await Promise.all([import('@circle-fin/app-kit'), import('@circle-fin/adapter-viem-v2')]);
  const kit = new AppKit();
  const adapter = await createViemAdapterFromProvider({ provider: getProvider() as any });
  return { kit, adapter };
}

export function BringMoneyPanel({ cfg, need, onArrived }: { cfg: EscrowCfg; need?: number; onArrived?: () => void }) {
  const [tab, setTab] = useState<Tab>('bridge');
  const [who, setWho] = useState<Address | null>(null);
  const [arcBal, setArcBal] = useState<number | null>(null);
  const [wallet, setWallet] = useState<boolean | null>(null);
  const [from, setFrom] = useState('Base');
  const [swapFrom, setSwapFrom] = useState('Base');
  const [token, setToken] = useState<'NATIVE' | 'USDT'>('USDT');
  const [amount, setAmount] = useState(need ? fmt(need + 0.1) : '5');
  const [estimate, setEstimate] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [steps, setSteps] = useState<Step[]>([]);
  const [done, setDone] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const kitRef = useRef<Promise<Kit> | null>(null);
  const { data: ramp } = useApi<{ enabled: boolean; regions: string; methods: string[] }>('/api/onramp/config');
  useEffect(() => setWallet(hasWallet()), []);

  const kit = () => (kitRef.current ??= loadKit().catch((e) => { kitRef.current = null; throw e; }));
  const refresh = async (a: Address) => { const b = await usdcBalance(cfg, a).catch(() => null); setArcBal(b); return b; };
  async function ensureWho() {
    if (who) return who;
    const a = await connect(cfg); setWho(a);
    const b = await refresh(a);
    if (need && b !== null && b < need) setAmount(fmt(need - b + 0.1));
    return a;
  }

  // a fresh estimate whenever the inputs change (after the wallet is connected)
  useEffect(() => {
    if (!who || tab === 'exchange' || tab === 'card' || !(Number(amount) > 0)) { setEstimate(null); return; }
    let live = true;
    const t = setTimeout(async () => {
      try {
        const { kit: k, adapter } = await kit();
        if (tab === 'bridge') {
          const e = await k.estimateBridge({ from: { adapter, chain: from }, to: { chain: 'Arc', recipientAddress: who, useForwarder: true }, amount, config: { transferSpeed: 'FAST' } });
          const fee = sum(e.fees, 'USDC');
          if (live) setEstimate(`You get about ${fmt(Number(amount) - fee)} USDC on Arc in under a minute. Fees: ${fee.toFixed(3)} USDC, plus a little ${from === 'Polygon' ? 'POL' : from === 'Avalanche' ? 'AVAX' : 'ETH'} for gas on ${label(from)}.`);
        } else {
          const e = await k.estimateSwap({ from: { adapter, chain: swapFrom }, tokenIn: token, tokenOut: 'USDC', amountIn: amount, to: { chain: 'Arc', recipientAddress: who } });
          if (live) setEstimate(`You get about ${fmt(Number(e.estimatedOutput?.amount ?? 0))} USDC on Arc.`);
        }
      } catch (e: any) {
        const m = String(e?.message ?? e);
        if (live) setEstimate(/route|support|token/i.test(m) ? `No route for ${tab === 'swap' ? (token === 'NATIVE' ? 'that coin' : 'USDT') + ' on ' + label(swapFrom) : 'that chain'} right now. Try another chain or token.` : /balance|insufficient/i.test(m) ? 'Not enough balance on that chain for this amount.' : `No quote right now (${m.slice(0, 90)}).`);
      }
    }, 450);
    return () => { live = false; clearTimeout(t); };
  }, [who, tab, from, swapFrom, token, amount]);

  async function run() {
    setErr(null); setDone(null); setSteps([]);
    try {
      setBusy('Connecting your wallet…');
      const a = await ensureWho();
      setBusy('Loading Circle App Kit…');
      const { kit: k, adapter } = await kit();
      const onStep = (p: any) => { const m = String(p?.method ?? '').split('.').pop() ?? ''; const tx = p?.values?.txHash; setSteps((s) => [...s, { label: STEP[m] ?? m, tx, url: p?.values?.explorerUrl }]); };
      k.on('*', onStep);
      try {
        if (tab === 'bridge') {
          setBusy(`Confirm in your wallet (on ${label(from)})…`);
          let r = await k.bridge({ from: { adapter, chain: from }, to: { chain: 'Arc', recipientAddress: a, useForwarder: true }, amount, config: { transferSpeed: 'FAST' } });
          if (r.state === 'error') { setBusy('Retrying the last step…'); r = await k.retryBridge(r, { from: adapter }); }
          if (r.state !== 'success') throw new Error(r.steps?.find((s: any) => s.state === 'error')?.errorMessage ?? 'The transfer did not finish. Your USDC is safe; try again in a minute.');
          setSteps((r.steps ?? []).map((s: any) => ({ label: STEP[s.name] ?? s.name, tx: s.txHash, url: s.explorerUrl })));
        } else {
          setBusy(`Confirm the swap in your wallet (on ${label(swapFrom)})…`);
          const r = await k.swap({ from: { adapter, chain: swapFrom }, tokenIn: token, tokenOut: 'USDC', amountIn: amount, to: { chain: 'Arc', recipientAddress: a } });
          setBusy('Swapping and moving it to Arc…');
          await k.waitForSwap({ result: r });
        }
      } finally { k.off('*', onStep); }
      setBusy('Checking your balance on Arc…');
      const b = await refresh(a);
      setDone(`Done. Your wallet has ${b !== null ? fmt(b) : 'the'} USDC on Arc.`);
      onArrived?.();
    } catch (e: any) { setErr(walletError(e)); } finally { setBusy(null); }
  }

  const label = (c: string) => BRIDGE_FROM.find(([id]) => id === c)?.[1] ?? c;
  const native = SWAP_FROM.find(([id]) => id === swapFrom)?.[2] ?? 'ETH';
  return (
    <div className="bm">
      <div className="bm-tabs" role="tablist" style={{ gridTemplateColumns: `repeat(${ramp?.enabled ? 4 : 3}, 1fr)` }}>
        {([['bridge', 'USDC on another chain'], ['swap', 'ETH or USDT'], ...(ramp?.enabled ? [['card', 'Card or bank']] : []), ['exchange', 'From an exchange']] as [Tab, string][]).map(([id, t]) => (
          <button key={id} role="tab" aria-selected={tab === id} className={tab === id ? 'on' : ''} onClick={() => { setTab(id); setErr(null); setDone(null); }}>{t}</button>
        ))}
      </div>
      {who && <div className="bm-bal"><span className="mono">{short(who)}</span><span>{arcBal === null ? '…' : `${fmt(arcBal)} USDC on Arc`}{need ? ` · this payment needs ${fmt(need)}` : ''}</span></div>}
      {tab === 'card' ? <CardOnramp who={who} regions={ramp?.regions ?? 'the US, UK and EU'} connect={ensureWho} onSettled={() => { if (who) void refresh(who); onArrived?.(); }} /> : tab === 'exchange' ? <Exchanges who={who} onConnect={() => void ensureWho().catch((e) => setErr(walletError(e)))} /> : (
        <>
          <div className="bm-row">
            {tab === 'bridge' ? (
              <label className="field">From<select value={from} onChange={(e) => setFrom(e.target.value)}>{BRIDGE_FROM.map(([id, n]) => <option key={id} value={id}>{n}</option>)}</select></label>
            ) : (
              <>
                <label className="field">On<select value={swapFrom} onChange={(e) => setSwapFrom(e.target.value)}>{SWAP_FROM.map(([id, n]) => <option key={id} value={id}>{n}</option>)}</select></label>
                <label className="field">Swap<select value={token} onChange={(e) => setToken(e.target.value as any)}><option value="USDT">USDT</option><option value="NATIVE">{native}</option></select></label>
              </>
            )}
            <label className="field">Amount<input type="text" inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} /></label>
          </div>
          <p className="bm-est">{who ? estimate ?? 'Getting a quote…' : tab === 'bridge' ? 'USDC moves over Circle’s CCTP and lands in your wallet on Arc in under a minute. Circle pays the Arc gas for you.' : 'Your ETH or USDT is swapped and lands as USDC in your wallet on Arc.'}</p>
          {err && <div className="error">{err}</div>}
          {done && <div className="bm-done">{done}</div>}
          {steps.length > 0 && <ol className="bm-steps">{steps.map((s, i) => <li key={i}>✓ {s.label}{s.url ? <> · <a href={s.url} target="_blank" rel="noreferrer">tx ↗</a></> : s.tx ? <span className="mono muted"> · {short(s.tx)}</span> : null}</li>)}</ol>}
          {wallet === false ? <OpenInWallet /> : (
            <button className="btn primary block" disabled={!!busy || !(Number(amount) > 0)} onClick={run}>
              {busy ?? (who ? (tab === 'bridge' ? `Bring ${amount} USDC from ${label(from)} to Arc` : `Swap ${amount} ${token === 'NATIVE' ? native : 'USDT'} to USDC on Arc`) : 'Connect your wallet')}
            </button>
          )}
          <p className="muted" style={{ fontSize: 12.5, margin: 0 }}>Powered by Circle App Kit. Your wallet signs every step and the money goes straight to your own address on Arc; Syncly never holds it.</p>
        </>
      )}
    </div>
  );

  function Exchanges({ who: w, onConnect }: { who: Address | null; onConnect?: () => void }) {
    return (
      <div className="bm-ex">
        <p style={{ margin: 0 }}>These exchanges let you withdraw USDC straight to Arc. Choose <b>USDC</b>, network <b>Arc</b>, and paste your wallet address:</p>
        <div className="bm-chips">{EXCHANGES.map((x) => <span key={x} className="chip">{x}</span>)}</div>
        {w ? (
          <button className="btn secondary block mono" onClick={() => { void navigator.clipboard?.writeText(w); setCopied(true); }}>{copied ? 'Address copied ✓' : `Copy ${short(w)}`}</button>
        ) : onConnect && wallet ? <button className="btn secondary block" onClick={onConnect}>Connect to show your address</button> : null}
        <details>
          <summary>Paying in naira? Use Bybit P2P</summary>
          <ol>
            <li>In Bybit, open <b>P2P → Buy → USDC</b> and pay a seller by bank transfer (Opay, Kuda, Moniepoint…).</li>
            <li>Go to <b>Assets → Withdraw → USDC</b>, choose network <b>Arc</b>, and send it to your wallet’s address.</li>
            <li>Come back here and pay. Bybit is covering Arc withdrawal fees for now.</li>
          </ol>
        </details>
      </div>
    );
  }
}

/** No wallet in this browser (a phone's normal browser, or a desktop without an extension): the swap still shows,
 * and its button reopens this page inside a wallet app, where the wallet can sign. */
function OpenInWallet() {
  const url = location.href, enc = encodeURIComponent(url);
  const mobile = /Android|iPhone|iPad|iPod/i.test(navigator.userAgent);
  const apps: [string, string][] = [
    ['MetaMask', `https://metamask.app.link/dapp/${url.replace(/^https?:\/\//, '')}`],
    ['Coinbase Wallet', `https://go.cb-w.com/dapp?cb_url=${enc}`],
    ['Trust Wallet', `https://link.trustwallet.com/open_url?coin_id=60&url=${enc}`],
    ['OKX Wallet', `https://www.okx.com/download?deeplink=${encodeURIComponent(`okx://wallet/dapp/url?dappUrl=${enc}`)}`],
  ];
  return (
    <div className="bm-open">
      <p>{mobile ? 'Your wallet signs this, so open this page in your wallet app:' : 'Your wallet signs this. Add MetaMask or Rabby to this browser, or open this page in your wallet app on your phone:'}</p>
      <div className="bm-apps">{apps.map(([n, h]) => <a key={n} className="btn secondary sm" href={h}>{n}</a>)}</div>
      {!mobile && <p className="muted" style={{ margin: 0, fontSize: 13 }}><a href="https://metamask.io/download/" target="_blank" rel="noreferrer">Get MetaMask</a> · <a href="https://rabby.io" target="_blank" rel="noreferrer">Get Rabby</a></p>}
    </div>
  );
}

/** Buy USDC on Arc with Apple Pay, Google Pay, a debit card or a bank transfer: Circle's Arc Onramp widget. */
function CardOnramp({ who, regions, connect: connectWallet, onSettled }: { who: Address | null; regions: string; connect: () => Promise<Address>; onSettled: () => void }) {
  const box = useRef<HTMLDivElement>(null);
  const widget = useRef<{ close: () => void } | null>(null);
  const [state, setState] = useState<'idle' | 'starting' | 'open' | 'done'>('idle');
  const [err, setErr] = useState<string | null>(null);
  useEffect(() => () => widget.current?.close(), []);
  async function start() {
    setErr(null); setState('starting');
    try {
      const to = who ?? (await connectWallet());
      const { createOnrampKit, fetchOnrampSession } = await import('@circle-fin/onramp-kit');
      const mint = () => fetchOnrampSession({ url: '/api/onramp/sessions', body: { appUserId: 'syncly', destinationAddress: to, page: location.pathname } as any });
      const onramp = createOnrampKit();
      const mount = (session: any) => {
        widget.current?.close();
        widget.current = onramp.mountIframe({
          session, container: box.current!,
          onDepositSettled: () => { setState('done'); onSettled(); },
          onSessionExpired: async () => mount(await mint()),
          onInitializationError: ({ code }: any) => setErr(`The card checkout could not load (${code}). Try again in a minute.`),
        });
      };
      setState('open');
      await new Promise((r) => requestAnimationFrame(r)); // the container must be on the page and sized first
      mount(await mint());
    } catch (e: any) { setErr(e?.message ? String(e.message).split('\n')[0] : walletError(e)); setState('idle'); }
  }
  return (
    <div className="bm-card-ramp">
      {state !== 'open' && state !== 'done' && (
        <>
          <p style={{ margin: 0, fontSize: 14.5, lineHeight: 1.5 }}>Buy USDC on Arc with <b>Apple Pay, Google Pay, a debit card or a bank transfer</b>, straight into your wallet. For now it works in <b>{regions}</b>. A one-time ID check is done by Transak, which processes the payment for Circle.</p>
          {err && <div className="error">{err}</div>}
          <button className="btn primary block" disabled={state === 'starting'} onClick={start}>{state === 'starting' ? 'Opening the checkout…' : who ? 'Buy USDC with a card or bank' : 'Connect your wallet to buy USDC'}</button>
        </>
      )}
      {state === 'done' && <div className="bm-done">Paid. Your USDC is on its way to your wallet on Arc.</div>}
      <div ref={box} className="bm-ramp" style={{ display: state === 'open' || state === 'done' ? 'block' : 'none' }} />
      <p className="muted" style={{ fontSize: 12.5, margin: 0 }}>Powered by Circle’s Arc Onramp. Syncly never sees your card or bank details.</p>
    </div>
  );
}

/** The panel as a sheet over the page, for "not enough USDC on Arc" moments in a checkout. */
export default function BringMoney({ cfg, need, open, onClose, onArrived }: { cfg: EscrowCfg; need?: number; open: boolean; onClose: () => void; onArrived?: () => void }) {
  useEffect(() => {
    if (!open) return;
    const k = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', k); return () => window.removeEventListener('keydown', k);
  }, [open, onClose]);
  if (!open) return null;
  return (
    <div className="bm-sheet" onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div className="card pad bm-card" role="dialog" aria-modal="true" aria-label="Bring money to Arc">
        <div className="bm-head"><h3 className="t">Bring money to Arc</h3><button className="btn ghost sm" onClick={onClose} aria-label="Close">✕</button></div>
        <BringMoneyPanel cfg={cfg} need={need} onArrived={onArrived} />
      </div>
    </div>
  );
}
