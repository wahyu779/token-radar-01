// Token Radar v3 — the model, fitted at runtime from the snapshot.
//
// The claim: a protocol with no token recorded is worth what a token of its
// size usually is. Size is TVL; "usually" is the live market of 128 tokens
// that do record one. The fit is ordinary least squares on log10(mcap) over
// log10(TVL), refit from the snapshot on every run — no constant in here is
// a number typed from a paper. Category offsets are the median residual of
// each category, shrunk toward zero with k = 20. Three small terms nudge the
// curve for what the bounty names: a week of TVL growth, how long the
// protocol has run, and how many chains it spans. The ranked value is the
// curve value times the category's launch share — the expected value, not
// the value if a token appears.
//
//   curve  = 10 ^ (a + b * log10(TVL) + off_c) * g * m * d
//   ranked = round(curve * p_ref)
//
//   a, b   OLS on the 128 live tokens, refit each run
//   off_c  n_c * median(residual in c) / (n_c + 20), 0 with no live token
//   g      1 + clamp(change_7d, -60, 120) / 100 * 0.25
//   m      0.8 + min(age_days, 1095) / 1095 * 0.2 (age unknown: 365 days)
//   d      1 + 0.01 * min(chains - 1, 5)
//   p_ref  share of the category that already records a token
//
// The band comes from leave-one-out errors on the same fit: the 10th and
// 90th percentiles of the log10 error, as multipliers on the ranked value.

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
  floor_usd: number;
  protocols: Protocol[];
  watchlist: string[];
}

// ---------------------------------------------------------------- the house rule

// The snapshot's own watchlist rule, written out in competition.yaml: the
// category is none of these, the name ends in no version marker, carries no
// whole word wrapped / staked / staking, and begins with no exchange name.
export const EXCLUDED_CATEGORIES = new Set([
  "bridge",
  "canonical bridge",
  "liquid staking",
  "liquid restaking",
  "restaked btc",
  "cex",
]);
export const VERSION_MARKER = /\s(V\d+(\.\d+)?|v\d+(\.\d+)?|\d+\.\d+)$/;
export const WRAPPED_WORD = /\b(wrapped|staked|staking)\b/i;
export const EXCHANGE_PREFIXES = [
  "binance",
  "coinbase",
  "bybit",
  "kraken",
  "bitget",
  "okx",
  "bitfinex",
  "gemini",
];

export function hasToken(p: Protocol): boolean {
  return p.gecko_id !== null || p.symbol !== null;
}

// Why a protocol with no token recorded is set aside, or null when it is
// rankable. Category first, then the name's version marker, then a wrapped
// or staked word, then an exchange prefix — in that order, so the ledger
// buckets below are stable.
export function exclusionReason(p: Protocol): string | null {
  const c = (p.category ?? "").toLowerCase();
  if (c === "bridge" || c === "canonical bridge") return "bridge";
  if (c === "liquid staking" || c === "liquid restaking" || c === "restaked btc")
    return "liquid-staking";
  if (c === "cex") return "exchange-custody";
  if (VERSION_MARKER.test(p.name)) return "versioned";
  if (WRAPPED_WORD.test(p.name)) return "wrapped";
  const lo = p.name.toLowerCase();
  if (EXCHANGE_PREFIXES.some((x) => lo.startsWith(x))) return "exchange-custody";
  return null;
}

export function isRankable(p: Protocol): boolean {
  return !hasToken(p) && exclusionReason(p) === null;
}

// ---------------------------------------------------------------- small helpers

export function median(xs: number[]): number {
  const s = [...xs].sort((a, b) => a - b);
  const n = s.length;
  if (n === 0) return 0;
  return n % 2 === 1 ? s[(n - 1) / 2]! : (s[n / 2 - 1]! + s[n / 2]!) / 2;
}

export function quantile(xs: number[], q: number): number {
  // Nearest-rank quantile, Lane B's convention: the lower quantiles take the
  // sorted error at index floor(q * n), the upper at floor(q * n) - 1.
  const s = [...xs].sort((a, b) => a - b);
  if (s.length === 0) return 0;
  return q < 0.5
    ? s[Math.floor(q * s.length)]!
    : s[Math.floor(q * s.length) - 1]!;
}

export function clamp(x: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, x));
}

