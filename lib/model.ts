// Token Launch Radar — the model.
//
// Reads the sealed DefiLlama snapshot and answers one question: which protocols
// that still record no token are worth a farmer's time, what would a launch be
// worth if the record stayed as it is, and what exactly to do about each one.
//
// The value model is built only from the snapshot's own figures:
//   implied value = TVL x category multiple x momentum x seasoning
// - category multiple: the median market-cap / TVL ratio of the protocols in
//   the same DefiLlama category whose token already trades, shrunk toward the
//   global median when a category has few traded tokens, and clamped so one
//   odd category cannot blow up a board.
// - momentum: the protocol's 7-day TVL change, clamped, worth at most +-15%.
// - seasoning: how long the protocol has run with no token recorded, on a
//   square-root curve over five years, worth 0.95x to 1.30x.
// Nothing is keyed to a protocol's name: run the same code on a later snapshot
// and the board rebuilds itself. That is the point of a radar.

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

export interface BoardRow {
  slug: string;
  name: string;
  rank: number;
  implied_value_usd: number;
  farm_steps: string[];
}

export interface RadarRow extends BoardRow {
  category: string | null;
  chains: string[];
  tvl_usd: number;
  change_7d: number | null;
  listed_at: string | null;
  age_days: number | null;
  multiple: number;
  momentum_factor: number;
  seasoning_factor: number;
  radar_score: number;
  on_watchlist: boolean;
}

export interface Radar {
  as_of: string;
  floor_usd: number;
  scanned: number;
  live_size: number;
  early_size: number;
  watchlist_size: number;
  aggregate_implied_usd: number;
  global_multiple: number;
  multiples: { category: string; multiple: number; samples: number }[];
  rows: RadarRow[];
}

export function parseSnapshot(text: string): Snapshot {
  const raw = JSON.parse(text) as Snapshot;
  if (!Array.isArray(raw.protocols) || !Array.isArray(raw.watchlist)) {
    throw new Error('snapshot: protocols and watchlist must be arrays');
  }
  return raw;
}

// ---------------------------------------------------------------------------
// Who is a candidate at all: records no token, and is not a wrapped, staked,
// bridged or versioned product of a protocol whose token already trades. The
// rule mirrors the field guide's watchlist rule, applied to every protocol in
// the snapshot rather than only those above the floor.

const PRODUCT_CATEGORIES = new Set([
  'Bridge',
  'Canonical Bridge',
  'Liquid Staking',
  'Liquid Restaking',
  'Restaked BTC',
  'CEX',
]);
const VERSION_SUFFIX = /\s(V\d+(\.\d+)?|v\d+(\.\d+)?|\d+\.\d+)$/;
const EXCHANGE_PREFIX = /^(Binance|Coinbase|Bybit|Kraken|Bitget|OKX|Bitfinex|Gemini)\b/;
const WRAPPED_WORD = /\b(wrapped|staked|staking)\b/i;

export function recordsNoToken(p: Protocol): boolean {
  return p.gecko_id === null && p.symbol === null;
}

export function isProductOfTraded(p: Protocol): boolean {
  if (p.category !== null && PRODUCT_CATEGORIES.has(p.category)) return true;
  if (VERSION_SUFFIX.test(p.name)) return true;
  if (EXCHANGE_PREFIX.test(p.name)) return true;
  if (WRAPPED_WORD.test(p.name)) return true;
  return false;
}

// ---------------------------------------------------------------------------
// Category multiples from the protocols whose tokens already trade.

function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1 ? sorted[mid]! : (sorted[mid - 1]! + sorted[mid]!) / 2;
}

const MULTIPLE_MIN = 0.03;
const MULTIPLE_MAX = 3;
const SHRINK_WEIGHT = 4; // pseudo-samples of the global median blended into each category

export function categoryMultiples(snapshot: Snapshot): Map<string, { multiple: number; samples: number }> {
  const ratios = new Map<string, number[]>();
  const all: number[] = [];
  for (const p of snapshot.protocols) {
    if (p.mcap_usd !== null && p.mcap_usd > 0 && p.tvl_usd > 0) {
      const ratio = p.mcap_usd / p.tvl_usd;
      const key = p.category ?? 'Uncategorised';
      const list = ratios.get(key) ?? [];
      list.push(ratio);
      ratios.set(key, list);
      all.push(ratio);
    }
  }
  const globalMedian = median(all);
  const out = new Map<string, { multiple: number; samples: number }>();
  for (const [key, list] of ratios) {
    const shrunk = (list.length * median(list) + SHRINK_WEIGHT * globalMedian) / (list.length + SHRINK_WEIGHT);
    out.set(key, { multiple: Math.min(MULTIPLE_MAX, Math.max(MULTIPLE_MIN, shrunk)), samples: list.length });
  }
  out.set('*', { multiple: globalMedian, samples: all.length });
  return out;
}

