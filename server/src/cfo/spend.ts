// What each agent spends on one job of a service, in USDC, measured on demo runs. The CFO plans
// allowances and checks a team can afford a job from it until live history replaces it, and
// scripts/wallet.ts split shares new money between the agents by it.
import type { Role } from '../wallets.ts';

export const SPEND: Record<string, Partial<Record<Role, number>>> = {
  'money-report': { analyst: 0.25, auditor: 0.005, writer: 0.04 },
  flyers: { writer: 0.02, auditor: 0.05 },
  'find-customers': { researcher: 0.01, analyst: 0.03, scout: 0.06, reader: 0.006, investigator: 0.01, writer: 0.06 },
  'local-business-finder': { researcher: 0.02, scout: 0.02 },
  'lead-list': { researcher: 0.02, scout: 0.015, reader: 0.006, investigator: 0.01, writer: 0.03 },
  'research-brief': { researcher: 0.02, scout: 0.015, reader: 0.003, auditor: 0.01 },
  'content-pack': { researcher: 0.01, reader: 0.003, scout: 0.6, analyst: 0.02, writer: 0.05, illustrator: 0.3, auditor: 0.01 },
  website: { researcher: 0.01, scout: 0.01, reader: 0.1, analyst: 0.03, illustrator: 0.5, auditor: 0.35 },
  'motion-ad': { researcher: 0.01, reader: 0.003, producer: 0.6, auditor: 0.05 },
  'buy-smart': { researcher: 0.03, scout: 0.06, reader: 0.03, analyst: 0.4, investigator: 0.48, writer: 0.06, auditor: 0.04 },
  'get-found': { researcher: 1.25, investigator: 1.25, scout: 0.33, analyst: 0.2, auditor: 0.08, writer: 0.06, reader: 0.03 },
  'product-photos': { analyst: 0.06, illustrator: 0.92, auditor: 0.15 },
  'ad-launch': { researcher: 0.01, scout: 0.2, analyst: 0.1, writer: 0.02, illustrator: 0.35, producer: 1.4, auditor: 0.1 },
  'video-ad': { researcher: 0.01, scout: 0.1, illustrator: 0.2, producer: 1.4, writer: 0.01, auditor: 0.03 },
  'ai-answer-audit': { researcher: 1.41, scout: 0.21, reader: 0.03, investigator: 1.4, analyst: 0.21, auditor: 0.03, writer: 0.01 },
  'best-price': { researcher: 0.02, scout: 0.02, reader: 0.02, auditor: 0.01 },
  'vendor-check': { investigator: 0.43, analyst: 0.32, scout: 0.015, reader: 0.003, writer: 0.02, auditor: 0.01 },
};