// Ordinary least squares for y ~ a + b * x, closed form on two parameters.
export function ols2(xs: number[], ys: number[]): { a: number; b: number } {
  const n = xs.length;
  const sx = xs.reduce((s, v) => s + v, 0);
  const sy = ys.reduce((s, v) => s + v, 0);
  const sxx = xs.reduce((s, v) => s + v * v, 0);
  const sxy = xs.reduce((s, v, i) => s + v * ys[i]!, 0);
  const den = n * sxx - sx * sx;
  const b = (n * sxy - sx * sy) / den;
  const a = (sy - b * sx) / n;
  return { a, b };
}

// Spearman rank correlation, ties averaged. 0 when either side has no spread.
export function spearman(xs: number[], ys: number[]): number {
  const rank = (v: number[]): number[] => {
    const order = v.map((x, i) => [x, i] as const).sort((p, q) => p[0] - q[0]);
    const r = new Array<number>(v.length);
    let i = 0;
    while (i < order.length) {
      let j = i;
      while (j + 1 < order.length && order[j + 1]![0] === order[i]![0]) j++;
      const avg = (i + j) / 2 + 1;
      for (let k = i; k <= j; k++) r[order[k]![1]] = avg;
      i = j + 1;
    }
    return r;
  };
  const rx = rank(xs);
  const ry = rank(ys);
  const n = xs.length;
  const mx = rx.reduce((s, v) => s + v, 0) / n;
  const my = ry.reduce((s, v) => s + v, 0) / n;
  let cov = 0;
  let vx = 0;
  let vy = 0;
  for (let i = 0; i < n; i++) {
    cov += (rx[i]! - mx) * (ry[i]! - my);
    vx += (rx[i]! - mx) ** 2;
    vy += (ry[i]! - my) ** 2;
  }
  return vx === 0 || vy === 0 ? 0 : cov / Math.sqrt(vx * vy);
}

// ---------------------------------------------------------------- the size curve

export interface SizeFit {
  intercept: number;
  slope: number;
  r2: number;
  residualSd: number;
  n: number;
}

export function fitSizeCurve(live: Protocol[]): SizeFit {
  const xs = live.map((p) => Math.log10(p.tvl_usd));
  const ys = live.map((p) => Math.log10(p.mcap_usd!));
  const { a, b } = ols2(xs, ys);
  const meanY = ys.reduce((s, v) => s + v, 0) / ys.length;
  let ssRes = 0;
  let ssTot = 0;
  for (let i = 0; i < ys.length; i++) {
    const pred = a + b * xs[i]!;
    ssRes += (ys[i]! - pred) ** 2;
    ssTot += (ys[i]! - meanY) ** 2;
  }
  return {
    intercept: a,
    slope: b,
    r2: 1 - ssRes / ssTot,
    // Population spread of the residuals (Lane B's convention: pstdev).
    residualSd: Math.sqrt(ssRes / ys.length),
    n: ys.length,
  };
}

// Median residual per category, shrunk toward zero: n_c / (n_c + k).
export function categoryOffsets(
  live: Protocol[],
  fit: SizeFit,
  k: number,
): Map<string, number> {
  const byCat = new Map<string, number[]>();
  for (const p of live) {
    const r =
      Math.log10(p.mcap_usd!) -
      (fit.intercept + fit.slope * Math.log10(p.tvl_usd));
    const c = p.category ?? "(none)";
    if (!byCat.has(c)) byCat.set(c, []);
    byCat.get(c)!.push(r);
  }
  const out = new Map<string, number>();
  for (const [c, rs] of byCat) out.set(c, (rs.length * median(rs)) / (rs.length + k));
  return out;
}

export function ageDays(listedAt: string | null, asOfMs: number): number {
  if (!listedAt) return 365;
  const d = (asOfMs - Date.parse(`${listedAt}T00:00:00Z`)) / 86400000;
  return Math.max(0, Math.round(d));
}

export function growthFactor(change7d: number | null): number {
  if (change7d === null) return 1;
  return 1 + (clamp(change7d, -60, 120) / 100) * 0.25;
}

export function maturityFactor(listedAt: string | null, asOfMs: number): number {
  return 0.8 + (Math.min(ageDays(listedAt, asOfMs), 1095) / 1095) * 0.2;
}

export function breadthFactor(chains: string[]): number {
  return 1 + 0.01 * Math.min(Math.max(chains.length - 1, 0), 5);
}

