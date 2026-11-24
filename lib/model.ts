// Launch Radar model: one sealed snapshot in, one ranked board of pre-token protocols out.
//
// The question the board answers: if this protocol issued a token today, what would the
// market plausibly pay for it, judged only from the snapshot's own figures? The model is
// a comparable-multiple model, and every number in it is derived from the snapshot at run
// time — no protocol name is ever special-cased, and no constant is fitted by hand to a
// favourite.
//
//   implied = TVL x category multiple x growth x maturity x reach
//
// - Category multiple: among the snapshot's live-token protocols (the ones whose token
//   already trades), the market pays a certain market-cap per dollar of TVL. Winsorised
//   to [0.02, 5] and taken as a median per category, that ratio is what a token of this
//   kind of protocol has historically been worth per TVL dollar. A category with fewer
//   than four live samples falls back to the whole market's median.
// - Growth: the seven-day TVL change, squashed with tanh so one wild week (the snapshot
//   holds a +4,448% print) cannot dominate: 1 + 0.6 x tanh(change / 40). Unreported
//   change is neutral, never zero.
// - Maturity: a protocol that has run for years with no token has survived cycles a
//   launch must price in: 0.78 + 0.32 x ln(1 + age) / ln(1 + 1460 days), capped at 1.10.
//   An unreported listing date is scored at the median age of the dated pre-token set.
// - Reach: each chain past the first widens the surface a launch can distribute across:
//   1 + 0.035 per extra chain, up to eight.
//
// The board ranks every watchlist protocol (the floor) plus every other pre-token
// protocol that passes the same genuineness screen the house's watchlist rule applies —
// no exchange products, no bridges or wrapped/staked products of a token that already
// trades, no versioned pools of another protocol — because the early rows below the
// floor are the ones a radar exists to find. Live-token protocols are never ranked: the
// dashboard shows them apart, at the market's own market caps.

/** The snapshot's protocol entry: exactly the ten fields the sealed input carries. */
export interface SnapshotProtocol {
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  change_7d: number | null;
  mcap_usd: number | null;
  listed_at: string | null;
  gecko_id: string | null;
  symbol: string | null;
}

/** The whole snapshot document. */
export interface Snapshot {
  as_of: string;
  source: string;
  floor_usd: number;
  protocols: SnapshotProtocol[];
  watchlist: string[];
}

/** The model's fixed shape; the multiples themselves are measured from the snapshot. */
export interface ModelShape {
  ratio_floor: number;
  ratio_cap: number;
  min_category_samples: number;
  growth_weight: number;
  growth_scale_pct: number;
  maturity_base: number;
  maturity_span: number;
  maturity_horizon_days: number;
  reach_per_chain: number;
  reach_max_extra_chains: number;
}

export const MODEL: ModelShape = {
  ratio_floor: 0.02,
  ratio_cap: 5,
  min_category_samples: 4,
  growth_weight: 0.6,
  growth_scale_pct: 40,
  maturity_base: 0.78,
  maturity_span: 0.32,
  maturity_horizon_days: 1460,
  reach_per_chain: 0.035,
  reach_max_extra_chains: 8,
};

/** The model's version label, shown on the dashboard and in board.json. */
export const MODEL_VERSION = 'launch-radar-2';

/** How many live-token protocols the dashboard's Live view carries, by market cap. */
export const LIVE_ROWS = 36;

/** One category's measured multiple: the median live market-cap per TVL dollar. */
export interface CategoryMultiple {
  category: string;
  multiple: number;
  samples: number;
  source: 'category' | 'market';
}

/** A farm step before it is flattened to the board's string form. */
export interface FarmStep {
  action: string;
  cost: string;
  time: string;
}

/** The model's arithmetic for one protocol, kept whole so the dashboard can show it. */
export interface Breakdown {
  category_multiple: number;
  category_samples: number;
  multiple_source: 'category' | 'market';
  growth_multiplier: number;
  growth_pct: number | null;
  maturity_multiplier: number;
  age_days: number | null;
  age_used_days: number;
  reach_multiplier: number;
  chain_count: number;
}