// ---------------------------------------------------------------------------
// The factors.

export function momentumFactor(change7d: number | null): number {
  if (change7d === null) return 1;
  const clamped = Math.max(-30, Math.min(30, change7d));
  return 1 + clamped / 200;
}

const SEASONING_SPAN_DAYS = 1825; // five years to full seasoning

export function ageDays(listedAt: string | null, asOf: string): number | null {
  if (listedAt === null) return null;
  const days = Math.round((Date.parse(asOf) - Date.parse(listedAt)) / 86_400_000);
  return Number.isFinite(days) && days >= 0 ? days : null;
}

export function seasoningFactor(age: number | null): number {
  if (age === null) return 1.05; // unrecorded start: treat as middling, not new
  return 0.95 + 0.35 * Math.sqrt(Math.min(age, SEASONING_SPAN_DAYS) / SEASONING_SPAN_DAYS);
}

// ---------------------------------------------------------------------------
// Farm plans. One playbook per protocol family, parameterised with the
// protocol's own name, cheapest chain, size tier and record, so every plan
// names real actions, real costs and real durations instead of slogans.

const CHEAP_CHAINS = [
  'Base', 'Arbitrum', 'Optimism', 'Polygon', 'zkSync Era', 'Linea', 'Scroll',
  'Solana', 'Binance', 'Avalanche', 'Mantle', 'Sonic', 'Blast', 'Mode',
  'xDai', 'Celo', 'Metis', 'Fantom',
];

export function workingChain(p: Protocol): string {
  for (const cheap of CHEAP_CHAINS) if (p.chains.includes(cheap)) return cheap;
  return p.chains[0] ?? 'Ethereum';
}

function gasNote(chain: string): string {
  if (chain === 'Solana') return 'fees of a cent or two per transaction';
  if (chain === 'Ethereum') return 'mainnet gas of roughly $2-$10 a transaction, cheapest on weekend mornings UTC';
  return `gas of roughly $0.05-$0.50 a transaction on ${chain}`;
}

function capitalTier(tvl: number): string {
  if (tvl >= 250_000_000) return '$1,000-$5,000';
  if (tvl >= 50_000_000) return '$500-$2,000';
  if (tvl >= 15_000_000) return '$250-$1,000';
  return '$100-$500';
}

type Family = 'dex' | 'lending' | 'curator' | 'yield' | 'derivatives' | 'rwa' | 'cdp' | 'chain' | 'general';

function familyOf(category: string | null): Family {
  switch (category) {
    case 'Dexs': return 'dex';
    case 'Lending': case 'Uncollateralized Lending': return 'lending';
    case 'Risk Curators': case 'Onchain Capital Allocator': case 'Liquidity Manager': case 'CDP Manager': return 'curator';
    case 'Yield': case 'Yield Aggregator': case 'Leveraged Farming': case 'Farm': case 'Basis Trading': return 'yield';
    case 'Derivatives': case 'Prediction Market': return 'derivatives';
    case 'RWA': return 'rwa';
    case 'CDP': case 'Dual-Token Stablecoin': return 'cdp';
    case 'Chain': return 'chain';
    default: return 'general';
  }
}

