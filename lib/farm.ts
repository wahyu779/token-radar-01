// Token Radar v3 — the farm plan and the economics, per row.
//
// Two separate questions. The plan says what to DO: eight steps, sized to
// the protocol's own shape, with a gas and time cost on every step. The
// economics says whether doing it pays: a slice of the protocol's drop, cut
// from the curve value, priced against the plan's gas and time.
//
//   slice S       = s * C * D / T      s the drop share, C the curve value,
//                                      D the deposit, T the protocol's TVL
//   net if launch = S - G              G the plan's gas, all-in
//   break-even p* = G / S              the launch chance the plan needs
//   EV            = p_ref * S - G      p_ref the category's launch share
//   net per hour  = EV / (M / 60)      M the plan's active minutes
//   pays-from D*  = G * T / (s * C)    the deposit that breaks even
//
// The verdict follows the break-even against the launch share: FARM when
// p* is at or under p_ref, MARGINAL when it sits between p_ref and 1, SKIP
// when it passes 1 — when no launch chance, however generous, covers the
// gas. The slice is always cut from the curve value C, never from the
// ranked expected value: the ranked value already has the odds folded in,
// and folding them in twice would price the same risk twice.

import type { BoardRow } from "./model.ts";

// ---------------------------------------------------------------- plan sizing

// What a deposit is for: the plan's own capital, and the size it points at.
export function capitalFor(tvlUsd: number): number {
  if (tvlUsd >= 1_000_000_000) return 250;
  if (tvlUsd >= 500_000_000) return 150;
  if (tvlUsd >= 100_000_000) return 100;
  return 50;
}

// What the chain charges to move: a dear chain, a cheap one, the rest.
export function gasFor(chains: string[]): number {
  const c = (chains[0] ?? "").toLowerCase();
  if (c === "ethereum" || c === "bitcoin") return 10;
  if (c === "solana" || c === "tron" || c === "near" || c === "aptos" || c === "sui" || c === "base" || c === "arbitrum" || c === "optimism" || c === "polygon" || c === "bsc" || c === "avalanche")
    return 1;
  return 3;
}

// How long to stay in: long enough to be counted, short enough to leave.
export function holdDaysFor(tvlUsd: number): number {
  if (tvlUsd >= 1_000_000_000) return 60;
  if (tvlUsd >= 500_000_000) return 45;
  if (tvlUsd >= 100_000_000) return 30;
  return 30;
}

export interface PlanTotals {
  capital_usd: number;
  gas_usd: number;
  active_minutes: number;
  hold_days: number;
  per_step_gas_usd: number;
  second_deposit_usd: number;
}

// The shape of the protocol decides the shape of the plan: what you do
// first, what you touch second, how often you come back. Twelve shapes,
// one fallback for a category the twelve do not name.
export function archetypeFor(category: string): {
  first: string;
  second: string;
  cadence: string;
  cadenceDays: number;
} {
  switch (category) {
    case "Risk Curators":
      return {
        first: "deposit the plan's capital into the vault and hold the receipt token",
        second: "add a small position to a second curator vault on a different chain",
        cadence: "every 3 days",
        cadenceDays: 3,
      };
    case "Dexs":
      return {
        first: "swap half the capital into the pool's pair and add it as liquidity",
        second: "route a trade through the pool on a second chain it runs on",
        cadence: "every 2 days",
        cadenceDays: 2,
      };
    case "CDP":
      return {
        first: "open a vault with the capital as collateral and mint its stablecoin",
        second: "repay a slice of the minted debt, then draw it again",
        cadence: "every 3 days",
        cadenceDays: 3,
      };
    case "RWA":
      return {
        first: "buy the plan's capital of the tokenised asset and hold it in the wallet",
        second: "add a smaller position in a second real-world asset the protocol lists",
        cadence: "weekly",
        cadenceDays: 7,
      };
    case "Onchain Capital Allocator":
      return {
        first: "deposit the plan's capital into the allocation vault",
        second: "move a slice into a second vault the allocator runs",
        cadence: "weekly",
        cadenceDays: 7,
      };
    case "Yield":
      return {
        first: "deposit the plan's capital into the yield vault and stake the receipt",
        second: "claim the accrued yield and compound it back into the vault",
        cadence: "every 3 days",
        cadenceDays: 3,
      };
    case "Lending":
      return {
        first: "supply the plan's capital as collateral and borrow a small amount against it",
        second: "repay half the borrow, then draw it again at the new rate",
        cadence: "every 2 days",
        cadenceDays: 2,
      };
    case "Basis Trading":
      return {
        first: "open the delta-neutral position with the plan's capital",
        second: "roll the position into the next funding window",
        cadence: "weekly",
        cadenceDays: 7,
      };
    case "Prediction Market":
      return {
        first: "take a position on a market the protocol lists, sized to the plan's capital",
        second: "take the other side of a second market on the same protocol",
        cadence: "every 2 days",
        cadenceDays: 2,
      };
    case "Liquid Staking":
      return {
        first: "stake the plan's capital and hold the liquid staking token",
        second: "use the staking token as collateral in a lending pool",
        cadence: "weekly",
        cadenceDays: 7,
      };
    case "Bridge":
      return {
        first: "bridge the plan's capital to the protocol's home chain and back",
        second: "bridge a smaller amount through a second route the protocol offers",
        cadence: "every 3 days",
        cadenceDays: 3,
      };
    default:
      return {
        first: "deposit the plan's capital into the protocol's main product",
        second: "use a second feature of the same protocol with a smaller amount",
        cadence: "every 3 days",
        cadenceDays: 3,
      };
  }
}