/** One row of board.json. */
export interface BoardRow {
  rank: number;
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  change_7d: number | null;
  listed_at: string | null;
  token_status: 'pre-token';
  on_watchlist: boolean;
  implied_value_usd: number;
  model: Breakdown;
  farm_steps: string[];
}

/** A live-token protocol: already trading, so it is listed at the market's own value. */
export interface LiveRow {
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  mcap_usd: number | null;
  symbol: string | null;
  change_7d: number | null;
  mcap_tvl: number | null;
}

/** Everything the dashboard renders. */
export interface RadarData {
  as_of: string;
  source: string;
  floor_usd: number;
  model_version: string;
  shape: ModelShape;
  market_multiple: number;
  market_samples: number;
  median_age_days: number;
  categories: CategoryMultiple[];
  counts: { protocols: number; pre_token: number; live: number; watchlist: number; board: number; early: number };
  rows: BoardRow[];
  live: LiveRow[];
}

/** Why the snapshot is not one this model can score. */
export class SnapshotError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SnapshotError';
  }
}

const DAY_MS = 86_400_000;

/** Whole days from `listedAt` to `asOf`, clamped at zero; null when either date is unusable. */
export function ageDays(asOf: string, listedAt: string | null): number | null {
  if (listedAt === null) return null;
  const a = Date.parse(`${asOf}T00:00:00Z`);
  const b = Date.parse(`${listedAt}T00:00:00Z`);
  if (!Number.isFinite(a) || !Number.isFinite(b)) return null;
  return Math.max(0, Math.floor((a - b) / DAY_MS));
}

/** The median of a non-empty numeric list. */
function median(values: number[]): number {
  const sorted = [...values].sort((x, y) => x - y);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1 ? sorted[mid]! : (sorted[mid - 1]! + sorted[mid]!) / 2;
}

const clamp = (n: number, lo: number, hi: number): number => Math.min(hi, Math.max(lo, n));
const round4 = (n: number): number => Math.round(n * 1e4) / 1e4;

/** Whether the snapshot records no token for this protocol. */
export function isPreToken(p: SnapshotProtocol): boolean {
  return p.mcap_usd === null && p.gecko_id === null && p.symbol === null;
}

/** Categories that are products of another token, or an exchange's own balance sheet. */
const PRODUCT_CATEGORIES = new Set(['Bridge', 'Canonical Bridge', 'Liquid Staking', 'Liquid Restaking', 'Restaked BTC', 'CEX']);

/** DefiLlama's version-marker rule: a name ending in a release is a pool of another protocol. */
const VERSIONED = /\s(V\d+(\.\d+)?|v\d+(\.\d+)?|\d+\.\d+)$/;

/** Whole words that mark a wrapped or staked product of a token that already trades. */
const PRODUCT_WORD = /\b(wrapped|staked|staking)\b/i;

/** Names that open with an exchange's name are that exchange's product, not a launch candidate. */
const EXCHANGE_LEAD = /^(Binance|Coinbase|Bybit|Kraken|Bitget|OKX|Bitfinex|Gemini)\b/;

/**
 * Whether a pre-token protocol is a genuine launch candidate: the same screen the house's
 * watchlist rule applies, minus the TVL floor and the parent record the snapshot omits.
 */
export function isCandidate(p: SnapshotProtocol): boolean {
  if (!isPreToken(p)) return false;
  if (p.category !== null && PRODUCT_CATEGORIES.has(p.category)) return false;
  if (VERSIONED.test(p.name) || PRODUCT_WORD.test(p.name) || EXCHANGE_LEAD.test(p.name)) return false;
  return true;
}