// The full-mcap estimate: what the protocol's token would be worth if it
// launched at the size curve's price. Whole dollars.
export function curveValueUsd(
  p: Protocol,
  fit: SizeFit,
  offsets: Map<string, number>,
  asOfMs: number,
): number {
  const off = offsets.get(p.category ?? "(none)") ?? 0;
  const logVal =
    fit.intercept +
    fit.slope * Math.log10(p.tvl_usd) +
    off +
    Math.log10(growthFactor(p.change_7d)) +
    Math.log10(maturityFactor(p.listed_at, asOfMs)) +
    Math.log10(breadthFactor(p.chains));
  return Math.max(1, Math.round(10 ** logVal));
}

// The category's launch share: protocols in it that already record a token,
// over all of them. A stock share — what has happened — not a forecast.
export function launchShare(category: string | null, snap: Snapshot): number {
  let tok = 0;
  let tot = 0;
  for (const p of snap.protocols) {
    if ((p.category ?? null) !== category) continue;
    tot++;
    if (hasToken(p)) tok++;
  }
  if (tot === 0) {
    let t2 = 0;
    for (const p of snap.protocols) if (hasToken(p)) t2++;
    return t2 / snap.protocols.length;
  }
  return tok / tot;
}

// ---------------------------------------------------------------- leave-one-out

export interface LooSpec {
  catK: number; // 0: no category offset; else the shrink k
  growthW: number; // 0: no growth term; else the weight in g
  matFloor: number; // 1: no maturity term; else the floor of m
  matRange: number; // 0: no maturity term; else the range of m
  breadthW: number; // 0: no breadth term; else the per-chain step in d
}

export const SPEC_V3: LooSpec = { catK: 20, growthW: 0.25, matFloor: 0.8, matRange: 0.2, breadthW: 0.01 };
export const SPEC_SIZE_ONLY: LooSpec = { catK: 0, growthW: 0, matFloor: 1, matRange: 0, breadthW: 0 };
export const SPEC_CAT: LooSpec = { catK: 20, growthW: 0, matFloor: 1, matRange: 0, breadthW: 0 };
export const SPEC_FULL_WEIGHTS: LooSpec = { catK: 20, growthW: 0.5, matFloor: 0.6, matRange: 0.4, breadthW: 0.02 };

export interface LooResult {
  n: number;
  medianMiss: number;
  le3: number;
  le10: number;
  spearman: number;
  p10: number;
  p25: number;
  p75: number;
  p90: number;
  errs: number[];
}

function smallTermsLog10(p: Protocol, spec: LooSpec, asOfMs: number): number {
  let t = 0;
  if (spec.growthW > 0 && p.change_7d !== null)
    t += Math.log10(1 + (clamp(p.change_7d, -60, 120) / 100) * spec.growthW);
  if (spec.matRange > 0)
    t += Math.log10(spec.matFloor + (Math.min(ageDays(p.listed_at, asOfMs), 1095) / 1095) * spec.matRange);
  if (spec.breadthW > 0)
    t += Math.log10(1 + spec.breadthW * Math.min(Math.max(p.chains.length - 1, 0), 5));
  return t;
}

export function looEval(live: Protocol[], spec: LooSpec, asOfMs: number): LooResult {
  const errs: number[] = [];
  const preds: number[] = [];
  const actuals: number[] = [];
  for (let i = 0; i < live.length; i++) {
    const held = live[i]!;
    const train = live.filter((_, j) => j !== i);
    const fit = fitSizeCurve(train);
    const offsets = spec.catK > 0 ? categoryOffsets(train, fit, spec.catK) : new Map<string, number>();
    const off = offsets.get(held.category ?? "(none)") ?? 0;
    const pred =
      fit.intercept + fit.slope * Math.log10(held.tvl_usd) + off + smallTermsLog10(held, spec, asOfMs);
    const actual = Math.log10(held.mcap_usd!);
    errs.push(pred - actual);
    preds.push(pred);
    actuals.push(actual);
  }
  const absErrs = errs.map((e) => Math.abs(e));
  const within = (x: number) => errs.filter((e) => Math.abs(e) <= Math.log10(x)).length / errs.length;
  return {
    n: errs.length,
    medianMiss: 10 ** median(absErrs),
    le3: within(3),
    le10: within(10),
    spearman: spearman(preds, actuals),
    p10: quantile(errs, 0.1),
    p25: quantile(errs, 0.25),
    p75: quantile(errs, 0.75),
    p90: quantile(errs, 0.9),
    errs,
  };
}