// How the plan's capital is split across its two positions: the main one
// carries most of it, the second a smaller share that still counts.
export function entryAndSecond(capitalUsd: number): { entry: number; second: number } {
  const entry = Math.round(capitalUsd * 0.8);
  return { entry, second: capitalUsd - entry };
}

export function planTotalsFor(row: Pick<BoardRow, "tvl_usd" | "chains" | "category">): PlanTotals {
  const capital = capitalFor(row.tvl_usd);
  const hold = holdDaysFor(row.tvl_usd);
  const perStepGas = gasFor(row.chains);
  const arch = archetypeFor(row.category);
  const visits = Math.max(1, Math.round(hold / arch.cadenceDays));
  const steps = 8;
  const gas = perStepGas * steps;
  const minutes = 5 + 10 + 5 * visits + 8 + 5 + 10 + 5 + 2;
  const { second } = entryAndSecond(capital);
  return {
    capital_usd: capital,
    gas_usd: gas,
    active_minutes: minutes,
    hold_days: hold,
    per_step_gas_usd: perStepGas,
    second_deposit_usd: second,
  };
}

// The eight steps, in the order they are done. Each carries its own cost
// and time in a trailing "Cost: ... Time: ..." note the page splits on.
// The steps are the same system for every row; the names, amounts and
// cadence are the row's own.
export function farmStepsFor(row: BoardRow): string[] {
  const t = planTotalsFor(row);
  const arch = archetypeFor(row.category);
  const { entry, second } = entryAndSecond(t.capital_usd);
  const chain = row.chains[0] ?? "its chain";
  const gas = (usd: number) => `$${usd.toFixed(2)}`;
  const cap = `$${t.capital_usd}`;
  const entryUsd = `$${entry}`;
  const secondUsd = `$${second}`;
  return [
    `Set up a fresh wallet, fund it with ${cap} plus ${gas(t.gas_usd)} for gas on ${chain}, and write the seed down offline before touching the protocol. Cost: ${gas(t.per_step_gas_usd)} Time: 5 min`,
    `Go to ${row.name}'s app, connect the wallet, and ${arch.first} with ${entryUsd} — keep the receipt token in this wallet, never a second one. Cost: ${gas(t.per_step_gas_usd)} Time: 10 min`,
    `Come back ${arch.cadence} and ${arch.second} with ${secondUsd}, so the wallet shows two distinct positions instead of one deposit. Cost: ${gas(t.per_step_gas_usd)} Time: 5 min per visit`,
    `Leave both positions alone for ${t.hold_days} days, checking in ${arch.cadence} only to confirm they are still live; do not withdraw early or the activity stops counting. Cost: $0.00 Time: 8 min total`,
    `If ${row.name} runs a points page, quests, or a leaderboard, claim what is offered and record the balance in a note with the date. Cost: ${gas(t.per_step_gas_usd)} Time: 5 min`,
    `Join the protocol's public channel, read the last two weeks of announcements for a snapshot date, and save any that name one. Cost: $0.00 Time: 10 min`,
    `A week before the snapshot — or at the end of the hold when no date is named — withdraw half of each position, then re-enter it the next day so the wallet stays active without resetting its age (two transactions). Cost: ${gas(2 * t.per_step_gas_usd)} Time: 5 min`,
    `When a token is announced, claim it from the same wallet, sell half at once (two transactions), and keep the rest for a month before deciding. Cost: ${gas(2 * t.per_step_gas_usd)} Time: 2 min`,
  ];
}

// ---------------------------------------------------------------- the economics

export type Verdict = "FARM" | "MARGINAL" | "SKIP";

export interface Econ {
  slice_usd: number;
  net_if_launch_usd: number;
  breakeven: number;
  ev_usd: number;
  net_per_hour_usd: number;
  pays_from_deposit_usd: number;
  ev_zero_deposit_usd: number;
  verdict: Verdict;
}

export function econFor(
  row: Pick<BoardRow, "curve_value_usd" | "tvl_usd" | "p_ref">,
  totals: PlanTotals,
  depositUsd: number,
  dropShare: number,
): Econ {
  const slice = (dropShare * row.curve_value_usd * depositUsd) / row.tvl_usd;
  const gas = totals.gas_usd;
  const netIfLaunch = slice - gas;
  const breakeven = slice > 0 ? gas / slice : Number.POSITIVE_INFINITY;
  const ev = row.p_ref * slice - gas;
  const netPerHour = ev / (totals.active_minutes / 60);
  const paysFrom = (gas * row.tvl_usd) / (dropShare * row.curve_value_usd);
  const evZero = (gas * row.tvl_usd) / (dropShare * row.curve_value_usd * row.p_ref);
  const verdict: Verdict =
    breakeven <= row.p_ref ? "FARM" : breakeven <= 1 ? "MARGINAL" : "SKIP";
  return {
    slice_usd: slice,
    net_if_launch_usd: netIfLaunch,
    breakeven,
    ev_usd: ev,
    net_per_hour_usd: netPerHour,
    pays_from_deposit_usd: paysFrom,
    ev_zero_deposit_usd: evZero,
    verdict,
  };
}