/** The measured multiples: one market median, and a median per category with enough samples. */
export function measureMultiples(snapshot: Snapshot, shape: ModelShape = MODEL): { market: number; marketSamples: number; byCategory: Map<string, CategoryMultiple> } {
  const ratiosByCategory = new Map<string, number[]>();
  const all: number[] = [];
  for (const p of snapshot.protocols) {
    if (isPreToken(p) || p.mcap_usd === null || p.mcap_usd <= 0 || p.tvl_usd <= 0) continue;
    const ratio = clamp(p.mcap_usd / p.tvl_usd, shape.ratio_floor, shape.ratio_cap);
    all.push(ratio);
    const key = p.category ?? 'Uncategorised';
    const list = ratiosByCategory.get(key) ?? [];
    list.push(ratio);
    ratiosByCategory.set(key, list);
  }
  const market = all.length > 0 ? median(all) : 0.2;
  const byCategory = new Map<string, CategoryMultiple>();
  for (const [category, ratios] of ratiosByCategory) {
    if (ratios.length >= shape.min_category_samples) {
      byCategory.set(category, { category, multiple: median(ratios), samples: ratios.length, source: 'category' });
    } else {
      byCategory.set(category, { category, multiple: market, samples: ratios.length, source: 'market' });
    }
  }
  return { market, marketSamples: all.length, byCategory };
}

/** The median age, in days, of the dated pre-token protocols: the stand-in for an unreported date. */
function medianPreTokenAge(snapshot: Snapshot): number {
  const ages: number[] = [];
  for (const p of snapshot.protocols) {
    if (!isPreToken(p)) continue;
    const age = ageDays(snapshot.as_of, p.listed_at);
    if (age !== null) ages.push(age);
  }
  return ages.length > 0 ? Math.round(median(ages)) : 365;
}

/** One protocol's implied value and the arithmetic behind it. */
export function impliedValue(
  p: SnapshotProtocol,
  asOf: string,
  multiples: { market: number; byCategory: Map<string, CategoryMultiple> },
  medianAge: number,
  shape: ModelShape = MODEL,
): { implied: number; breakdown: Breakdown } {
  const measured = multiples.byCategory.get(p.category ?? 'Uncategorised');
  const categoryMultiple = measured?.multiple ?? multiples.market;
  const growthMult = p.change_7d === null ? 1 : 1 + shape.growth_weight * Math.tanh(p.change_7d / shape.growth_scale_pct);
  const age = ageDays(asOf, p.listed_at);
  const ageUsed = age ?? medianAge;
  const maturityMult = shape.maturity_base + shape.maturity_span * (Math.log1p(ageUsed) / Math.log1p(shape.maturity_horizon_days));
  const extraChains = clamp(p.chains.length - 1, 0, shape.reach_max_extra_chains);
  const reachMult = 1 + shape.reach_per_chain * extraChains;
  const implied = Math.max(1, Math.round(p.tvl_usd * categoryMultiple * growthMult * maturityMult * reachMult));
  return {
    implied,
    breakdown: {
      category_multiple: round4(categoryMultiple),
      category_samples: measured?.samples ?? 0,
      multiple_source: measured?.source ?? 'market',
      growth_multiplier: round4(growthMult),
      growth_pct: p.change_7d,
      maturity_multiplier: round4(maturityMult),
      age_days: age,
      age_used_days: ageUsed,
      reach_multiplier: round4(reachMult),
      chain_count: p.chains.length,
    },
  };
}

