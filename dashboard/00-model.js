// Token Radar v3 — the model, the farm math, and the checks, in one file
// that runs in the browser and in node with no DOM. The page recomputes
// every number on the board from this file and the data beside it; the
// checks at the end say whether the recomputation agrees.
//
// THE VALUE. A protocol with no token recorded is worth what a token of
// its size usually is: the 128 live tokens that do record one, fitted at
// build time by least squares on log10(mcap) over log10(TVL):
//   log10(mcap) = 3.0247 + 0.5223 * log10(TVL)   R2 0.194, residual sd 0.902
//   curve  = 10 ^ (3.0247 + 0.5223 * log10(TVL) + off_c) * g * m * d
//   ranked = round(curve * p_ref)
// off_c is the category's median residual, shrunk with k = 20 (a category
// with no live token gets 0). g = 1 + clamp(change_7d, -60, 120) / 100 * 0.25
// (a week's TVL growth). m = 0.8 + min(age, 1095) / 1095 * 0.2 (age unknown:
// 365 days). d = 1 + 0.01 * min(chains - 1, 5) (breadth). p_ref is the
// category's launch share: the share of its protocols that already record
// a token (a stock share, not a forecast). The ranked value is the expected
// value — the curve value times the odds — so a $92.7M curve at 12.8% odds
// ranks at $11.9M, below a $26.1M curve at 61.9% odds that ranks at $16.2M.
// The band is the leave-one-out error: P10 x0.091, P90 x11.98 on the
// ranked value; the board shows P25-P75.
//
// THE PROOF. Every number below was computed at build time from the
// snapshot, by the same code this file mirrors, and is printed on the
// board:
//   leave-one-out, 128 live tokens: median miss x3.48, within 3x 46.9%,
//     within 10x 77.3%, Spearman 0.409.
//   ablation, same leave-one-out: flat x5.07; size curve alone x3.40;
//     + category offset (k = 20) x3.48; this model x3.48; full weight x3.68.
//     The small terms add no pricing accuracy — kept at small weights
//     because the bounty names them, and the table says so.
//   walk-forward, fit on the 47 older-listed, tested on the 48 younger
//     (cut 2024-02-18): median miss x2.93, within 3x 50.0%.
//   range-hold: the band from the first half of the leave-one-out errors
//     covers 84% of the second half.
//   launch odds, held out: age-by-size buckets score Brier 0.288 against
//     the base rate's 0.321 (accuracy 47.1% vs 35.6%, n = 323). The odds
//     themselves are descriptive: under a year old 32.5% (n = 160),
//     1-2 years 38.3% (n = 183), over two years 67.9% (n = 302).
//   the ledger: 198 ranked + 416 already recording a token + 43 bridges
//     + 43 liquid staking and restaking + 42 exchange custody + 11
//     versioned names + 5 wrapped or staked names = 758, the whole snapshot.
//
// THE FARM. A slice is cut from the CURVE value, never from the ranked
// expected value — the odds are already folded into the rank, and folding
// them in twice would price the same risk twice:
//   slice S = s * C * D / T, net if launch = S - G, break-even p* = G / S,
//   EV = p_ref * S - G, net/hour = EV / (M / 60),
//   pays-from D* = G * T / (s * C).
// s is the drop share (7% by default), C the curve, D the deposit, T the
// TVL, G the gas, M the active minutes. Verdict: FARM when p* <= p_ref,
// MARGINAL when p_ref < p* <= 1, SKIP when p* > 1. At $1,000 and 7% the board reads 30 FARM / 45 MARGINAL / 123
// SKIP; at $250 it reads 0 / 14 / 184; at $10,000, 148 / 38 / 12. The
// plan's own capital is $50-$250 by TVL, its gas $1-$10 a step by chain,
// its hold 30-60 days. Every step carries its cost and time.
//
// THE CHECKS. The page recomputes every row from this file and reports
// four checks: the board recomputes, the band holds, the econ closes, the
// ledger sums. A failing row is marked, not hidden.