// The flat baseline: every held token is priced at the train median of
// mcap / TVL, in ratio space (Lane B's definition).
export function looFlat(live: Protocol[]): LooResult {
  const errs: number[] = [];
  const preds: number[] = [];
  const actuals: number[] = [];
  for (let i = 0; i < live.length; i++) {
    const held = live[i]!;
    const train = live.filter((_, j) => j !== i);
    const ratio = median(train.map((p) => p.mcap_usd! / p.tvl_usd));
    const pred = Math.log10(held.tvl_usd * ratio);
    const actual = Math.log10(held.mcap_usd!);
    errs.push(pred - actual);
    preds.push(pred);
    actuals.push(actual);
  }
  const absErrs = errs.map((e) => Math.abs(e));
  const within = (x: number) => errs.filter((e) => Math.abs(e) <= Math.log10(x)).length / errs.length;
  return {
    n: errs.length,
    medianMiss: 10 ** median(absErrs),
    le3: within(3),
    le10: within(10),
    spearman: spearman(preds, actuals),
    p10: quantile(errs, 0.1),
    p25: quantile(errs, 0.25),
    p75: quantile(errs, 0.75),
    p90: quantile(errs, 0.9),
    errs,
  };
}

// Walk-forward: fit on the older half of dated live tokens, test the younger.
// The cut is the median listed date; train is strictly before it.
export function walkForward(live: Protocol[], asOfMs: number): {
  trainN: number;
  testN: number;
  medianMiss: number;
  le3: number;
  le10: number;
  cut: string;
} {
  const dated = live.filter((p) => p.listed_at !== null).sort((a, b) => (a.listed_at! < b.listed_at! ? -1 : 1));
  const cut = dated[Math.floor(dated.length / 2)]!.listed_at!;
  const train = dated.filter((p) => p.listed_at! < cut);
  const test = dated.filter((p) => p.listed_at! >= cut);
  const fit = fitSizeCurve(train);
  const offsets = categoryOffsets(train, fit, 20);
  const errs = test.map((p) => {
    const off = offsets.get(p.category ?? "(none)") ?? 0;
    const pred =
      fit.intercept + fit.slope * Math.log10(p.tvl_usd) + off + smallTermsLog10(p, SPEC_V3, asOfMs);
    return pred - Math.log10(p.mcap_usd!);
  });
  const within = (x: number) => errs.filter((e) => Math.abs(e) <= Math.log10(x)).length / errs.length;
  return {
    trainN: train.length,
    testN: test.length,
    medianMiss: 10 ** median(errs.map((e) => Math.abs(e))),
    le3: within(3),
    le10: within(10),
    cut,
  };
}

// Range-hold: the band from the first half of the leave-one-out errors, its
// coverage on the second half.
export function rangeHold(errs: number[]): { coverage: number; p10: number; p90: number } {
  const half = Math.floor(errs.length / 2);
  const first = errs.slice(0, half);
  const second = errs.slice(half);
  const p10 = quantile(first, 0.1);
  const p90 = quantile(first, 0.9);
  const inside = second.filter((e) => e >= p10 && e <= p90).length;
  return { coverage: inside / second.length, p10, p90 };
}

// ---------------------------------------------------------------- launch odds, held out