/** The board: every watchlist slug, plus every other genuine candidate, ranked by implied value. */
export function buildBoard(snapshot: Snapshot, shape: ModelShape = MODEL): { board: BoardRow[]; multiples: ReturnType<typeof measureMultiples>; medianAge: number } {
  const multiples = measureMultiples(snapshot, shape);
  const medianAge = medianPreTokenAge(snapshot);
  const watch = new Set(snapshot.watchlist);
  const bySlugMap = new Map(snapshot.protocols.map((p) => [p.slug, p]));
  const chosen = new Map<string, SnapshotProtocol>();
  for (const slug of snapshot.watchlist) {
    const p = bySlugMap.get(slug);
    if (p !== undefined) chosen.set(slug, p);
  }
  for (const p of snapshot.protocols) {
    if (!chosen.has(p.slug) && isCandidate(p)) chosen.set(p.slug, p);
  }
  const scored = [...chosen.values()].map((p) => {
    const { implied, breakdown } = impliedValue(p, snapshot.as_of, multiples, medianAge, shape);
    return { p, implied, breakdown };
  });
  scored.sort((a, b) => b.implied - a.implied || b.p.tvl_usd - a.p.tvl_usd || (a.p.slug < b.p.slug ? -1 : 1));
  const board = scored.map((s, i) => ({
    rank: i + 1,
    slug: s.p.slug,
    name: s.p.name,
    category: s.p.category,
    chains: s.p.chains,
    tvl_usd: s.p.tvl_usd,
    change_7d: s.p.change_7d,
    listed_at: s.p.listed_at,
    token_status: 'pre-token' as const,
    on_watchlist: watch.has(s.p.slug),
    implied_value_usd: s.implied,
    model: s.breakdown,
    farm_steps: farmSteps(s.p, s.breakdown).map(stepText),
  }));
  return { board, multiples, medianAge };
}

/** A step flattened to the board's string form: the action, then its cost and its time. */
export function stepText(step: FarmStep): string {
  let s = `${step.action} Cost: ${step.cost}. Time: ${step.time}.`;
  if (s.length > 600) s = `${s.slice(0, 596)}...`;
  if (s.length < 20) s = `${s} Keep the position open and log it.`;
  return s;
}

/** The chain a position starts on: the first the snapshot names. */
function homeChain(p: SnapshotProtocol): string {
  return p.chains.length > 0 ? p.chains[0]! : 'Ethereum';
}

/** A realistic per-transaction gas figure for a chain, in dollars, from the chain's fee class. */
function gasUsd(chain: string): string {
  const c = chain.toLowerCase();
  if (c === 'ethereum') return '$6–12 of gas';
  if (c === 'solana') return 'under $0.10 of fees';
  if (c === 'bsc' || c === 'binance') return 'about $0.30 of gas';
  if (/(arbitrum|base|optimism|zksync|linea|scroll|mantle|blast|mode|taiko|starknet|polygon|avax|avalanche|fantom|sonic|gnosis|celo|moonbeam|aurora|opbnb|bob|ink|unichain|soneium|bera|monad)/.test(c)) return 'under $0.50 of gas';
  return 'about $1–2 of gas';
}

/** Working capital for one farm position, scaled to the protocol's size. */
function capitalFor(p: SnapshotProtocol): number {
  if (p.tvl_usd >= 5_000_000_000) return 500;
  if (p.tvl_usd >= 1_000_000_000) return 300;
  if (p.tvl_usd >= 250_000_000) return 200;
  if (p.tvl_usd >= 50_000_000) return 120;
  return 75;
}

/** How long a position must season: older protocols are read over longer windows. */
function holdDaysFor(ageUsed: number): number {
  if (ageUsed < 180) return 45;
  if (ageUsed < 540) return 60;
  return 90;
}

