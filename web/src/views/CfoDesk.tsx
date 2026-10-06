'use client';
// The CFO's desk on /books: what it sees, this week's plan, what is waiting on the Boss, and every
// decision it made, each signed by the CFO's key and chained to the one before.
import { useState } from 'react';
import { api, useApi, usd, timeAgo, Avatar, ROLE_NAME } from '@/lib.tsx';
import { connect, coSignOnChain, fundDesk, fundVault, hasWallet, setVaultPolicy, short, txUrl, usdcBalance, walletError, type EscrowCfg } from '@/wallet.ts';

type Decision = { n: number; at: string; kind: string; summary: string; rule: string; inputs: Record<string, unknown>; amount?: number; agent?: string; tx?: string; proposal?: number; status: string; hash: string; sig?: string };
type Agent = { role: string; balance: number; perJob: number; perJobFrom: string; allowance: number; toppedUp: number; ready?: number; readyFor?: string };
type Svc = { id: string; name: string; ready: boolean; short: { role: string; have: number; need: number }[] };
type Naira = { enabled: boolean; live: boolean; ngnPerUsd: number | null; paid: number; receivedNgn: number; desk: null | { address: `0x${string}`; floatUsd: number; perPayCapUsd: number; dayCapUsd: number; spentTodayUsd: number; dayLeftUsd: number } };
type Cfo = {
  enabled: boolean; mode: 'live' | 'observe';
  verify: { ok: boolean; entries: number; signer?: string | null; why?: string };
  metrics: { done: number; escalated: number; refused: number; wouldDo: number; proposed: number; cosigned: number };
  snapshot: null | { at: string; epoch: number; owner: string; cfoGas: number; jobsPerWeek: number; agents: Agent[]; epochToolBudget: number; epochAllocated: number; maxMove: number; reserveFloor: number; promoCap?: number; services?: Svc[]; teamGap?: number; budgetWanted?: number; surplus?: { role: string; balance: number; keep: number; extra: number; ready: number; readyFor: string }[]; vaultUsdc: number; pending: { id: number; from: string; to: string; amount: number }[]; buckets: Record<string, number> };
  plan: null | { vaultEpoch: number; openedAt: string; jobsPerWeek: number; allowances: Record<string, number>; commit: string };
  decisions: Decision[];
};

const KIND: Record<string, string> = {
  epoch: 'Weekly plan', allowance: 'Allowance', 'top-up': 'Top-up', move: 'Move', propose: 'Asked the Boss', escalate: 'Escalated',
  hold: 'Held', 'payee-pinned': 'Payee pinned', 'payee-refused': 'Payment refused', 'screen-refused': 'Screened out',
  autopay: 'Autopaid a bill', 'pay-propose': 'Asked a business', screen: 'Screening', report: 'Weekly report', reclaim: 'Took back surplus',
};
const STATUS: Record<string, string> = { done: 'done', 'would-do': 'would do', escalated: 'to the Boss', refused: 'refused', failed: 'failed' };