// Age buckets times log-TVL buckets, trained on the older half of dated
// protocols and tested on the younger half. The point is the check, not the
// odds: does a bucketed rate beat the base rate out of sample?
export function launchOddsHeldOut(
  protocols: Protocol[],
  asOfMs: number,
): {
  brierModel: number;
  brierBase: number;
  accuracy: number;
  baseAccuracy: number;
  testN: number;
  baseRate: number;
  ageRates: { label: string; n: number; rate: number }[];
} {
  const dated = protocols.filter((p) => p.listed_at !== null).sort((a, b) => (a.listed_at! < b.listed_at! ? -1 : 1));
  const cut = dated[Math.floor(dated.length / 2)]!.listed_at!;
  const train = dated.filter((p) => p.listed_at! < cut);
  const test = dated.filter((p) => p.listed_at! >= cut);
  const bucket = (p: Protocol): string => {
    const age = ageDays(p.listed_at, asOfMs);
    const a = age < 365 ? "0-1y" : age < 730 ? "1-2y" : "2y+";
    const l = Math.log10(Math.max(p.tvl_usd, 1));
    const t = l < 7.5 ? "small" : l < 8.5 ? "mid" : "large";
    return `${a}|${t}`;
  };
  const rates = new Map<string, { tok: number; n: number }>();
  let baseTok = 0;
  for (const p of train) {
    const b = bucket(p);
    if (!rates.has(b)) rates.set(b, { tok: 0, n: 0 });
    const r = rates.get(b)!;
    r.n++;
    if (hasToken(p)) r.tok++;
    if (hasToken(p)) baseTok++;
  }
  const baseRate = baseTok / train.length;
  const rateOf = (b: string): number => {
    const r = rates.get(b);
    return r ? r.tok / r.n : baseRate;
  };
  let brierModel = 0;
  let brierBase = 0;
  let correct = 0;
  let baseCorrect = 0;
  for (const p of test) {
    const y = hasToken(p) ? 1 : 0;
    const pr = rateOf(bucket(p));
    brierModel += (pr - y) ** 2;
    brierBase += (baseRate - y) ** 2;
    if ((pr >= 0.5 ? 1 : 0) === y) correct++;
    if ((baseRate >= 0.5 ? 1 : 0) === y) baseCorrect++;
  }
  const ageRates = ["0-1y", "1-2y", "2y+"].map((label) => {
    const group = dated.filter((p) => {
      const age = ageDays(p.listed_at, asOfMs);
      return label === "0-1y" ? age < 365 : label === "1-2y" ? age >= 365 && age < 730 : age >= 730;
    });
    const tok = group.filter((p) => hasToken(p)).length;
    return { label, n: group.length, rate: group.length ? tok / group.length : 0 };
  });
  return {
    brierModel: brierModel / test.length,
    brierBase: brierBase / test.length,
    accuracy: correct / test.length,
    baseAccuracy: baseCorrect / test.length,
    testN: test.length,
    baseRate,
    ageRates,
  };
}

// ---------------------------------------------------------------- the board

export interface BoardRow {
  slug: string;
  name: string;
  rank: number;
  category: string;
  chains: string[];
  tvl_usd: number;
  change_7d: number | null;
  listed_at: string | null;
  age_days: number;
  curve_value_usd: number;
  implied_value_usd: number;
  p10_usd: number;
  p25_usd: number;
  p75_usd: number;
  p90_usd: number;
  growth: number;
  maturity: number;
  breadth: number;
  offset: number;
  p_ref: number;
  is_watchlist: boolean;
  is_off_list: boolean;
}

export interface Ledger {
  ranked: number;
  tokenRecorded: number;
  bridge: number;
  liquidStaking: number;
  exchangeCustody: number;
  versioned: number;
  wrapped: number;
  total: number;
}

export function buildUniverse(snap: Snapshot): { ranked: Protocol[]; ledger: Ledger } {
  const wl = new Set(snap.watchlist);
  const ranked: Protocol[] = [];
  const ledger: Ledger = {
    ranked: 0,
    tokenRecorded: 0,
    bridge: 0,
    liquidStaking: 0,
    exchangeCustody: 0,
    versioned: 0,
    wrapped: 0,
    total: snap.protocols.length,
  };
  for (const p of snap.protocols) {
    if (wl.has(p.slug)) {
      ranked.push(p);
      continue;
    }
    if (hasToken(p)) {
      ledger.tokenRecorded++;
      continue;
    }
    const reason = exclusionReason(p);
    if (reason === null) {
      ranked.push(p);
      continue;
    }
    if (reason === "bridge") ledger.bridge++;
    else if (reason === "liquid-staking") ledger.liquidStaking++;
    else if (reason === "exchange-custody") ledger.exchangeCustody++;
    else if (reason === "versioned") ledger.versioned++;
    else if (reason === "wrapped") ledger.wrapped++;
  }
  ledger.ranked = ranked.length;
  return { ranked, ledger };
}

export interface CategoryRow {
  category: string;
  n_total: number;
  n_token: number;
  p_ref: number;
  n_live: number;
  offset: number;
  n_board: number;
}

export interface BoardBuild {
  rows: BoardRow[];
  fit: SizeFit;
  offsets: Record<string, number>;
  validation: {
    loo: LooResult;
    looFlat: LooResult;
    looSizeOnly: LooResult;
    looCat: LooResult;
    looFullWeights: LooResult;
    walkForward: ReturnType<typeof walkForward>;
    rangeHold: ReturnType<typeof rangeHold>;
    launchOdds: ReturnType<typeof launchOddsHeldOut>;
    liveCount: number;
  };
  ledger: Ledger;
  categories: CategoryRow[];
  liveTokens: { slug: string; name: string; category: string; tvl_usd: number; mcap_usd: number }[];
}