/** The category's core position, written as an instruction a farmer can follow. */
function coreAction(p: SnapshotProtocol, capital: number, chain: string): string {
  const c = (p.category ?? '').toLowerCase();
  const n = p.name;
  if (c.includes('lend') || c.includes('cdp') || c.includes('collateral'))
    return `Supply $${capital} of USDC to ${n} on ${chain}, then borrow no more than 40% against it and re-supply the borrow once, so both sides of the market see the wallet`;
  if (c.includes('dex') || c.includes('aggregator'))
    return `Add $${capital} of paired liquidity to ${n}'s busiest pool on ${chain} and route your ordinary swaps through ${n} instead of a rival venue`;
  if (c.includes('perpetual') || c.includes('derivative') || c.includes('options'))
    return `Deposit $${capital} of USDC margin on ${n} and hold one small hedged position (long spot elsewhere, short perp here) so the account trades without directional risk`;
  if (c.includes('bridge'))
    return `Bridge $${capital} of USDC to ${chain} through ${n}, use the funds in one app on the far side, and bridge a smaller amount back a week later`;
  if (c.includes('yield') || c.includes('curator') || c.includes('allocator'))
    return `Deposit $${capital} into a ${n} vault on ${chain}, keep the vault shares in the same wallet, and claim rewards only when the app offers them`;
  if (c.includes('staking') || c.includes('restak'))
    return `Stake $${capital} of the chain's staking asset through ${n} and hold the receipt token; do not sell the receipt, it is the record of the position`;
  if (c.includes('stable') || c.includes('synthetic'))
    return `Mint or deposit $${capital} of the stable asset through ${n} on ${chain} and hold it rather than swapping out the same day`;
  if (c.includes('rwa'))
    return `Mint $${capital} of ${n}'s yield asset on ${chain} after its onboarding check and hold the position to term`;
  if (c.includes('insurance'))
    return `Buy $${capital} of cover from ${n} on ${chain} for an asset you actually hold, and keep the policy to expiry`;
  if (c.includes('prediction'))
    return `Fund $${capital} on ${n} and hold positions in at least three separate markets rather than one large bet`;
  if (c.includes('launchpad') || c.includes('ido'))
    return `Complete ${n}'s onboarding on ${chain} and take part in one sale with no more than $${capital}, keeping the allocation record`;
  if (c.includes('nft') || c.includes('gaming') || c.includes('game'))
    return `Link the wallet in ${n}'s app on ${chain}, spend up to $${capital} on the in-app assets its season rewards, and keep them in the wallet`;
  return `Deposit $${capital} of USDC into ${n} on ${chain} through its main app and keep the position open rather than round-tripping it`;
}

/** The recurring action that makes the wallet read as a user, matched to the category. */
function cadenceAction(p: SnapshotProtocol): string {
  const c = (p.category ?? '').toLowerCase();
  const n = p.name;
  if (c.includes('lend')) return `Rebalance the ${n} position weekly: repay a slice, re-borrow, and vote in any governance poll the app opens`;
  if (c.includes('dex')) return `Make two or three ordinary swaps a week through ${n} and add or remove a small slice of liquidity once a week`;
  if (c.includes('perpetual') || c.includes('derivative')) return `Roll the hedge weekly and keep the margin ratio steady; an account that trades every week counts, a one-day spike does not`;
  if (c.includes('bridge')) return `Bridge one small amount each week in alternating directions so the wallet has a history on both chains`;
  return `Use ${n} once a week for its ordinary purpose — a deposit, a claim, a vote or a small trade — and never in identical amounts`;
}

/**
 * A protocol's farm plan: six steps, each an action with its cost and its time, derived from
 * the protocol's own record — its category, its home chain's fee class, its size and its age.
 */