const CORE_STEPS: Record<Family, [string, string]> = {
  dex: [
    'Provide liquidity in {name}\'s two deepest pools on {chain}: start with a stable or blue-chip pair so impermanent loss stays small, and keep the position open rather than hopping pools.',
    'Route your regular swaps through {name} itself instead of an aggregator default, a few trades a week, so your wallet builds a real history of volume on the protocol.',
  ],
  lending: [
    'Supply a blue-chip asset (ETH or a major stablecoin) to {name} on {chain} and leave it supplied: lenders who stay through quiet weeks are the record a points or launch snapshot reads.',
    'Borrow a modest amount against your supply, at most a third of what the position allows, repay within days, and repeat monthly so both sides of the market show your address.',
  ],
  curator: [
    'Deposit into one of {name}\'s curated vaults on {chain} and hold the vault shares: curators reward the depositors whose capital stays while the vault compounds.',
    'Split a second, smaller deposit across a different vault or market of {name} so your history is not a single deposit on a single day, and rebalance only when a vault closes.',
  ],
  yield: [
    'Deposit a stablecoin or ETH position into {name} on {chain} and keep it there: yield protocols read loyalty from time-weighted balances, not from deposit size alone.',
    'Claim and re-deposit whatever {name} pays out, on a weekly rhythm, so the compounding is visible on-chain and your balance never sits idle in the wallet.',
  ],
  derivatives: [
    'Trade small, deliberate size on {name} from {chain}: open and close a few positions a week with tight risk, aiming for consistent volume rather than one large trade.',
    'Keep a margin balance parked on {name} between trades and vary your markets and hours, the pattern of a genuine user rather than a single farmed burst.',
  ],
  rwa: [
    'Complete whatever onboarding {name} asks for (an account, and KYC where its terms require it) and make a first purchase of its tokenised asset from {chain}.',
    'Hold the position and add on a monthly cadence rather than trading in and out: real-world-asset protocols read holding time, and a launch rewards the holders of record.',
  ],
  cdp: [
    'Open a collateral position on {name} from {chain}: deposit ETH or a liquid staking token and mint a conservative amount of its stablecoin, well inside the liquidation line.',
    'Use the minted stablecoin inside the same ecosystem (a pool or a lending market {name} points to) and keep the position open, topping up collateral whenever markets fall.',
  ],
  chain: [
    'Bridge a working balance to {name} and keep it there: a chain reads bridged-and-staying capital as commitment, so do not round-trip the funds back out.',
    'Use two or three of the chain\'s own applications each week (a swap, a lending market, a name or NFT mint) so your address shows breadth, not one repeated action.',
  ],
  general: [
    'Make {name}\'s core action from {chain} with your working capital and repeat it on a weekly rhythm: whatever the protocol measures, a steady history is what it can reward.',
    'Take part in the second thing {name} offers (a second market, vault, pool or product line) so your address is a user of the protocol, not of one button.',
  ],
};

export function farmSteps(p: Protocol): string[] {
  const chain = workingChain(p);
  const fill = (s: string) => s.replaceAll('{name}', p.name).replaceAll('{chain}', chain);
  const [coreA, coreB] = CORE_STEPS[familyOf(p.category)].map(fill);
  const steps = [
    fill(
      `Set up one wallet for {name} and fund it on ${chain} with ${capitalTier(p.tvl_usd)} of working capital plus gas (${gasNote(chain)}); keep this wallet for this protocol alone so its history stays clean. One evening, about 30 minutes.`,
    ),
    coreA,
    coreB,
    fill(
      `Hold the rhythm for 8 to 12 weeks: one or two actions a week on {name}, never a single-day burst, and screenshot your balances monthly; time in the protocol is the cheapest signal there is. About 15 minutes a week.`,
    ),
    fill(
      `Cap the risk before you start: never more than you can leave untouched for six months, watch {name}'s own announcements for points, quests or a snapshot date, and wind down within a week if the team rules a token out in writing.`,
    ),
  ];
  return steps.filter((s) => s.trim().length >= 20 && s.trim().length <= 600);
}

// ---------------------------------------------------------------------------
// Build the board and the dashboard's data.

