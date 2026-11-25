// Launch Radar v2 — the model.
//
// Everything on the board is derived from the sealed snapshot's own figures.
// No protocol is named in this file: categories, chains and sizes are read
// from the data, so the same code ranks any snapshot it is handed.
//
// Implied value of a pre-token protocol:
//
//   implied = TVL x category multiple x momentum x maturity x reach
//
// - category multiple: the median market-cap/TVL ratio of the snapshot's own
//   token-bearing protocols in the same category (ratios winsorised to
//   [0.005, 10] so one mispriced token cannot bend a whole category), shrunk
//   toward the global median with a prior weight of 4 samples, then clamped
//   to [0.03, 4]. A category with no token-bearing sample uses the global
//   median outright.
// - momentum: 1 + 0.35 * tanh(change_7d / 20), so a protocol whose TVL grew
//   40% in a week is marked up about a third and one that fell 40% is marked
//   down the same; a missing change_7d is neutral.
// - maturity: 1 + 0.5 * (1 - exp(-age_days / 540)), where age is the time
//   DefiLlama has tracked the protocol (listed_at to the snapshot's as_of).
//   The longer a protocol has run at size with no token, the more product
//   there is behind the eventual launch. A missing listed_at is neutral.
// - reach: 1 + 0.16 * ln(chains), capped at +45%: a protocol already live on
//   many chains has more surface for a token to be useful on.