export function farmSteps(p: SnapshotProtocol, b: Breakdown): FarmStep[] {
  const chain = homeChain(p);
  const capital = capitalFor(p);
  const gas = gasUsd(chain);
  const hold = holdDaysFor(b.age_used_days);
  const secondChain = p.chains.length > 1 ? p.chains[1]! : null;
  return [
    {
      action: `Start from a fresh wallet funded only from an exchange withdrawal, and keep its seed phrase on paper, offline`,
      cost: `${gas} for the first funding transaction`,
      time: '10 minutes, once',
    },
    {
      action: coreAction(p, capital, chain),
      cost: `$${capital} of working capital plus ${gas}`,
      time: '20 minutes to set up',
    },
    {
      action: secondChain !== null
        ? `Repeat a smaller position on ${secondChain}, where ${p.name} also runs, so the wallet is visible on more than one of its chains`
        : `Open ${p.name}'s points, rewards or season page inside its own app and link this wallet there if it offers one`,
      cost: `about half the first position plus ${gasUsd(secondChain ?? chain)}`,
      time: '15 minutes',
    },
    {
      action: cadenceAction(p),
      cost: `about ${gas} a week`,
      time: '10 minutes a week',
    },
    {
      action: `Hold the position for at least ${hold} days without a full withdrawal, so the activity spans more than one weekly snapshot of the protocol`,
      cost: `the $${capital} stays deployed; the opportunity cost is the plan's real price`,
      time: `${hold} days`,
    },
    {
      action: `Keep a farm log (wallet, dates, amounts, transaction hashes) and claim any future distribution only from a link ${p.name} publishes in its own app — never from a message, a search ad or a lookalike site`,
      cost: 'nothing to keep the log; never pay a fee to claim',
      time: '5 minutes a week, and 15 minutes to unwind at the end',
    },
  ];
}

/** The live-token protocols, by market cap: the comparison set, never ranked with the board. */
export function liveRows(snapshot: Snapshot): LiveRow[] {
  return snapshot.protocols
    .filter((p) => !isPreToken(p) && p.category !== 'CEX')
    .sort((a, b) => (b.mcap_usd ?? 0) - (a.mcap_usd ?? 0) || b.tvl_usd - a.tvl_usd)
    .slice(0, LIVE_ROWS)
    .map((p) => ({
      slug: p.slug,
      name: p.name,
      category: p.category,
      chains: p.chains,
      tvl_usd: p.tvl_usd,
      mcap_usd: p.mcap_usd,
      symbol: p.symbol,
      change_7d: p.change_7d,
      mcap_tvl: p.mcap_usd !== null && p.tvl_usd > 0 ? round4(p.mcap_usd / p.tvl_usd) : null,
    }));
}

/** Everything the dashboard renders, from the snapshot. */
export function buildRadar(snapshot: Snapshot, shape: ModelShape = MODEL): { board: BoardRow[]; radar: RadarData } {
  const { board, multiples, medianAge } = buildBoard(snapshot, shape);
  const live = liveRows(snapshot);
  const watch = new Set(snapshot.watchlist);
  const categories = [...multiples.byCategory.values()].sort((a, b) => b.samples - a.samples);
  const radar: RadarData = {
    as_of: snapshot.as_of,
    source: snapshot.source,
    floor_usd: snapshot.floor_usd,
    model_version: MODEL_VERSION,
    shape,
    market_multiple: round4(multiples.market),
    market_samples: multiples.marketSamples,
    median_age_days: medianAge,
    categories,
    counts: {
      protocols: snapshot.protocols.length,
      pre_token: snapshot.protocols.filter(isPreToken).length,
      live: snapshot.protocols.filter((p) => !isPreToken(p)).length,
      watchlist: snapshot.watchlist.length,
      board: board.length,
      early: board.filter((r) => !watch.has(r.slug)).length,
    },
    rows: board,
    live,
  };
  return { board, radar };
}