export function buildRadar(snapshot: Snapshot): { board: BoardRow[]; radar: Radar } {
  const multiples = categoryMultiples(snapshot);
  const global = multiples.get('*')!;
  const watchlist = new Set(snapshot.watchlist);
  const asOf = snapshot.as_of;

  const candidates = snapshot.protocols.filter((p) => recordsNoToken(p) && !isProductOfTraded(p));

  const logs = candidates.map((p) => Math.log10(Math.max(p.tvl_usd, 1)));
  const logMin = Math.min(...logs);
  const logMax = Math.max(...logs);

  const scored = candidates.map((p) => {
    const entry = multiples.get(p.category ?? 'Uncategorised');
    const multiple = entry ? entry.multiple : global.multiple;
    const momentum = momentumFactor(p.change_7d);
    const age = ageDays(p.listed_at, asOf);
    const seasoning = seasoningFactor(age);
    const implied = Math.max(1, Math.round(p.tvl_usd * multiple * momentum * seasoning));
    const tScore = logMax > logMin ? (Math.log10(Math.max(p.tvl_usd, 1)) - logMin) / (logMax - logMin) : 0;
    const mScore = (momentum - 0.85) / 0.3;
    const sScore = (seasoning - 0.95) / 0.35;
    const bScore = Math.min(p.chains.length, 10) / 10;
    const radarScore = Math.max(0, Math.min(100, Math.round(100 * (0.45 * tScore + 0.2 * mScore + 0.2 * sScore + 0.15 * bScore))));
    return { p, multiple, momentum, seasoning, age, implied, radarScore };
  });

  scored.sort((a, b) => b.implied - a.implied || b.p.tvl_usd - a.p.tvl_usd || (a.p.slug < b.p.slug ? -1 : 1));

  const rows: RadarRow[] = [];
  let previous = Number.POSITIVE_INFINITY;
  scored.forEach((s, i) => {
    const value = Math.max(1, Math.min(s.implied, previous - 1));
    previous = value;
    rows.push({
      slug: s.p.slug,
      name: s.p.name,
      rank: i + 1,
      implied_value_usd: value,
      farm_steps: farmSteps(s.p),
      category: s.p.category,
      chains: s.p.chains,
      tvl_usd: s.p.tvl_usd,
      change_7d: s.p.change_7d,
      listed_at: s.p.listed_at,
      age_days: s.age,
      multiple: Math.round(s.multiple * 1000) / 1000,
      momentum_factor: Math.round(s.momentum * 1000) / 1000,
      seasoning_factor: Math.round(s.seasoning * 1000) / 1000,
      radar_score: s.radarScore,
      on_watchlist: watchlist.has(s.p.slug),
    });
  });

  const board: BoardRow[] = rows.map((r) => ({
    slug: r.slug,
    name: r.name,
    rank: r.rank,
    implied_value_usd: r.implied_value_usd,
    farm_steps: r.farm_steps,
  }));

  const multipleTable = [...multiples.entries()]
    .filter(([key]) => key !== '*')
    .map(([category, v]) => ({ category, multiple: Math.round(v.multiple * 1000) / 1000, samples: v.samples }))
    .sort((a, b) => b.samples - a.samples || (a.category < b.category ? -1 : 1));

  const radar: Radar = {
    as_of: asOf,
    floor_usd: snapshot.floor_usd,
    scanned: snapshot.protocols.length,
    live_size: snapshot.protocols.length - candidates.length,
    early_size: rows.filter((r) => r.tvl_usd < snapshot.floor_usd).length,
    watchlist_size: snapshot.watchlist.length,
    aggregate_implied_usd: rows.reduce((sum, r) => sum + r.implied_value_usd, 0),
    global_multiple: Math.round(global.multiple * 1000) / 1000,
    multiples: multipleTable,
    rows,
  };
  return { board, radar };
}

// ---------------------------------------------------------------------------
// A local copy of the gate's board rules, so the program refuses a bad board
// before it hands one in.

export function boardIssue(board: BoardRow[], snapshot: Snapshot): string | null {
  if (board.length < 100 || board.length > 4000) return `board holds ${board.length} rows, outside 100-4000`;
  const known = new Set(snapshot.protocols.map((p) => p.slug));
  const seen = new Set<string>();
  for (const row of board) {
    if (!known.has(row.slug)) return `row names a protocol the snapshot does not: ${row.slug}`;
    if (seen.has(row.slug)) return `slug appears twice: ${row.slug}`;
    seen.add(row.slug);
    if (!row.name) return `row ${row.slug} has an empty name`;
    if (!Number.isInteger(row.implied_value_usd) || row.implied_value_usd <= 0 || row.implied_value_usd > 100_000_000_000_000) {
      return `row ${row.slug} has an implied value outside the gate's range`;
    }
    if (row.farm_steps.length < 3 || row.farm_steps.length > 12) return `row ${row.slug} holds ${row.farm_steps.length} farm steps`;
    for (const step of row.farm_steps) {
      const len = step.trim().length;
      if (len < 20 || len > 600) return `row ${row.slug} holds a farm step of ${len} characters`;
    }
  }
  for (const slug of snapshot.watchlist) if (!seen.has(slug)) return `watchlist protocol missing from the board: ${slug}`;
  const byRank = [...board].sort((a, b) => a.rank - b.rank);
  for (let i = 0; i < byRank.length; i++) {
    const row = byRank[i]!;
    if (row.rank !== i + 1) return `ranks are not exactly 1..N at rank ${row.rank}`;
    if (i > 0 && row.implied_value_usd > byRank[i - 1]!.implied_value_usd) return `implied value rises at rank ${row.rank}`;
  }
  if (new Set(board.map((r) => r.implied_value_usd)).size === 1) return 'every implied value is the same';
  return null;
}

export function dataScript(radar: Radar): string {
  return `window.RADAR_DATA = ${JSON.stringify(radar)};\n`;
}