export default function CfoDesk() {
  const { data: c, setData } = useApi<Cfo>('/api/cfo', 15000);
  const { data: esc } = useApi<EscrowCfg | { enabled: false }>('/api/escrow');
  const cfg = esc?.enabled ? esc : null;
  const [busy, setBusy] = useState<number | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [all, setAll] = useState(false);
  const [fund, setFund] = useState({ amount: '10', busy: false, err: null as string | null, done: null as string | null });
  const [back, setBack] = useState<{ busy: boolean; msg: string | null; err: string | null }>({ busy: false, msg: null, err: null });
  const { data: nd, setData: setNd } = useApi<Naira>('/api/naira', 30000);
  const [desk, setDesk] = useState({ amount: '20', busy: false, err: null as string | null, done: null as string | null });
  const [pol, setPol] = useState<{ budget: string; maxMove: string; busy: boolean; err: string | null; done: string | null } | null>(null);
  if (!c?.enabled) return null;
  const s = c.snapshot;
  const policy = pol ?? { budget: String(Math.max(s?.budgetWanted ?? 0, s?.epochToolBudget ?? 0)), maxMove: String(Math.max(s?.maxMove ?? 2, Math.ceil(s?.teamGap ?? 0))), busy: false, err: null, done: null }; // the move limit defaults to the team's gap, so it's funded without a co-sign

  async function savePolicy() {
    if (!cfg || !s) return;
    const budget = Number(policy.budget), maxMove = Number(policy.maxMove);
    setPol({ ...policy, busy: true, err: null, done: null });
    try {
      if (!(budget >= s.epochAllocated)) throw new Error(`The weekly budget can't be below what's already given out this week (${usd(s.epochAllocated)} USDC).`);
      if (!(maxMove > 0)) throw new Error('Enter how much the CFO may move on its own.');
      const who = await connect(cfg);
      if (who.toLowerCase() !== s.owner.toLowerCase()) throw new Error(`Only the Boss wallet (${short(s.owner)}) can change the limits. This is ${short(who)}.`);
      const tx = await setVaultPolicy(cfg, who, { reserveFloor: s.reserveFloor, maxMove, epochToolBudget: budget, promoCap: s.promoCap ?? 0 });
      await api('/api/cfo/nudge', { method: 'POST' }).catch(() => {});
      setPol({ ...policy, busy: false, done: tx });
      setTimeout(() => api<Cfo>('/api/cfo').then(setData).catch(() => {}), 8000);
    } catch (e: any) { setPol({ ...policy, busy: false, err: walletError(e) }); }
  }
  const notReady = (s?.services ?? []).filter((x) => !x.ready);
  const extra = s?.surplus ?? [];
  async function reclaim() {
    if (!confirm(`Send ${usd(extra.reduce((t, x) => t + x.extra, 0))} USDC from ${extra.map((x) => ROLE_NAME[x.role] ?? x.role).join(', ')} back to the vault?`)) return;
    setBack({ busy: true, msg: null, err: null });
    try {
      const r = await api<{ returned: { role: string; amount: number; tx?: string; error?: string }[] }>('/api/cfo/reclaim', { method: 'POST' });
      const ok = r.returned.filter((x) => x.tx), bad = r.returned.filter((x) => x.error);
      setBack({ busy: false, msg: ok.length ? `Sent back ${usd(ok.reduce((t, x) => t + x.amount, 0))} USDC from ${ok.map((x) => ROLE_NAME[x.role] ?? x.role).join(', ')}. The CFO credits it to OPERATING within a minute.` : null, err: bad.length ? bad.map((x) => `${ROLE_NAME[x.role] ?? x.role}: ${x.error}`).join(' · ') : null });
      setTimeout(() => api<Cfo>('/api/cfo').then(setData).catch(() => {}), 6000);
    } catch (e: any) { setBack({ busy: false, msg: null, err: e.message }); }
  }

  async function coSign(id: number) {
    if (!cfg || !s) return;
    setErr(null); setBusy(id);
    try {
      const who = await connect(cfg);
      if (who.toLowerCase() !== s.owner.toLowerCase()) throw new Error(`Only the Boss wallet (${short(s.owner)}) can co-sign. This is ${short(who)}.`);
      await coSignOnChain(cfg, who, id);
      setData(await api<Cfo>('/api/cfo'));
    } catch (e: any) { setErr(walletError(e)); } finally { setBusy(null); }
  }

  async function sendToVault() {
    if (!cfg) return;
    const n = Number(fund.amount);
    setFund((f) => ({ ...f, busy: true, err: null, done: null }));
    try {
      if (!(n > 0)) throw new Error('Enter an amount in USDC.');
      const who = await connect(cfg);
      const have = await usdcBalance(cfg, who);
      if (have < n) throw new Error(`This wallet has ${usd(have)} USDC on Arc.`);
      const tx = await fundVault(cfg, who, n);
      setFund((f) => ({ ...f, busy: false, done: tx }));
    } catch (e: any) { setFund((f) => ({ ...f, busy: false, err: walletError(e) })); }
  }

  async function topUpDesk() {
    if (!cfg || !nd?.desk) return;
    const n = Number(desk.amount);
    setDesk((d) => ({ ...d, busy: true, err: null, done: null }));
    try {
      if (!(n > 0)) throw new Error('Enter an amount in USDC.');
      const who = await connect(cfg);
      const have = await usdcBalance(cfg, who);
      if (have < n + 0.02) throw new Error(`This wallet has ${usd(have)} USDC on Arc. Leave a few cents for gas: send at most ${usd(Math.max(0, have - 0.02))}.`);
      const tx = await fundDesk(cfg, who, nd.desk.address, n);
      setDesk((d) => ({ ...d, busy: false, done: tx }));
      setTimeout(() => api<Naira>('/api/naira').then(setNd).catch(() => {}), 4000);
    } catch (e: any) { setDesk((d) => ({ ...d, busy: false, err: walletError(e) })); }
  }

  const shown = all ? c.decisions : c.decisions.slice(0, 12);
  return (
    <section className="card pad cfodesk" style={{ marginTop: 20 }}>
      <div className="cfohead">
        <h3 className="t">The CFO's desk <small>every decision about the company's money, signed</small></h3>
        <span className={`chip${c.mode === 'live' ? ' live' : ''}`}>{c.mode === 'live' ? <><span className="dot" />Acting on its own, inside the vault's limits</> : 'Observing: decides and logs, moves nothing yet'}</span>
      </div>
      <p className="muted" style={{ fontSize: 14, margin: '6px 0 14px' }}>
        Every few minutes the CFO reads the vault and each agent's balance, plans the week's allowances from measured spend, puts revenue to work (tools first, then bond cover, then the reserve) and tops up agents that are running low.
        It moves at most {s ? usd(s.maxMove) : 'its limit in'} USDC a week between two buckets on its own; anything bigger goes to the Boss to co-sign. No language model touches the money: every number and reason below is computed.
      </p>
      <div className="minis">
        <div><b>{c.metrics.done}</b>decisions carried out</div>
        <div><b>{c.metrics.escalated}</b>escalated to the Boss</div>
        <div><b>{c.metrics.cosigned}/{c.metrics.proposed}</b>proposals co-signed</div>
        <div title={c.verify.why}><b>{c.verify.ok ? '✓' : '✗'}</b>log {c.verify.ok ? `verified: ${c.verify.entries} entries, hash-chained and signed by the CFO` : `broken: ${c.verify.why}`}</div>
      </div>

      {s && s.pending.length > 0 && (
        <div className="bossbox">
          <b>Waiting on the Boss</b>
          {s.pending.map((p) => (
            <div key={p.id} className="bossrow">
              <span>Proposal #{p.id}: move <b>{usd(p.amount)} USDC</b> from {p.from.toUpperCase()} to {p.to.toUpperCase()}</span>
              <button className="btn primary sm" disabled={busy !== null || !cfg || !hasWallet()} onClick={() => coSign(p.id)}>{busy === p.id ? 'Confirm in your wallet…' : 'Co-sign as the Boss'}</button>
            </div>
          ))}
          <p className="muted" style={{ fontSize: 12.5, margin: 0 }}>Only the vault owner's wallet ({short(s.owner)}) can co-sign; the contract refuses anyone else.</p>
          {err && <div className="error">{err}</div>}
        </div>
      )}

      {s?.services && (
        <div className={`readybox${notReady.length ? ' short' : ''}`}>
          <b>{notReady.length ? `Ready for ${s.services.length - notReady.length} of ${s.services.length} services` : `The team is funded for every service`}</b>
          <div className="readychips">{s.services.map((x) => <span key={x.id} className={`chip${x.ready ? ' live' : ''}`} title={x.short.map((r) => `${ROLE_NAME[r.role] ?? r.role}: ${usd(r.have, 3)} of ${usd(r.need, 3)}`).join(' · ')}>{x.ready ? '✓' : '!'} {x.name}</span>)}</div>
          {notReady.length > 0 && <p style={{ fontSize: 13.5, margin: 0 }}>{notReady.map((x) => `${x.name}: ${x.short.map((r) => `${ROLE_NAME[r.role] ?? r.role} has ${usd(r.have, 2)} of ${usd(r.need, 2)}`).join(', ')}`).join(' · ')}. The vault has the money; the CFO gives out at most {usd(s.epochToolBudget)} USDC a week to the agents{s.epochAllocated >= s.epochToolBudget - 0.01 ? ' and has used it' : ''}. Raising the weekly budget to about <b>{s.budgetWanted} USDC</b> lets it fund everyone now.</p>}
        </div>
      )}

      {(extra.length > 0 || back.msg || back.err) && (
        <div className="fundbox">
          <div>
            <b>Money sitting with agents that don't need it</b>
            <p className="muted" style={{ fontSize: 13, margin: '4px 0 0' }}>Each agent keeps three of its usual jobs, and never less than its priciest job. Above that, the money does more in the vault, where the CFO gives it to the agents that spend more per job. Each return is a Circle Gateway withdrawal to the vault and costs a few cents.</p>
          </div>
          {extra.length > 0 && <ul className="rules" style={{ fontSize: 14, margin: 0 }}>{extra.map((x) => <li key={x.role}><b>{ROLE_NAME[x.role] ?? x.role}</b> holds {usd(x.balance, 2)} and needs about {usd(x.keep, 2)}{x.ready > 0 ? ` (priciest job: ${x.readyFor}, ${usd(x.ready, 2)})` : ''}: <b>{usd(x.extra, 2)}</b> can go back</li>)}</ul>}
          {extra.length > 0 && <div className="fundrow"><button className="btn primary sm" disabled={back.busy} onClick={reclaim}>{back.busy ? 'Sending it back…' : `Send ${usd(extra.reduce((t, x) => t + x.extra, 0))} USDC back to the vault`}</button></div>}
          {back.msg && <div className="ok">{back.msg}</div>}
          {back.err && <div className="error">{back.err}</div>}
        </div>
      )}

      {s && cfg && (
        <div className="fundbox">
          <div>
            <b>The CFO's limits</b>
            <p className="muted" style={{ fontSize: 13, margin: '4px 0 0' }}>Set on-chain in the vault, so the CFO can't go past them. The weekly budget caps what it gives the agents for tools ({usd(s.epochAllocated)} of {usd(s.epochToolBudget)} given out this week); above the move limit ({usd(s.maxMove)} now) it asks you to co-sign. Only the Boss wallet can change them.</p>
          </div>
          <div className="fundrow">
            <label className="mini-l">Weekly tool budget<input type="text" inputMode="decimal" value={policy.budget} onChange={(e) => setPol({ ...policy, budget: e.target.value })} aria-label="Weekly tool budget in USDC" /></label>
            <label className="mini-l">Moves alone up to<input type="text" inputMode="decimal" value={policy.maxMove} onChange={(e) => setPol({ ...policy, maxMove: e.target.value })} aria-label="Largest move the CFO makes alone, in USDC" /></label>
            <button className="btn primary sm" disabled={policy.busy || !hasWallet()} onClick={savePolicy}>{policy.busy ? 'Confirm in your wallet…' : 'Set the limits'}</button>
          </div>
          {policy.err && <div className="error">{policy.err}</div>}
          {policy.done && <div className="ok">Set. <a href={txUrl(cfg, policy.done)} target="_blank" rel="noreferrer">Transaction ↗</a> The CFO re-plans and tops the team up now; watch its log below.</div>}
        </div>
      )}

      {s && cfg && (
        <div className="fundbox">
          <div>
            <b>Fund the team</b>
            <p className="muted" style={{ fontSize: 13, margin: '4px 0 0' }}>Send USDC to the vault and the CFO does the rest within a minute: credits it to OPERATING, moves what the agents need into TOOLS, and tops each one up from its plan. Nobody splits money by hand, and the vault's limits still hold.</p>
          </div>
          <div className="fundrow">
            <input type="text" inputMode="decimal" value={fund.amount} onChange={(e) => setFund((f) => ({ ...f, amount: e.target.value }))} aria-label="USDC to send" />
            <button className="btn primary sm" disabled={fund.busy || !hasWallet()} onClick={sendToVault}>{fund.busy ? 'Confirm in your wallet…' : 'Send to the vault'}</button>
          </div>
          {fund.err && <div className="error">{fund.err}</div>}
          {fund.done && <div className="ok">Sent. <a href={txUrl(cfg, fund.done)} target="_blank" rel="noreferrer">Transaction ↗</a> Watch the CFO's log below.</div>}
          {!hasWallet() && <p className="muted" style={{ fontSize: 12.5, margin: 0 }}>Open this page in a wallet browser, or send USDC on Arc to <span className="mono">{cfg.vault}</span>.</p>}
        </div>
      )}

      {cfg && nd?.desk && (
        <div className={`fundbox${nd.enabled && nd.desk.floatUsd < nd.desk.perPayCapUsd ? ' short' : ''}`}>
          <div>
            <b>Naira float <small className="muted">NairaDesk, {usd(nd.desk.floatUsd)} USDC</small></b>
            <p className="muted" style={{ fontSize: 13, margin: '4px 0 0' }}>
              Customers who pay in naira through Bachs get their job's escrow funded from this float. It can only pay Syncly's own escrow, at most {usd(nd.desk.perPayCapUsd)} USDC a job and {usd(nd.desk.dayCapUsd)} a day ({usd(nd.desk.dayLeftUsd)} left today), and only the Boss wallet can take it back out.
              {nd.enabled ? ` Naira is on${nd.ngnPerUsd ? ` at ₦${Math.round(nd.ngnPerUsd).toLocaleString()} per dollar` : ''}; ${nd.paid} paid so far (₦${nd.receivedNgn.toLocaleString()}).` : ' Naira checkout is off until the Bachs keys are set.'}
              {nd.desk.floatUsd < 2 ? ' While the float is below a job\'s price, customers only see the USDC option.' : ''}
            </p>
          </div>
          <div className="fundrow">
            <input type="text" inputMode="decimal" value={desk.amount} onChange={(e) => setDesk((d) => ({ ...d, amount: e.target.value }))} aria-label="USDC to add to the naira float" />
            <button className="btn primary sm" disabled={desk.busy || !hasWallet()} onClick={topUpDesk}>{desk.busy ? 'Confirm in your wallet…' : 'Top up the desk'}</button>
          </div>
          {desk.err && <div className="error">{desk.err}</div>}
          {desk.done && <div className="ok">Added. <a href={txUrl(cfg, desk.done)} target="_blank" rel="noreferrer">Transaction ↗</a> The float updates in a few seconds.</div>}
          {!hasWallet() && <p className="muted" style={{ fontSize: 12.5, margin: 0 }}>Open this page in a wallet browser. A plain send to the desk is refused on Arc; it has to be a USDC token transfer, which this button makes.</p>}
        </div>
      )}

      {s && (
        <div className="row2" style={{ marginTop: 16 }}>
          <div>
            <h4 className="subh">Each agent's float <small>its Circle Gateway balance for buying tools</small></h4>
            <table className="tbl compact">
              <thead><tr><th>Agent</th><th className="num">Balance</th><th className="num">Per job</th><th className="num">This week</th></tr></thead>
              <tbody>
                {s.agents.map((a) => (
                  <tr key={a.role}>
                    <td><span style={{ display: 'inline-flex', gap: 8, alignItems: 'center' }}><Avatar role={a.role} />{ROLE_NAME[a.role] ?? a.role}</span></td>
                    <td className={`num${a.balance < Math.max(a.perJob * 2, a.ready ?? 0) ? ' warn' : ''}`} title={a.ready ? `one ${a.readyFor} job needs ${usd(a.ready, 3)}` : undefined}>{Number.isFinite(a.balance) ? usd(a.balance, 3) : '—'}</td>
                    <td className="num" title={a.perJobFrom}>{usd(a.perJob, 3)}</td>
                    <td className="num">{usd(a.toppedUp, 2)} / {usd(a.allowance, 2)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            <p className="muted" style={{ fontSize: 12.5, marginTop: 8 }}>“This week” is topped up / allowed. An agent is topped up when it can afford fewer than two of its usual jobs, or less than one job of the most expensive service it works on. CFO gas: {usd(s.cfoGas, 4)} USDC.</p>
          </div>
          <div>
            <h4 className="subh">This week's plan <small>week {c.plan?.vaultEpoch ?? s.epoch}</small></h4>
            {c.plan ? (
              <>
                <p style={{ fontSize: 14, color: 'var(--ink-2)', margin: '4px 0 8px' }}>Planned for {c.plan.jobsPerWeek} jobs, {timeAgo(c.plan.openedAt)}. {usd(s.epochAllocated, 2)} of the {usd(s.epochToolBudget, 2)} USDC weekly tool budget is allocated; when an agent runs out mid-week the CFO re-plans inside what's left, and the vault refuses anything past it.</p>
                <ul className="rules" style={{ fontSize: 14 }}>{Object.entries(c.plan.allowances).map(([r, x]) => <li key={r}><b>{ROLE_NAME[r] ?? r}</b>: {usd(x, 3)} USDC</li>)}</ul>
                <p className="muted" style={{ fontSize: 12.5, wordBreak: 'break-all' }}>The plan's hash was sealed on-chain (openEpoch) before any money moved: <span className="mono">{c.plan.commit}</span></p>
              </>
            ) : <p className="muted" style={{ fontSize: 14 }}>No week planned yet{c.mode === 'observe' ? ': the CFO is observing' : ''}.</p>}
          </div>
        </div>
      )}

      <h4 className="subh" style={{ marginTop: 18 }}>Decision log</h4>
      <ol className="declog">
        {shown.map((d) => (
          <li key={d.n} className={d.status}>
            <div className="dl-top">
              <span className="kind">{KIND[d.kind] ?? d.kind}</span>
              <span className={`st ${d.status}`}>{d.kind === 'pay-propose' || (d.kind === 'escalate' && (d as { key?: string }).key?.startsWith('autopay')) ? 'to the owner' : d.kind === 'screen' && d.status !== 'done' ? (d.status === 'refused' ? 'stopped' : 'flagged') : STATUS[d.status] ?? d.status}</span>
              <span className="when">#{d.n} · {timeAgo(d.at)}</span>
            </div>
            <div className="sum">{d.summary}</div>
            <details>
              <summary>What it saw, and the proof</summary>
              <div className="ref">Rule: {d.rule}</div>
              {d.tx && (txUrl(cfg, d.tx) ? <div className="ref"><a href={txUrl(cfg, d.tx)} target="_blank" rel="noreferrer">Transaction ↗</a></div> : <div className="ref mono">tx {d.tx.slice(0, 18)}…</div>)}
              <pre className="spec">{JSON.stringify(d.inputs, null, 1)}</pre>
              <div className="ref mono" style={{ wordBreak: 'break-all' }}>hash {d.hash}{d.sig ? ` · signed ${d.sig.slice(0, 18)}…` : ''}</div>
            </details>
          </li>
        ))}
        {!c.decisions.length && <li className="muted">No decisions yet.</li>}
      </ol>
      {c.decisions.length > 12 && <button className="btn ghost sm" onClick={() => setAll((x) => !x)}>{all ? 'Show fewer' : `Show all ${c.decisions.length}`}</button>}
    </section>
  );
}