export function buildBoard(snap: Snapshot): BoardBuild {
  const asOfMs = Date.parse(`${snap.as_of}T00:00:00Z`);
  const live = snap.protocols.filter((p) => p.mcap_usd !== null && p.mcap_usd > 0 && p.tvl_usd > 0);
  const fit = fitSizeCurve(live);
  const offsets = categoryOffsets(live, fit, 20);

  const loo = looEval(live, SPEC_V3, asOfMs);
  const flatLoo = looFlat(live);
  const looSizeOnly = looEval(live, SPEC_SIZE_ONLY, asOfMs);
  const looCat = looEval(live, SPEC_CAT, asOfMs);
  const looFullWeights = looEval(live, SPEC_FULL_WEIGHTS, asOfMs);
  const wf = walkForward(live, asOfMs);
  const rh = rangeHold(loo.errs);
  const odds = launchOddsHeldOut(snap.protocols, asOfMs);

  const { ranked, ledger } = buildUniverse(snap);
  const wl = new Set(snap.watchlist);
  const bandLo = (implied: number, q: number) => Math.max(1, Math.round(implied * 10 ** q));
  const bandHi = (implied: number, q: number) => Math.max(1, Math.round(implied * 10 ** q));

  const rows: BoardRow[] = ranked
    .map((p) => {
      const curve = curveValueUsd(p, fit, offsets, asOfMs);
      const pRef = launchShare(p.category, snap);
      const implied = Math.max(1, Math.round(curve * pRef));
      return {
        slug: p.slug,
        name: p.name,
        rank: 0,
        category: p.category ?? "(none)",
        chains: p.chains,
        tvl_usd: p.tvl_usd,
        change_7d: p.change_7d,
        listed_at: p.listed_at,
        age_days: ageDays(p.listed_at, asOfMs),
        curve_value_usd: curve,
        implied_value_usd: implied,
        p10_usd: bandLo(implied, loo.p10),
        p25_usd: bandLo(implied, loo.p25),
        p75_usd: bandHi(implied, loo.p75),
        p90_usd: bandHi(implied, loo.p90),
        growth: growthFactor(p.change_7d),
        maturity: maturityFactor(p.listed_at, asOfMs),
        breadth: breadthFactor(p.chains),
        offset: offsets.get(p.category ?? "(none)") ?? 0,
        p_ref: pRef,
        is_watchlist: wl.has(p.slug),
        is_off_list: !wl.has(p.slug) && p.tvl_usd >= snap.floor_usd,
      };
    })
    .sort((a, b) => b.implied_value_usd - a.implied_value_usd || (a.slug < b.slug ? -1 : 1));
  rows.forEach((r, i) => {
    r.rank = i + 1;
  });

  // Per-category table, for the dashboard's category tab.
  const catMap = new Map<string, CategoryRow>();
  for (const p of snap.protocols) {
    const c = p.category ?? "(none)";
    if (!catMap.has(c))
      catMap.set(c, { category: c, n_total: 0, n_token: 0, p_ref: 0, n_live: 0, offset: 0, n_board: 0 });
    const row = catMap.get(c)!;
    row.n_total++;
    if (hasToken(p)) row.n_token++;
    if (p.mcap_usd !== null && p.mcap_usd > 0 && p.tvl_usd > 0) row.n_live++;
  }
  for (const r of rows) catMap.get(r.category)!.n_board++;
  const categories = [...catMap.values()]
    .map((c) => ({ ...c, p_ref: c.n_token / c.n_total, offset: offsets.get(c.category) ?? 0 }))
    .sort((a, b) => b.offset - a.offset || (a.category < b.category ? -1 : 1));

  const liveTokens = live
    .map((p) => ({
      slug: p.slug,
      name: p.name,
      category: p.category ?? "(none)",
      tvl_usd: p.tvl_usd,
      mcap_usd: p.mcap_usd!,
    }))
    .sort((a, b) => b.mcap_usd - a.mcap_usd);

  return {
    rows,
    fit,
    offsets: Object.fromEntries(offsets),
    validation: {
      loo,
      looFlat: flatLoo,
      looSizeOnly,
      looCat,
      looFullWeights,
      walkForward: wf,
      rangeHold: rh,
      launchOdds: odds,
      liveCount: live.length,
    },
    ledger,
    categories,
    liveTokens,
  };
}