export interface Protocol {
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

export interface Snapshot {
  as_of: string;
  source: string;
  floor_usd: number;
  protocols: Protocol[];
  watchlist: string[];
}

export interface MultipleInfo {
  category: string;
  sample: number;
  multiple: number;
}

export interface LiveRow {
  slug: string;
  name: string;
  symbol: string | null;
  category: string;
  tvl_usd: number;
  mcap_usd: number;
  ratio: number;
}

export interface BoardRow {
  slug: string;
  name: string;
  rank: number;
  implied_value_usd: number;
  farm_steps: string[];
  category: string;
  chains: string[];
  tvl_usd: number;
  change_7d: number | null;
  age_days: number | null;
  watchlist: boolean;
  multiple: number;
  factors: { momentum: number; maturity: number; reach: number };
  risk_level: 'Low' | 'Medium' | 'High';
  risk_flags: string[];
}

export interface Radar {
  rows: BoardRow[];
  live: LiveRow[];
  multiples: MultipleInfo[];
  global_multiple: number;
  pre_token_count: number;
  live_count: number;
}

const DAY_MS = 86_400_000;
const RATIO_FLOOR = 0.005;
const RATIO_CAP = 10;
const MULT_FLOOR = 0.03;
const MULT_CAP = 4;
const SHRINK_PRIOR = 4;

const clamp = (x: number, lo: number, hi: number): number => Math.min(hi, Math.max(lo, x));
const round4 = (x: number): number => Math.round(x * 10_000) / 10_000;

function median(values: number[]): number {
  const a = [...values].sort((x, y) => x - y);
  const mid = a.length >> 1;
  return a.length % 2 === 1 ? a[mid]! : (a[mid - 1]! + a[mid]!) / 2;
}

const isPreToken = (p: Protocol): boolean => p.gecko_id === null && p.symbol === null;
const categoryOf = (p: Protocol): string => (p.category === null || p.category === '' ? 'Uncategorised' : p.category);

function ageDays(p: Protocol, asOfMs: number): number | null {
  if (p.listed_at === null) return null;
  const t = Date.parse(`${p.listed_at}T00:00:00Z`);
  if (Number.isNaN(t)) return null;
  return Math.max(0, Math.round((asOfMs - t) / DAY_MS));
}

/** Median mcap/TVL per category over the token-bearing protocols, shrunk to the global median. */
function measureMultiples(snapshot: Snapshot): { byCategory: Map<string, MultipleInfo>; global: number } {
  const ratiosByCategory = new Map<string, number[]>();
  const all: number[] = [];
  for (const p of snapshot.protocols) {
    if (isPreToken(p) || p.mcap_usd === null || p.tvl_usd <= 0) continue;
    const ratio = clamp(p.mcap_usd / p.tvl_usd, RATIO_FLOOR, RATIO_CAP);
    all.push(ratio);
    const cat = categoryOf(p);
    const list = ratiosByCategory.get(cat);
    if (list) list.push(ratio);
    else ratiosByCategory.set(cat, [ratio]);
  }
  const global = median(all);
  const byCategory = new Map<string, MultipleInfo>();
  for (const [cat, ratios] of ratiosByCategory) {
    const shrunk = (ratios.length * median(ratios) + SHRINK_PRIOR * global) / (ratios.length + SHRINK_PRIOR);
    byCategory.set(cat, { category: cat, sample: ratios.length, multiple: clamp(shrunk, MULT_FLOOR, MULT_CAP) });
  }
  return { byCategory, global };
}

const momentumFactor = (change7d: number | null): number =>
  change7d === null ? 1 : 1 + 0.35 * Math.tanh(change7d / 20);

const maturityFactor = (age: number | null): number =>
  age === null ? 1 : 1 + 0.5 * (1 - Math.exp(-age / 540));

const reachFactor = (chainCount: number): number =>
  1 + Math.min(0.45, 0.16 * Math.log(Math.max(1, chainCount)));

// ---------------------------------------------------------------- risks

interface RiskInput {
  change_7d: number | null;
  age: number | null;
  chainCount: number;
  categoryPeers: number;
  category: string;
}

function riskOf(r: RiskInput): { level: BoardRow['risk_level']; flags: string[] } {
  const flags: string[] = [];
  let score = 0;
  if (r.change_7d !== null && r.change_7d <= -15) {
    flags.push(`TVL fell ${Math.abs(r.change_7d).toFixed(1)}% in 7 days — momentum is against it`);
    score += 2;
  }
  if (r.change_7d !== null && r.change_7d >= 40) {
    flags.push(`TVL up ${r.change_7d.toFixed(1)}% in 7 days — hot money can leave as fast as it came`);
    score += 1;
  }
  if (r.chainCount === 1) {
    flags.push('Single-chain protocol — one ecosystem carries the whole thesis');
    score += 1;
  }
  if (r.categoryPeers >= 25) {
    flags.push(`${r.categoryPeers} pre-token rivals in ${r.category} — a crowded launch calendar`);
    score += 1;
  }
  if (r.age !== null && r.age < 180) {
    flags.push(`Young protocol — DefiLlama has tracked it for only ${r.age} days`);
    score += 1;
  }
  if (r.change_7d === null) {
    flags.push('No 7-day TVL change reported — momentum cannot be verified');
    score += 1;
  }
  if (r.age === null) {
    flags.push('No listing date reported — its track record cannot be dated');
    score += 1;
  }
  return { level: score >= 3 ? 'High' : score >= 1 ? 'Medium' : 'Low', flags };
}

// ---------------------------------------------------------------- farm plans

/** What farming a category actually looks like: the venue action, the weekly loop, the habit. */
interface Playbook {
  deploy: string;
  loop: string;
  grow: string;
}

const PLAYBOOKS: Record<string, Playbook> = {
  Dexs: {
    deploy: 'provide liquidity to the deepest stablecoin and blue-chip pairs, keeping the position inside the active range',
    loop: 'route your own swaps through the venue and rebalance the position as ranges drift',
    grow: 'add a second pair on the same chain rather than a second wallet — depth beats breadth here',
  },
  Lending: {
    deploy: 'supply a blue-chip collateral asset and borrow a modest amount against it, staying well inside the liquidation line',
    loop: 'repay and re-borrow in small cycles and vote on gauge or market listings when governance opens',
    grow: 'open a second, smaller supply position in a different market on the same deployment',
  },
  CDP: {
    deploy: 'deposit collateral and mint a conservative amount of the protocol stablecoin, at most a third of the collateral value',
    loop: 'hold or deploy the minted stablecoin inside the same ecosystem and top collateral up when prices fall',
    grow: 'open a second vault with a different collateral type once the first has run a full month',
  },
  'CDP Manager': {
    deploy: 'deposit collateral through the manager and mint against it conservatively',
    loop: 'keep the health factor comfortably high and rebalance when collateral prices move',
    grow: 'spread a second tranche across another managed vault',
  },
  Yield: {
    deploy: 'deposit into the flagship vault that matches your base asset instead of the highest-APY outlier',
    loop: 'compound or re-deposit rewards on a fixed weekly rhythm and keep the deposit receipts',
    grow: 'ladder a second deposit into the next-largest vault so no single strategy holds everything',
  },
  'Yield Aggregator': {
    deploy: 'deposit into the largest vault for your asset and let the aggregator route it',
    loop: 'move with the aggregator when it rotates strategies instead of chasing each rotation yourself',
    grow: 'add the same asset on a second chain deployment of the aggregator',
  },
  Bridge: {
    deploy: 'bridge a working balance across the busiest supported route and back, keeping funds on both sides',
    loop: 'make one genuine cross-chain transfer a week in each direction, varying the routes you actually use',
    grow: 'add a second corridor, ideally to a chain where you already hold farm positions',
  },
  'Canonical Bridge': {
    deploy: 'bridge native assets to the chain through the canonical route and put a part of them to work there',
    loop: 'use the chain weekly — swaps, a small LP or a lending deposit — so the bridged balance is not idle',
    grow: 'bridge a second asset class once the first route has a month of history',
  },
  'Cross Chain Bridge': {
    deploy: 'bridge a working balance across the busiest supported route and back',
    loop: 'make one genuine transfer a week in each direction on routes you actually need',
    grow: 'add a second corridor to a chain where you already farm',
  },
  Derivatives: {
    deploy: 'open small, fully collateralised positions in the most liquid market — size for learning the venue, not for profit',
    loop: 'trade a few times a week with tight size and keep a log of fills, fees and funding paid',
    grow: 'add the second most liquid market once the first has a month of steady activity',
  },
  'Interest Rate Derivatives': {
    deploy: 'take a small fixed-rate position against a floating market you already lend in',
    loop: 'roll the position at each expiry and record the spread you captured',
    grow: 'add a position on a second underlying rate market',
  },
  'Liquid Staking': {
    deploy: 'stake a working amount of the base asset through the protocol and hold the liquid receipt token',
    loop: 'use the receipt token in one lending or LP position so the stake is visibly active, not idle',
    grow: 'stake a second tranche on the protocol’s other supported chain if it has one',
  },
  'Liquid Restaking': {
    deploy: 'restake a small amount of liquid staking tokens and choose the conservative operator set',
    loop: 'claim and re-deposit rewards on a weekly rhythm and watch operator changes',
    grow: 'add a second restaking vault only after the first has run a full rewards cycle',
  },
  Restaking: {
    deploy: 'delegate or restake a small amount and pick the most established operators',
    loop: 'claim rewards weekly and re-delegate rather than letting them sit',
    grow: 'spread a second tranche across another operator set',
  },
  'Restaked BTC': {
    deploy: 'deposit a small amount of BTC or its wrapped form into the restaking vault',
    loop: 'keep the position untouched except for monthly reward claims — churn earns nothing here',
    grow: 'add a second tranche only after one full reward epoch has paid out',
  },
  'Staking Pool': {
    deploy: 'stake through the pool with a working amount and keep the receipt',
    loop: 'compound staking rewards monthly and keep validator performance notes',
    grow: 'stake a second asset the pool supports once the first position is seasoned',
  },
  'Basis Trading': {
    deploy: 'open the flagship basis position with a modest tranche and read the funding terms before sizing up',
    loop: 'check the position weekly; basis trades are managed by exception, not by tinkering',
    grow: 'add a second tranche only after a full funding cycle has settled',
  },
  'Leveraged Farming': {
    deploy: 'open the most conservative leverage loop on offer — leverage at the lowest setting, never the maximum',
    loop: 'check the health factor twice a week and deleverage into volatility instead of topping up blindly',
    grow: 'add a second loop on a different pair only after a month of stable health',
  },
  RWA: {
    deploy: 'buy the flagship tokenised asset in a small, hold-sized amount after reading its attestation page',
    loop: 'hold and collect the yield distributions; activity here is patience, plus keeping KYC records current',
    grow: 'add a second asset class (a different issuer or collateral type) rather than more of the same',
  },
  CEX: {
    deploy: 'open an account, complete verification and make a first spot trade in a liquid pair',
    loop: 'trade modest spot volume weekly and use one extra product (earn, convert or card) so the account is genuinely active',
    grow: 'add a small recurring buy so the account shows a steady, human pattern',
  },
  CeDeFi: {
    deploy: 'deposit a working amount into the flagship earn product after reading its custody terms',
    loop: 'keep the position and claim yield on schedule; check the attestation or reserve reports monthly',
    grow: 'add a second product with a different term once the first matures cleanly',
  },
  'Risk Curators': {
    deploy: 'deposit into the largest curated vault whose curator publishes its methodology, not the highest-yield one',
    loop: 'read the curator’s reallocation notes weekly and follow material moves with a day’s delay',
    grow: 'split a second tranche across a vault run by a different curator',
  },
  'Onchain Capital Allocator': {
    deploy: 'deposit into the flagship allocation vault and read what it currently holds before sizing',
    loop: 'track allocation changes weekly and keep your deposit through at least one full rebalance',
    grow: 'add a second strategy sleeve once the first has a full quarter of history',
  },
  'Liquidity Manager': {
    deploy: 'deposit into the flagship managed range position on the busiest pair',
    loop: 'let the manager rebalance; your job is a weekly check that fees earned beat the impermanent loss',
    grow: 'add a second pair with a different volatility profile',
  },
  Chain: {
    deploy: 'bridge a working balance to the chain and make it your home for one ecosystem farm this month',
    loop: 'use two or three native apps weekly — a swap, a lend, a small LP — so the address has a real footprint',
    grow: 'fund a second native app position rather than a second address',
  },
  'Options Vault': {
    deploy: 'deposit into the flagship covered-call or put-selling vault with a hold-sized amount',
    loop: 'roll with the vault’s weekly epoch and record the premium collected each round',
    grow: 'add the vault on the second underlying asset once one epoch cycle is understood',
  },
  'Prediction Market': {
    deploy: 'fund a small trading balance and take positions only in markets you actually follow',
    loop: 'trade a few markets a week at small size and keep a record of your calibration',
    grow: 'add a second market category once your first has settled outcomes',
  },
  Insurance: {
    deploy: 'buy cover on a position you genuinely hold elsewhere, sized to that position',
    loop: 'renew cover at expiry; the farming value here is a real, continuous policy history',
    grow: 'add cover for a second protocol position you hold',
  },
  'OTC Marketplace': {
    deploy: 'list or take a small order in the most liquid market to learn the settlement flow',
    loop: 'complete a small trade every week or two and keep settlement records',
    grow: 'raise size gradually on the same market rather than spreading thin',
  },
  Payments: {
    deploy: 'set up the wallet or account and make a first real payment or transfer through it',
    loop: 'route one genuine payment a week through it — rent, a subscription, a transfer to a friend',
    grow: 'add a second payment rail or currency once the first is routine',
  },
  'Crypto Card Issuer': {
    deploy: 'order the card if your region is served, load a working balance and make a first purchase',
    loop: 'use the card for ordinary weekly spending; a natural pattern is the whole strategy',
    grow: 'move one recurring bill onto the card',
  },
  Farm: {
    deploy: 'deposit into the flagship farm pool paired with a stablecoin to cap impermanent loss',
    loop: 'harvest and re-deposit rewards weekly on the same day',
    grow: 'add the second-largest farm pool once the first has run a month',
  },
  Indexes: {
    deploy: 'buy the flagship index product in a hold-sized amount',
    loop: 'hold through rebalances and add on a fixed monthly schedule',
    grow: 'add a second index with a different theme',
  },
  Privacy: {
    deploy: 'make a small deposit into the flagship privacy pool and keep the note or credential safe',
    loop: 'make an occasional genuine private transfer; dormant-but-real beats busy-and-fake',
    grow: 'add a second asset pool once the first flow is familiar',
  },
  'Anchor BTC': {
    deploy: 'deposit a small amount of BTC collateral into the flagship market',
    loop: 'keep the position and check collateral ratios monthly',
    grow: 'add a second tranche after one full month of stable operation',
  },
  'Decentralized BTC': {
    deploy: 'bridge a small amount of BTC across and hold the decentralised representation',
    loop: 'use the BTC position in one lending or LP market so it is visibly working',
    grow: 'add a second chain route once the first has settled history',
  },
  'Dual-Token Stablecoin': {
    deploy: 'mint or buy a small amount of the stablecoin against its collateral token',
    loop: 'hold both legs and rebalance when the peg drifts from parity',
    grow: 'add the LP position for the pair once you understand the mint mechanics',
  },
  'Stablecoin Wrapper': {
    deploy: 'wrap a small amount of the underlying stablecoin and hold the wrapped form',
    loop: 'keep the wrapped balance in one yield position inside the same ecosystem',
    grow: 'add a second tranche after the first yield cycle pays',
  },
  'Collateral Markets': {
    deploy: 'supply a blue-chip collateral asset to the flagship market',
    loop: 'keep utilisation healthy and claim any supply incentives weekly',
    grow: 'supply a second collateral type once the first market is seasoned',
  },
  'Governance Incentives': {
    deploy: 'acquire and lock the governance position the program rewards, at the smallest tier that counts',
    loop: 'vote on every proposal while locked — an unbroken voting record is the signal',
    grow: 'extend the lock once rather than splitting across wallets',
  },
  'Uncollateralized Lending': {
    deploy: 'lend a small amount to the highest-rated pool after reading its underwriting notes',
    loop: 'track pool reports monthly; uncollateralised lending is monitored, not churned',
    grow: 'add a second pool with a different borrower profile',
  },
};

const DEFAULT_PLAYBOOK: Playbook = {
  deploy: 'make a first real deposit or position in the flagship product, sized to learn the flow rather than to chase yield',
  loop: 'use the core product on a fixed weekly rhythm and keep records of every action',
  grow: 'deepen the same position or add the protocol’s second product before opening anything new',
};

/** Gas reality per chain, so a plan can say what its steps cost. */
function gasClass(chain: string): { label: string; perTx: string; reserve: string } {
  if (chain === 'Ethereum') return { label: 'Ethereum mainnet', perTx: '$5–$25 per transaction', reserve: '$60 of ETH' };
  if (chain === 'Solana') return { label: 'Solana', perTx: 'under $0.05 per transaction', reserve: '$5 of SOL' };
  if (chain === 'Binance') return { label: 'BNB Chain', perTx: '$0.10–$0.50 per transaction', reserve: '$10 of BNB' };
  const l2 = ['Base', 'Arbitrum', 'Optimism', 'Linea', 'Scroll', 'zkSync Era', 'Mantle', 'Blast', 'Mode', 'Taiko', 'Zircuit', 'Fraxtal', 'Ink', 'Lisk', 'Soneium', 'Unichain', 'World Chain', 'Polygon', 'Metis', 'Manta', 'Arbitrum Nova', 'BOB', 'Swellchain', 'Katana', 'Sophon', 'Polygon zkEVM'];
  if (l2.includes(chain)) return { label: `${chain} (an Ethereum layer-2)`, perTx: '$0.05–$0.60 per transaction', reserve: '$15 of ETH' };
  return { label: chain, perTx: '$0.20–$3 per transaction', reserve: '$20 of the chain’s gas token' };
}

function depositTier(tvl: number): string {
  if (tvl >= 500_000_000) return '$2,000–$10,000 as a core position';
  if (tvl >= 100_000_000) return '$750–$3,000';
  if (tvl >= 25_000_000) return '$300–$1,200';
  return '$75–$400 as a test position';
}

const money = (n: number): string =>
  n >= 1_000_000_000 ? `$${(n / 1_000_000_000).toFixed(2)}B` : n >= 1_000_000 ? `$${(n / 1_000_000).toFixed(1)}M` : `$${Math.round(n / 1_000)}K`;

function farmSteps(p: Protocol, category: string): string[] {
  const book = PLAYBOOKS[category] ?? DEFAULT_PLAYBOOK;
  const chain1 = p.chains[0] ?? 'its main chain';
  const chain2 = p.chains[1];
  const gas = gasClass(chain1);
  const size = depositTier(p.tvl_usd);
  const steps = [
    `Set up: open ${p.name} from its official site, connect a fresh wallet on ${gas.label} and fund it with the position size below plus ${gas.reserve} for gas. Allow about 20 minutes; the only cost is ${gas.perTx} and any bridge fee in.`,
    `Deploy ${size}: ${book.deploy}. ${p.name} holds ${money(p.tvl_usd)} of TVL, so this size is meaningful without being the market. Budget ${gas.perTx} for the deposit transactions.`,
    `Work it weekly: ${book.loop}. Set aside 15–30 minutes a week; at ${gas.perTx}, a month of steady activity costs roughly four to twelve transactions of gas.`,
    chain2
      ? `Expand: ${book.grow}. ${p.name} also runs on ${chain2} — a smaller position there (a quarter of the main one) shows the multi-chain footprint these launches tend to reward.`
      : `Expand in place: ${book.grow}. ${p.name} runs only on ${chain1}, so depth on that one deployment is the whole play — do not split across wallets.`,
    `Track eligibility: every week, check ${p.name}’s points, quests and governance pages and screenshot your balances and this week’s transactions. Ten minutes a week buys a verifiable record if a snapshot or claim window is announced.`,
    `Be launch-ready: hold the position rather than exiting into rumours, and keep ${gas.reserve} untouched on ${gas.label}. If ${p.name} announces a token, claim only through the official announcement — claim-day gas can spike to several times the usual ${gas.perTx}.`,
  ];
  return steps;
}

// ---------------------------------------------------------------- the radar

export function buildRadar(snapshot: Snapshot): Radar {
  const asOfMs = Date.parse(`${snapshot.as_of}T00:00:00Z`);
  const watch = new Set(snapshot.watchlist);
  const { byCategory, global } = measureMultiples(snapshot);

  const pre = snapshot.protocols.filter(isPreToken);
  const peers = new Map<string, number>();
  for (const p of pre) peers.set(categoryOf(p), (peers.get(categoryOf(p)) ?? 0) + 1);

  const scored = pre.map((p) => {
    const category = categoryOf(p);
    const multiple = byCategory.get(category)?.multiple ?? global;
    const age = ageDays(p, asOfMs);
    const factors = {
      momentum: momentumFactor(p.change_7d),
      maturity: maturityFactor(age),
      reach: reachFactor(p.chains.length),
    };
    const implied = Math.max(1, Math.round(p.tvl_usd * multiple * factors.momentum * factors.maturity * factors.reach));
    const risk = riskOf({ change_7d: p.change_7d, age, chainCount: p.chains.length, categoryPeers: peers.get(category) ?? 0, category });
    return { p, category, multiple, age, factors, implied, risk };
  });

  scored.sort((a, b) => b.implied - a.implied || b.p.tvl_usd - a.p.tvl_usd || (a.p.slug < b.p.slug ? -1 : 1));

  const rows: BoardRow[] = scored.map((s, i) => ({
    slug: s.p.slug,
    name: s.p.name,
    rank: i + 1,
    implied_value_usd: s.implied,
    farm_steps: farmSteps(s.p, s.category),
    category: s.category,
    chains: s.p.chains,
    tvl_usd: s.p.tvl_usd,
    change_7d: s.p.change_7d,
    age_days: s.age,
    watchlist: watch.has(s.p.slug),
    multiple: round4(s.multiple),
    factors: { momentum: round4(s.factors.momentum), maturity: round4(s.factors.maturity), reach: round4(s.factors.reach) },
    risk_level: s.risk.level,
    risk_flags: s.risk.flags,
  }));

  const live: LiveRow[] = snapshot.protocols
    .filter((p) => !isPreToken(p))
    .map((p) => ({
      slug: p.slug,
      name: p.name,
      symbol: p.symbol,
      category: categoryOf(p),
      tvl_usd: p.tvl_usd,
      mcap_usd: p.mcap_usd ?? 0,
      ratio: p.mcap_usd !== null && p.tvl_usd > 0 ? round4(clamp(p.mcap_usd / p.tvl_usd, RATIO_FLOOR, RATIO_CAP)) : 0,
    }))
    .sort((a, b) => b.mcap_usd - a.mcap_usd || (a.slug < b.slug ? -1 : 1));

  const multiples = [...byCategory.values()]
    .map((m) => ({ category: m.category, sample: m.sample, multiple: round4(m.multiple) }))
    .sort((a, b) => b.sample - a.sample || (a.category < b.category ? -1 : 1));

  return { rows, live, multiples, global_multiple: round4(global), pre_token_count: pre.length, live_count: live.length };
}
