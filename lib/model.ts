// Token Radar — model "radar-2" (a comparables model, not a name list).
//
// The question the board answers: if a protocol that has no token today
// launched one tomorrow, what would it be worth? We answer it from the
// snapshot's own figures, the way an analyst would:
//
//   implied = TVL x category multiple x growth x maturity x breadth
//
// * category multiple — the median mcap / TVL of the live-token protocols
//   in the same DefiLlama category (at least 3 of them, clamped to
//   [0.05, 1.0]). A lending protocol is worth a lending multiple, a DEX a
//   DEX multiple, and so on. Categories with too few live comparables fall
//   back to the global median mcap / TVL across all live protocols.
// * growth — the 7-day TVL change, clamped to [-50%, +100%] and weighted
//   at 0.35, so a protocol that doubled in a week is worth more than one
//   that shrank, but a single hot week cannot invent a unicorn.
// * maturity — age on the list, 0.75 for a brand-new protocol rising to
//   1.00 at three years. Old enough to have survived is worth a premium;
//   new is discounted, not excluded.
// * breadth — +2% per extra chain (capped at 4), because a protocol live
//   on several chains has more distribution than a single-chain one.
//
// Rankable subjects are pre-token protocols that are genuinely pre-token:
// the house's own watchlist rule, applied to the snapshot's fields —
// no live token (no mcap, no CoinGecko id, no symbol), not a centralised
// exchange, not a wrapped, staked or bridged product of a token that
// already trades (Bridge / Canonical Bridge / Cross Chain Bridge /
// Liquid Staking / Liquid Restaking / Restaked BTC categories, names
// containing "wrapped", "staked" or "staking", names starting with an
// exchange name), and not a versioned copy of another protocol
// ("V2", "v3", "2.0" and friends). That is why WBTC, Binance staked ETH
// and USDT0 are not on this board, even though their TVL is enormous:
// each is a product of a token that already trades.

import { join } from 'node:path';
import { readFileSync, existsSync } from 'node:fs';
import type { Protocol, Snapshot } from './types.js';

export const MODEL_VERSION = 'radar-2';
export const MODEL_NAME = 'Comparables — category median mcap/TVL';

// Calibrated constants, all visible on the dashboard's Model panel.
export const GROWTH_WEIGHT = 0.35;
export const GROWTH_FLOOR = -50;
export const GROWTH_CAP = 100;
export const MATURITY_FLOOR = 0.75;
export const MATURITY_RANGE = 0.25;
export const MATURITY_DAYS = 1095; // three years to full maturity
export const UNKNOWN_AGE_DAYS = 365; // no listed date: assume one year
export const BREADTH_PER_CHAIN = 0.02;
export const BREADTH_MAX_CHAINS = 4;
export const MULTIPLE_FLOOR = 0.05;
export const MULTIPLE_CAP = 1.0;
export const MIN_COMPARABLES = 3;
export const FARM_STEP_COUNT = 7;

const EXCLUDED_CATEGORIES = new Set([
  'Bridge',
  'Canonical Bridge',
  'Cross Chain Bridge',
  'Liquid Staking',
  'Liquid Restaking',
  'Restaked BTC',
  'CEX',
]);

const EXCHANGE_NAMES = new Set([
  'Binance',
  'Coinbase',
  'Bybit',
  'Kraken',
  'Bitget',
  'OKX',
  'Bitfinex',
  'Gemini',
]);

const VERSION_MARKER = /\s(V\d+(\.\d+)?|v\d+(\.\d+)?|\d+\.\d+)$/;
const WRAPPED_OR_STAKED = /\b(wrapped|staked|staking)\b/i;

const AS_OF_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

function isPreToken(p: Protocol): boolean {
  return p.mcap_usd == null && p.gecko_id == null && p.symbol == null;
}

export function isRankable(p: Protocol): boolean {
  if (!isPreToken(p)) return false;
  if (EXCLUDED_CATEGORIES.has(p.category)) return false;
  if (VERSION_MARKER.test(p.name)) return false;
  if (WRAPPED_OR_STAKED.test(p.name)) return false;
  if (EXCHANGE_NAMES.has(p.name.split(' ')[0])) return false;
  return true;
}