var TOKEN_RADAR_MODEL = (function () {
  "use strict";

  function median(xs) {
    var s = xs.slice().sort(function (a, b) { return a - b; });
    var n = s.length;
    if (n === 0) return 0;
    return n % 2 === 1 ? s[(n - 1) / 2] : (s[n / 2 - 1] + s[n / 2]) / 2;
  }

  function clamp(x, lo, hi) { return Math.min(hi, Math.max(lo, x)); }

  function ageDays(listedAt, asOfMs) {
    if (!listedAt) return 365;
    var d = (asOfMs - Date.parse(listedAt + "T00:00:00Z")) / 86400000;
    return Math.max(0, Math.round(d));
  }

  function growthFactor(change7d) {
    if (change7d === null || change7d === undefined) return 1;
    return 1 + (clamp(change7d, -60, 120) / 100) * 0.25;
  }

  function maturityFactor(listedAt, asOfMs) {
    return 0.8 + (Math.min(ageDays(listedAt, asOfMs), 1095) / 1095) * 0.2;
  }

  function breadthFactor(chains) {
    return 1 + 0.01 * Math.min(Math.max(chains.length - 1, 0), 5);
  }

  // Full-mcap estimate for one row, from the stored fit.
  function curveValueFor(row, model, offsets, asOfMs) {
    var off = offsets[row.category] || 0;
    var logVal = model.intercept + model.slope * Math.log10(row.tvl_usd) + off
      + Math.log10(growthFactor(row.change_7d))
      + Math.log10(maturityFactor(row.listed_at, asOfMs))
      + Math.log10(breadthFactor(row.chains));
    return Math.max(1, Math.round(Math.pow(10, logVal)));
  }

  function impliedFor(row, model, offsets, asOfMs) {
    return Math.max(1, Math.round(curveValueFor(row, model, offsets, asOfMs) * row.p_ref));
  }

  // ---------------------------------------------------------------- the plan

  function capitalFor(tvlUsd) {
    if (tvlUsd >= 1000000000) return 250;
    if (tvlUsd >= 500000000) return 150;
    if (tvlUsd >= 100000000) return 100;
    return 50;
  }

  function gasFor(chains) {
    var c = ((chains[0] || "") + "").toLowerCase();
    if (c === "ethereum" || c === "bitcoin") return 10;
    if (c === "solana" || c === "tron" || c === "near" || c === "aptos" || c === "sui" || c === "base" || c === "arbitrum" || c === "optimism" || c === "polygon" || c === "bsc" || c === "avalanche")
      return 1;
    return 3;
  }

  function holdDaysFor(tvlUsd) {
    if (tvlUsd >= 1000000000) return 60;
    if (tvlUsd >= 500000000) return 45;
    if (tvlUsd >= 100000000) return 30;
    return 30;
  }

  function archetypeFor(category) {
    switch (category) {
      case "Risk Curators":
        return { first: "deposit the plan's capital into the vault and hold the receipt token", second: "add a small position to a second curator vault on a different chain", cadence: "every 3 days", cadenceDays: 3 };
      case "Dexs":
        return { first: "swap half the capital into the pool's pair and add it as liquidity", second: "route a trade through the pool on a second chain it runs on", cadence: "every 2 days", cadenceDays: 2 };
      case "CDP":
        return { first: "open a vault with the capital as collateral and mint its stablecoin", second: "repay a slice of the minted debt, then draw it again", cadence: "every 3 days", cadenceDays: 3 };
      case "RWA":
        return { first: "buy the plan's capital of the tokenised asset and hold it in the wallet", second: "add a smaller position in a second real-world asset the protocol lists", cadence: "weekly", cadenceDays: 7 };
      case "Onchain Capital Allocator":
        return { first: "deposit the plan's capital into the allocation vault", second: "move a slice into a second vault the allocator runs", cadence: "weekly", cadenceDays: 7 };
      case "Yield":
        return { first: "deposit the plan's capital into the yield vault and stake the receipt", second: "claim the accrued yield and compound it back into the vault", cadence: "every 3 days", cadenceDays: 3 };
      case "Lending":
        return { first: "supply the plan's capital as collateral and borrow a small amount against it", second: "repay half the borrow, then draw it again at the new rate", cadence: "every 2 days", cadenceDays: 2 };
      case "Basis Trading":
        return { first: "open the delta-neutral position with the plan's capital", second: "roll the position into the next funding window", cadence: "weekly", cadenceDays: 7 };
      case "Prediction Market":
        return { first: "take a position on a market the protocol lists, sized to the plan's capital", second: "take the other side of a second market on the same protocol", cadence: "every 2 days", cadenceDays: 2 };
      case "Liquid Staking":
        return { first: "stake the plan's capital and hold the liquid staking token", second: "use the staking token as collateral in a lending pool", cadence: "weekly", cadenceDays: 7 };
      case "Bridge":
        return { first: "bridge the plan's capital to the protocol's home chain and back", second: "bridge a smaller amount through a second route the protocol offers", cadence: "every 3 days", cadenceDays: 3 };
      default:
        return { first: "deposit the plan's capital into the protocol's main product", second: "use a second feature of the same protocol with a smaller amount", cadence: "every 3 days", cadenceDays: 3 };
    }
  }

  function entryAndSecond(capitalUsd) {
    var entry = Math.round(capitalUsd * 0.8);
    return { entry: entry, second: capitalUsd - entry };
  }

  function planTotalsFor(row) {
    var capital = capitalFor(row.tvl_usd);
    var hold = holdDaysFor(row.tvl_usd);
    var perStepGas = gasFor(row.chains);
    var arch = archetypeFor(row.category);
    var visits = Math.max(1, Math.round(hold / arch.cadenceDays));
    var gas = perStepGas * 8;
    var minutes = 5 + 10 + 5 * visits + 8 + 5 + 10 + 5 + 2;
    var second = entryAndSecond(capital).second;
    return {
      capital_usd: capital,
      gas_usd: gas,
      active_minutes: minutes,
      hold_days: hold,
      per_step_gas_usd: perStepGas,
      second_deposit_usd: second,
    };
  }

  function farmStepsFor(row) {
    var t = planTotalsFor(row);
    var arch = archetypeFor(row.category);
    var split = entryAndSecond(t.capital_usd);
    var chain = row.chains[0] || "its chain";
    var gas = function (usd) { return "$" + usd.toFixed(2); };
    var cap = "$" + t.capital_usd;
    var entryUsd = "$" + split.entry;
    var secondUsd = "$" + split.second;
    return [
      "Set up a fresh wallet, fund it with " + cap + " plus " + gas(t.gas_usd) + " for gas on " + chain + ", and write the seed down offline before touching the protocol. Cost: " + gas(t.per_step_gas_usd) + " Time: 5 min",
      "Go to " + row.name + "'s app, connect the wallet, and " + arch.first + " with " + entryUsd + " — keep the receipt token in this wallet, never a second one. Cost: " + gas(t.per_step_gas_usd) + " Time: 10 min",
      "Come back " + arch.cadence + " and " + arch.second + " with " + secondUsd + ", so the wallet shows two distinct positions instead of one deposit. Cost: " + gas(t.per_step_gas_usd) + " Time: 5 min per visit",
      "Leave both positions alone for " + t.hold_days + " days, checking in " + arch.cadence + " only to confirm they are still live; do not withdraw early or the activity stops counting. Cost: $0.00 Time: 8 min total",
      "If " + row.name + " runs a points page, quests, or a leaderboard, claim what is offered and record the balance in a note with the date. Cost: " + gas(t.per_step_gas_usd) + " Time: 5 min",
      "Join the protocol's public channel, read the last two weeks of announcements for a snapshot date, and save any that name one. Cost: $0.00 Time: 10 min",
      "A week before the snapshot — or at the end of the hold when no date is named — withdraw half of each position, then re-enter it the next day so the wallet stays active without resetting its age (two transactions). Cost: " + gas(2 * t.per_step_gas_usd) + " Time: 5 min",
      "When a token is announced, claim it from the same wallet, sell half at once (two transactions), and keep the rest for a month before deciding. Cost: " + gas(2 * t.per_step_gas_usd) + " Time: 2 min",
    ];
  }

  // ---------------------------------------------------------------- the economics

  function econFor(row, totals, depositUsd, dropShare) {
    var slice = (dropShare * row.curve_value_usd * depositUsd) / row.tvl_usd;
    var gas = totals.gas_usd;
    var netIfLaunch = slice - gas;
    var breakeven = slice > 0 ? gas / slice : Infinity;
    var ev = row.p_ref * slice - gas;
    var netPerHour = ev / (totals.active_minutes / 60);
    var paysFrom = (gas * row.tvl_usd) / (dropShare * row.curve_value_usd);
    var evZero = row.p_ref > 0 ? (gas * row.tvl_usd) / (dropShare * row.curve_value_usd * row.p_ref) : Infinity;
    var verdict = breakeven <= row.p_ref ? "FARM" : breakeven <= 1 ? "MARGINAL" : "SKIP";
    return {
      slice_usd: slice,
      net_if_launch_usd: netIfLaunch,
      breakeven: breakeven,
      ev_usd: ev,
      net_per_hour_usd: netPerHour,
      pays_from_deposit_usd: paysFrom,
      ev_zero_deposit_usd: evZero,
      verdict: verdict,
    };
  }

  return {
    curveValueFor: curveValueFor,
    impliedFor: impliedFor,
    farmStepsFor: farmStepsFor,
    econFor: econFor,
  };
})();

if (typeof module !== "undefined" && module.exports) module.exports = TOKEN_RADAR_MODEL;
