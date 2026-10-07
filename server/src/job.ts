// A job: one run of a service for an order, with its budget policy, receipt lines, a step log and
// the deliverable. Saved as data/jobs/<id>/{job.json, deliverable.md, files}. The receipt is the
// record of every tool the team bought, from whom, for how much, and why. Customers see the work and
// the Arc settlements; the amounts are for the owner's private books.
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { randomBytes } from 'node:crypto';
import { DATA_DIR, DRY } from './config.ts';
import { publish } from './bus.ts';
import type { ReceiptLine } from './x402.ts';
import type { Role } from './wallets.ts';
import { isPrivate } from './private.ts';

export type Policy = { budgetUsd: number; allowHosts: string[] };
export type StepLog = { at: string; agent: Role; step: string; note: string };

export class Job {
  id: string;
  service: string;
  brief: string;
  policy: Policy;
  orderId?: string;
  createdAt = new Date().toISOString();
  receipt: ReceiptLine[] = [];
  steps: StepLog[] = [];
  deliverable = '';
  files: { name: string; content: string | Buffer }[] = []; // extra deliverables: CSV, images, video, a site
  qa?: { verdict: 'pass' | 'revise'; notes: string; model: string };
  status: 'running' | 'delivered' | 'failed' = 'running';
  error?: string;
  quiet = !!process.env.OUTLAY_QUIET;

  constructor(service: string, brief: string, policy: Policy, orderId?: string) {
    this.id = `job_${new Date().toISOString().slice(0, 10).replace(/-/g, '')}_${randomBytes(3).toString('hex')}`;
    this.service = service;
    this.brief = brief;
    this.policy = policy;
    this.orderId = orderId;
  }

  spentUsd() {
    return this.receipt.reduce((s, r) => s + r.usd, 0);
  }
  addReceipt(r: ReceiptLine) {
    this.receipt.push(r);
    if (!this.quiet) console.log(`  💸 ${r.agent.padEnd(10)} ${r.vendor.padEnd(22)} ${r.usd.toFixed(4)} USDC  ${r.dry ? '(dry)' : r.transaction.slice(0, 18)}  · ${r.reason}`);
    publish({ type: 'purchase', orderId: this.orderId, jobId: this.id, data: { ...r, spentUsd: this.spentUsd() } });
    this.save();
  }
  log(agent: Role, step: string, note = '') {
    const s = { at: new Date().toISOString(), agent, step, note };
    this.steps.push(s);
    if (!this.quiet) console.log(`  ▸ ${agent.padEnd(10)} ${step}${note ? ` · ${note}` : ''}`);
    publish({ type: 'step', orderId: this.orderId, jobId: this.id, data: isPrivate(this.service) ? { ...s, note: '' } : s });
    this.save();
  }

  dir() {
    return join(DATA_DIR, 'jobs', this.id);
  }
  save() {
    mkdirSync(this.dir(), { recursive: true });
    const { deliverable, files, quiet, ...rest } = this;
    writeFileSync(join(this.dir(), 'job.json'), JSON.stringify({ ...rest, files: files.map((f) => f.name), dry: DRY, spentUsd: this.spentUsd() }, null, 2));
    if (deliverable) writeFileSync(join(this.dir(), 'deliverable.md'), deliverable);
    for (const f of files) writeFileSync(join(this.dir(), f.name), f.content);
  }
}