/** The snapshot out of a file's text, refused unless it is the shape the model scores. */
export function parseSnapshot(text: string): Snapshot {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    throw new SnapshotError('snapshot.json is not JSON');
  }
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) throw new SnapshotError('snapshot.json is not a JSON object');
  const o = raw as Record<string, unknown>;
  if (typeof o.as_of !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(o.as_of)) throw new SnapshotError('snapshot.json has no as_of date');
  if (typeof o.source !== 'string') throw new SnapshotError('snapshot.json has no source');
  if (typeof o.floor_usd !== 'number' || !Number.isSafeInteger(o.floor_usd) || o.floor_usd <= 0) throw new SnapshotError('snapshot.json has no floor_usd');
  if (!Array.isArray(o.protocols)) throw new SnapshotError('snapshot.json has no protocols array');
  if (!Array.isArray(o.watchlist) || o.watchlist.some((s) => typeof s !== 'string')) throw new SnapshotError('snapshot.json has no watchlist of slugs');
  const protocols = o.protocols.map((v, i) => {
    if (typeof v !== 'object' || v === null || Array.isArray(v)) throw new SnapshotError(`snapshot.json's protocol ${i} is not an object`);
    const p = v as Record<string, unknown>;
    if (typeof p.slug !== 'string' || typeof p.name !== 'string' || typeof p.tvl_usd !== 'number' || !Number.isFinite(p.tvl_usd)) {
      throw new SnapshotError(`snapshot.json's protocol ${i} lacks a slug, a name or a TVL`);
    }
    return {
      slug: p.slug,
      name: p.name,
      category: typeof p.category === 'string' ? p.category : null,
      chains: Array.isArray(p.chains) ? p.chains.filter((c): c is string => typeof c === 'string') : [],
      tvl_usd: p.tvl_usd,
      change_7d: typeof p.change_7d === 'number' && Number.isFinite(p.change_7d) ? p.change_7d : null,
      mcap_usd: typeof p.mcap_usd === 'number' && Number.isFinite(p.mcap_usd) ? p.mcap_usd : null,
      listed_at: typeof p.listed_at === 'string' ? p.listed_at : null,
      gecko_id: typeof p.gecko_id === 'string' ? p.gecko_id : null,
      symbol: typeof p.symbol === 'string' ? p.symbol : null,
    };
  });
  return { as_of: o.as_of, source: o.source, floor_usd: o.floor_usd, protocols, watchlist: o.watchlist as string[] };
}

/** Why a board is not one the gate will take, or null. Mirrors the gate's board rows. */
export function boardIssue(board: BoardRow[], snapshot: Snapshot): string | null {
  if (board.length < 100 || board.length > 4000) return `the board holds ${board.length} rows, outside 100..4000`;
  const slugs = new Set(board.map((r) => r.slug));
  if (slugs.size !== board.length) return 'a slug appears twice on the board';
  const known = new Set(snapshot.protocols.map((p) => p.slug));
  for (const r of board) if (!known.has(r.slug)) return `${r.slug} is not one of the snapshot's protocols`;
  const missing = snapshot.watchlist.filter((s) => !slugs.has(s));
  if (missing.length > 0) return `the board misses ${missing.length} watchlist slugs: ${missing.slice(0, 5).join(', ')}`;
  const ranks = board.map((r) => r.rank).sort((a, b) => a - b);
  for (let i = 0; i < ranks.length; i++) if (ranks[i] !== i + 1) return `rank ${i + 1} is ${ranks[i]}`;
  const byRank = [...board].sort((a, b) => a.rank - b.rank);
  for (let i = 1; i < byRank.length; i++) {
    if (byRank[i]!.implied_value_usd > byRank[i - 1]!.implied_value_usd) return `rank ${byRank[i]!.rank} outranks rank ${byRank[i - 1]!.rank} on implied value`;
  }
  if (board.length >= 2 && byRank[0]!.implied_value_usd === byRank[byRank.length - 1]!.implied_value_usd) return 'every row shares one implied value: not a ranking';
  for (const r of board) {
    if (!Number.isSafeInteger(r.implied_value_usd) || r.implied_value_usd <= 0 || r.implied_value_usd > 100_000_000_000_000) return `${r.slug} has implied value ${r.implied_value_usd}`;
    if (r.farm_steps.length < 3 || r.farm_steps.length > 12) return `${r.slug} has ${r.farm_steps.length} farm steps`;
    for (const s of r.farm_steps) {
      const t = s.trim();
      if (t.length < 20 || t.length > 600) return `${r.slug} has a farm step of ${t.length} characters once trimmed`;
    }
  }
  return null;
}

/** A compact data.js: the dashboard's whole dataset as one script, no fetch and no network. */
export function dataScript(radar: RadarData): string {
  return `window.RADAR=${JSON.stringify(radar)};\n`;
}