export function parseSnapshot(path: string): Snapshot {
  const text = readFileSync(path, 'utf8');
  const data = JSON.parse(text) as Snapshot;
  const errors: string[] = [];
  if (typeof data.as_of !== 'string' || !AS_OF_PATTERN.test(data.as_of)) {
    errors.push('snapshot.as_of must be a YYYY-MM-DD date string');
  }
  if (typeof data.floor_usd !== 'number' || !Number.isFinite(data.floor_usd) || data.floor_usd <= 0) {
    errors.push('snapshot.floor_usd must be a positive number');
  }
  if (!Array.isArray(data.protocols)) errors.push('snapshot.protocols must be an array');
  if (!Array.isArray(data.watchlist)) errors.push('snapshot.watchlist must be an array');
  if (errors.length > 0) throw new Error(errors.join('; '));
  return data;
}

export function parseAsOf(asOf: string): Date {
  return new Date(`${asOf}T00:00:00Z`);
}

export function protocolAgeDays(p: Protocol, asOf: Date): number | null {
  if (!p.listed_at) return null;
  const listed = new Date(p.listed_at);
  const days = Math.floor((asOf.getTime() - listed.getTime()) / 86_400_000);
  return Math.max(0, days);
}

export function median(values: number[]): number {
  if (values.length === 0) throw new Error('median of an empty list');
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

export interface CategoryMultiple {
  category: string;
  multiple: number;
  comparables: number;
  fallback: boolean;
}

export interface Multiples {
  byCategory: Map<string, CategoryMultiple>;
  global: number;
  liveCount: number;
}

export function categoryMultiples(snapshot: Snapshot): Multiples {
  const live = snapshot.protocols.filter(
    (p) => !isPreToken(p) && p.mcap_usd != null && p.tvl_usd != null && p.tvl_usd > 0,
  );
  const byCategory = new Map<string, number[]>();
  const all: number[] = [];
  for (const p of live) {
    const ratio = (p.mcap_usd as number) / (p.tvl_usd as number);
    all.push(ratio);
    const key = p.category || 'Other';
    const list = byCategory.get(key);
    if (list) list.push(ratio);
    else byCategory.set(key, [ratio]);
  }
  const global = Math.max(MULTIPLE_FLOOR, Math.min(MULTIPLE_CAP, median(all)));
  const map = new Map<string, CategoryMultiple>();
  for (const [category, ratios] of byCategory) {
    if (ratios.length >= MIN_COMPARABLES) {
      map.set(category, {
        category,
        multiple: Math.max(MULTIPLE_FLOOR, Math.min(MULTIPLE_CAP, median(ratios))),
        comparables: ratios.length,
        fallback: false,
      });
    }
  }
  return { byCategory: map, global, liveCount: live.length };
}

export function multipleFor(category: string | null, multiples: Multiples): CategoryMultiple {
  const key = category || 'Other';
  const found = multiples.byCategory.get(key);
  if (found) return found;
  return { category: key, multiple: multiples.global, comparables: 0, fallback: true };
}

export interface ModelComponents {
  multiple: number;
  growthMult: number;
  maturityMult: number;
  breadthMult: number;
  baseValue: number;
}

export function modelComponents(p: Protocol, asOf: Date, multiples: Multiples): ModelComponents {
  const multiple = multipleFor(p.category, multiples).multiple;
  const change = p.change_7d ?? 0;
  const clamped = Math.max(GROWTH_FLOOR, Math.min(GROWTH_CAP, change));
  const growthMult = 1 + (clamped / 100) * GROWTH_WEIGHT;
  const age = protocolAgeDays(p, asOf) ?? UNKNOWN_AGE_DAYS;
  const maturityMult = MATURITY_FLOOR + (Math.min(age, MATURITY_DAYS) / MATURITY_DAYS) * MATURITY_RANGE;
  const extraChains = Math.max(0, Math.min(p.chains.length - 1, BREADTH_MAX_CHAINS));
  const breadthMult = 1 + extraChains * BREADTH_PER_CHAIN;
  return {
    multiple,
    growthMult,
    maturityMult,
    breadthMult,
    baseValue: p.tvl_usd * multiple,
  };
}

export function impliedValue(p: Protocol, asOf: Date, multiples: Multiples): number {
  const c = modelComponents(p, asOf, multiples);
  const value = c.baseValue * c.growthMult * c.maturityMult * c.breadthMult;
  return Math.max(1, Math.round(value));
}

export function signalFor(p: Protocol): 'Surging' | 'Growing' | 'Steady' | 'Cooling' {
  const change = p.change_7d ?? 0;
  if (change >= 20) return 'Surging';
  if (change >= 5) return 'Growing';
  if (change >= -10) return 'Steady';
  return 'Cooling';
}

export interface BoardRow {
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  change_7d: number | null;
  age_days: number | null;
  implied_value_usd: number;
  multiple: number;
  growth_mult: number;
  maturity_mult: number;
  breadth_mult: number;
  base_value_usd: number;
  signal: string;
  rank: number;
  farm_steps: string[];
}

export interface LiveRow {
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  mcap_usd: number;
  multiple: number;
  age_days: number | null;
}

// ---------------------------------------------------------------------------
// Farm plans. Every step is concrete: what to do, what it costs, how long
// it takes. Capital scales with the size of the protocol, gas follows the
// chain the protocol lives on, and the hold length follows how old the
// protocol is. Nothing here promises an airdrop; the plan earns the
// position, the team decides the token.
// ---------------------------------------------------------------------------

function capitalFor(tvlUsd: number): number {
  if (tvlUsd >= 5e9) return 250;
  if (tvlUsd >= 1e9) return 150;
  if (tvlUsd >= 1e8) return 100;
  return 50;
}

function holdDaysFor(ageDays: number | null): number {
  const age = ageDays ?? UNKNOWN_AGE_DAYS;
  if (age < 180) return 60;
  if (age < 365) return 45;
  return 30;
}

const GAS_BY_CHAIN: Record<string, string> = {
  Ethereum: '$9',
  Solana: '$0.01',
  Base: '$0.60',
  Arbitrum: '$0.80',
  Optimism: '$0.60',
  Polygon: '$0.05',
  Avalanche: '$0.30',
  Binance: '$0.20',
  Bitcoin: '$2.50',
  Monad: '$0.02',
};

function gasFor(chain: string | undefined): string {
  return (chain && GAS_BY_CHAIN[chain]) || '$1';
}

function money(n: number): string {
  return `$${n}`;
}

function actionFor(p: Protocol, capital: number, chain: string): string {
  const c = p.category || 'Other';
  switch (c) {
    case 'Lending':
      return `Supply ${money(capital)} of USDC to the ${p.name} lending market on ${chain}.`;
    case 'Dexs':
      return `Provide ${money(capital)} of liquidity to the main ${p.name} pool on ${chain}.`;
    case 'Yield':
    case 'Yield Aggregator':
      return `Deposit ${money(capital)} into the top ${p.name} vault on ${chain}.`;
    case 'RWA':
      return `Mint or buy ${money(capital)} of the ${p.name} yield-bearing asset on ${chain}.`;
    case 'Risk Curators':
      return `Deposit ${money(capital)} into a curated ${p.name} vault on ${chain}.`;
    case 'Onchain Capital Allocator':
      return `Deposit ${money(capital)} into a ${p.name} allocation vault on ${chain}.`;
    case 'CDP':
      return `Mint the ${p.name} stablecoin against ${money(capital)} of collateral on ${chain}.`;
    case 'Derivatives':
    case 'Basis Trading':
    case 'Perpetual':
      return `Deposit ${money(capital)} of margin to ${p.name} on ${chain}.`;
    case 'Bridge':
    case 'Canonical Bridge':
    case 'Cross Chain Bridge':
      return `Bridge ${money(capital)} through ${p.name} to ${chain}.`;
    case 'Liquid Staking':
    case 'Staking Pool':
    case 'Restaking':
    case 'Restaked BTC':
      return `Stake ${money(capital)} of the asset with ${p.name} on ${chain}.`;
    case 'Stablecoin Wrapper':
    case 'Stablecoins':
      return `Mint or deposit ${money(capital)} of the ${p.name} stable asset on ${chain}.`;
    case 'Insurance':
      return `Buy ${money(capital)} of cover from ${p.name} on ${chain}.`;
    case 'Payments':
      return `Fund ${money(capital)} into your ${p.name} account on ${chain}.`;
    case 'Governance Incentives':
      return `Deposit ${money(capital)} and stake it for voting in ${p.name} on ${chain}.`;
    case 'Chain':
      return `Bridge ${money(capital)} to ${p.name} and fund a wallet on the chain.`;
    case 'Indexes':
      return `Buy ${money(capital)} of the ${p.name} index token on ${chain}.`;
    case 'Privacy':
      return `Deposit ${money(capital)} into the ${p.name} privacy pool on ${chain}.`;
    case 'Prediction Market':
      return `Fund ${money(capital)} into your ${p.name} account on ${chain}.`;
    default:
      return `Deposit ${money(capital)} of USDC into ${p.name} on ${chain}.`;
  }
}

function secondActionFor(p: Protocol, chain: string): string {
  const c = p.category || 'Other';
  switch (c) {
    case 'Lending':
      return 'Borrow a small amount against the deposit, then repay it in full.';
    case 'Dexs':
      return 'Make one swap through the pool you just joined, so the address is a user as well as a provider.';
    case 'Yield':
    case 'Yield Aggregator':
      return 'Harvest and compound the position once, so the vault records two distinct actions.';
    case 'RWA':
      return 'Check the redemption window and the underlying asset report, then hold the position.';
    case 'Risk Curators':
      return 'Read the vault allocation report and note which markets the curator is running.';
    case 'Onchain Capital Allocator':
      return 'Read the allocator monthly report and note the strategy mix it is running.';
    case 'CDP':
      return 'Check the collateral ratio stays above the minimum and top it up if it drifts.';
    case 'Derivatives':
    case 'Basis Trading':
    case 'Perpetual':
      return 'Open one small hedged position, then close it, to register as an active trader.';
    case 'Bridge':
    case 'Canonical Bridge':
    case 'Cross Chain Bridge':
      return 'Use the bridged funds in one app on the destination chain.';
    case 'Liquid Staking':
    case 'Staking Pool':
    case 'Restaking':
    case 'Restaked BTC':
      return 'Keep the receipt token in the wallet and check the staking rewards accrue.';
    case 'Stablecoin Wrapper':
    case 'Stablecoins':
      return 'Hold the stable asset through one full epoch or distribution cycle.';
    case 'Insurance':
      return 'Keep the policy active and note its expiry date in your log.';
    case 'Payments':
      return 'Make one real payment through the account, so it is used and not just funded.';
    case 'Governance Incentives':
      return 'Vote on one live proposal, so the staked position is counted as participating.';
    case 'Chain':
      return 'Use one native app on the chain, so the wallet is active beyond the bridge.';
    case 'Indexes':
      return 'Hold through one rebalance and note the new composition.';
    case 'Privacy':
      return 'Withdraw to a fresh address you control, and keep the record in your log.';
    case 'Prediction Market':
      return 'Place one market position, so the account is a trader and not just funded.';
    default:
      return 'Make one more qualifying action, such as a swap, a deposit or a vote.';
  }
}

export function farmSteps(p: Protocol, asOf: Date): string[] {
  const capital = capitalFor(p.tvl_usd);
  const chain = p.chains[0] || 'Ethereum';
  const gas = gasFor(chain);
  const age = protocolAgeDays(p, asOf);
  const holdDays = holdDaysFor(age);
  const main = actionFor(p, capital, chain);
  const second = secondActionFor(p, chain);
  return [
    `Set up a fresh wallet for ${p.name} and write the seed phrase down offline; never share it and never paste it anywhere. Cost: nothing but the paper. Time: 5 minutes.`,
    `${main} Cost: ${money(capital)} of capital and about ${gas} of gas. Time: 15 minutes to set up.`,
    `${second} Cost: about ${gas} of gas. Time: 10 minutes.`,
    `Repeat one qualifying action a week for the next month, on the same wallet, so the address shows a real usage pattern instead of a single visit. Cost: about ${gas} of gas a week. Time: 10 minutes a week.`,
    `Leave the ${money(capital)} position in place for ${holdDays} days; a position that survives a month is a user, a position that leaves in an hour is a tourist. Cost: the ${money(capital)} stays in the position. Time: ${holdDays} days.`,
    `Open the ${p.name} points or rewards page and check that your activity is showing; if it is not, retrace the steps above before the snapshot window closes. Cost: no fee to check, and never pay to claim. Time: 10 minutes.`,
    `Write the wallet address, the dates and the transaction hashes in your log, then plan the exit: unstake or withdraw in the same order you entered, and leave enough gas in the wallet to get out. Cost: nothing but the log. Time: 5 minutes.`,
  ];
}

export function buildBoard(snapshot: Snapshot, asOf: Date, multiples: Multiples): BoardRow[] {
  const watchlist = new Set(snapshot.watchlist);
  const rankable = snapshot.protocols.filter(isRankable);
  const missing = [...watchlist].filter((slug) => !rankable.some((p) => p.slug === slug));
  if (missing.length > 0) {
    throw new Error(`watchlist slugs not rankable in snapshot: ${missing.join(', ')}`);
  }
  const scored = rankable.map((p) => {
    const c = modelComponents(p, asOf, multiples);
    return {
      p,
      value: impliedValue(p, asOf, multiples),
      components: c,
    };
  });
  scored.sort((a, b) => {
    if (b.value !== a.value) return b.value - a.value;
    return a.p.slug.localeCompare(b.p.slug);
  });
  return scored.map((entry, index) => {
    const p = entry.p;
    const c = entry.components;
    return {
      slug: p.slug,
      name: p.name,
      category: p.category,
      chains: p.chains,
      tvl_usd: p.tvl_usd,
      change_7d: p.change_7d,
      age_days: protocolAgeDays(p, asOf),
      implied_value_usd: entry.value,
      multiple: c.multiple,
      growth_mult: c.growthMult,
      maturity_mult: c.maturityMult,
      breadth_mult: c.breadthMult,
      base_value_usd: Math.round(c.baseValue),
      signal: signalFor(p),
      rank: index + 1,
      farm_steps: farmSteps(p, asOf),
    };
  });
}

export function buildLiveRows(snapshot: Snapshot, asOf: Date, limit = 24): LiveRow[] {
  const live = snapshot.protocols
    .filter((p) => !isPreToken(p) && p.mcap_usd != null && p.tvl_usd != null && p.tvl_usd > 0)
    .sort((a, b) => (b.mcap_usd as number) - (a.mcap_usd as number))
    .slice(0, limit);
  return live.map((p) => ({
    slug: p.slug,
    name: p.name,
    category: p.category,
    chains: p.chains,
    tvl_usd: p.tvl_usd as number,
    mcap_usd: p.mcap_usd as number,
    multiple: (p.mcap_usd as number) / (p.tvl_usd as number),
    age_days: protocolAgeDays(p, asOf),
  }));
}

export function dataScript(rows: BoardRow[], live: LiveRow[], multiples: Multiples, snapshot: Snapshot): string {
  const multiplesList = [...multiples.byCategory.values()]
    .sort((a, b) => b.multiple - a.multiple)
    .map((m) => ({ category: m.category, multiple: m.multiple, comparables: m.comparables }));
  const data = {
    model: {
      name: MODEL_NAME,
      version: MODEL_VERSION,
      growth_weight: GROWTH_WEIGHT,
      growth_floor: GROWTH_FLOOR,
      growth_cap: GROWTH_CAP,
      maturity_floor: MATURITY_FLOOR,
      maturity_range: MATURITY_RANGE,
      maturity_days: MATURITY_DAYS,
      unknown_age_days: UNKNOWN_AGE_DAYS,
      breadth_per_chain: BREADTH_PER_CHAIN,
      breadth_max_chains: BREADTH_MAX_CHAINS,
      multiple_floor: MULTIPLE_FLOOR,
      multiple_cap: MULTIPLE_CAP,
      min_comparables: MIN_COMPARABLES,
      global_multiple: multiples.global,
      live_count: multiples.liveCount,
    },
    as_of: snapshot.as_of,
    source: snapshot.source,
    floor_usd: snapshot.floor_usd,
    watchlist_size: snapshot.watchlist.length,
    board_size: rows.length,
    live_size: live.length,
    multiples: multiplesList,
    rows: rows.map((r) => ({
      rank: r.rank,
      slug: r.slug,
      name: r.name,
      category: r.category,
      chains: r.chains,
      tvl_usd: r.tvl_usd,
      change_7d: r.change_7d,
      age_days: r.age_days,
      implied_value_usd: r.implied_value_usd,
      multiple: r.multiple,
      growth_mult: r.growth_mult,
      maturity_mult: r.maturity_mult,
      breadth_mult: r.breadth_mult,
      base_value_usd: r.base_value_usd,
      signal: r.signal,
    })),
    live,
  };
  return `window.RADAR = ${JSON.stringify(data)};\n`;
}

export function validateBoard(
  rows: BoardRow[],
  snapshot: Snapshot,
): { issues: string[]; checks: Record<string, boolean> } {
  const issues: string[] = [];
  const slugs = new Set<string>();
  let previous: number | null = null;
  for (const row of rows) {
    if (slugs.has(row.slug)) issues.push(`duplicate slug ${row.slug}`);
    slugs.add(row.slug);
    if (row.rank !== slugs.size) issues.push(`rank out of order at ${row.slug}`);
    if (!Number.isInteger(row.implied_value_usd) || row.implied_value_usd <= 0 || row.implied_value_usd > 1e14) {
      issues.push(`bad implied_value_usd at ${row.slug}`);
    }
    if (previous !== null && row.implied_value_usd > previous) issues.push(`not sorted at ${row.slug}`);
    previous = row.implied_value_usd;
    if (!Array.isArray(row.farm_steps) || row.farm_steps.length < 3 || row.farm_steps.length > 12) {
      issues.push(`farm_steps count out of range at ${row.slug}`);
    }
    for (const step of row.farm_steps) {
      if (typeof step !== 'string' || step.length < 20 || step.length > 600) {
        issues.push(`farm step length out of range at ${row.slug}`);
      }
    }
  }
  const watchlistCovered = snapshot.watchlist.every((slug) => slugs.has(slug));
  if (!watchlistCovered) issues.push('watchlist not fully covered');
  const outside = rows.filter((r) => !snapshot.watchlist.includes(r.slug)).length;
  const checks = {
    board_file: rows.length >= 100 && rows.length <= 4000,
    sorted_by_value: rows.every((r, i) => i === 0 || r.implied_value_usd <= rows[i - 1].implied_value_usd),
    coverage: watchlistCovered && outside >= 60,
    farm_steps: rows.every((r) => r.farm_steps.length >= 3 && r.farm_steps.length <= 12),
  };
  return { issues, checks };
}

export function findInputPath(candidate: string | undefined): string {
  if (candidate && existsSync(candidate)) return candidate;
  for (const candidatePath of ['/input/snapshot.json', join(process.cwd(), 'input', 'snapshot.json')]) {
    if (existsSync(candidatePath)) return candidatePath;
  }
  throw new Error('snapshot.json not found: pass --input <path>');
}
