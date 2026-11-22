// Token Radar v3 — main.ts (Node 22, standard library only).
//
// Reads the sealed snapshot at /input/snapshot.json, fits the size-curve
// model at runtime, ranks the 198 clean protocols with no token recorded,
// writes the board to /output/board.json, the dashboard's data beside the
// page as data.js, copies dashboard/ and screenshots/ to /output, and
// writes /output/dossier.json with the kit's buildDossier.
//
// Run it yourself the same way the grader runs it:
//   node main.ts --input /input --output /output
// With no flags it reads /input/snapshot.json and writes /output.
// The run is deterministic: two runs from the same snapshot write the same
// bytes. No wall clock, no network, no random numbers anywhere.

import { cpSync, existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { buildBoard } from "./lib/model.ts";
import type { Snapshot } from "./lib/model.ts";
import { econFor, farmStepsFor, planTotalsFor } from "./lib/farm.ts";
import { buildDossier } from "./vendor/makefun-board.ts";

const DEFAULT_DEPOSIT_USD = 1000;
const DEFAULT_DROP_SHARE = 0.07;

function argValue(name: string, fallback: string): string {
  const i = process.argv.indexOf(name);
  return i >= 0 && process.argv[i + 1] !== undefined ? process.argv[i + 1]! : fallback;
}

// JSON wants finite numbers: an infinite break-even or pays-from becomes null.
function fin(x: number): number | null {
  return Number.isFinite(x) ? x : null;
}

function main(): void {
  const inputDir = argValue("--input", "/input");
  const outputDir = argValue("--output", "/output");
  const snap = JSON.parse(readFileSync(join(inputDir, "snapshot.json"), "utf8")) as Snapshot;

  const built = buildBoard(snap);
  const { rows, fit, validation, ledger, categories, liveTokens } = built;

  const boardRows = rows.map((row) => {
    const totals = planTotalsFor(row);
    const econ = econFor(row, totals, DEFAULT_DEPOSIT_USD, DEFAULT_DROP_SHARE);
    return {
      ...row,
      totals,
      econ: {
        slice_usd: econ.slice_usd,
        net_if_launch_usd: econ.net_if_launch_usd,
        breakeven: fin(econ.breakeven),
        ev_usd: econ.ev_usd,
        net_per_hour_usd: econ.net_per_hour_usd,
        pays_from_deposit_usd: fin(econ.pays_from_deposit_usd),
        ev_zero_deposit_usd: fin(econ.ev_zero_deposit_usd),
        verdict: econ.verdict,
      },
      farm_steps: farmStepsFor(row),
    };
  });

  mkdirSync(outputDir, { recursive: true });

  // The board: the gate reads this. Minimal shape, no extras.
  const board = {
    generated: snap.as_of,
    as_of: snap.as_of,
    rows: boardRows.map((r) => ({
      slug: r.slug,
      name: r.name,
      rank: r.rank,
      implied_value_usd: r.implied_value_usd,
      farm_steps: r.farm_steps,
    })),
  };
  writeFileSync(join(outputDir, "board.json"), JSON.stringify(board, null, 2) + "\n", "utf8");

  // The page's data: everything the dashboard shows, beside the page.
  const data = {
    generated: snap.as_of,
    as_of: snap.as_of,
    floor_usd: snap.floor_usd,
    model: {
      name: "size curve, category offsets, small terms",
      intercept: fit.intercept,
      slope: fit.slope,
      r2: fit.r2,
      residual_sd: fit.residualSd,
      live_count: fit.n,
      cat_k: 20,
      growth_w: 0.25,
      mat_floor: 0.8,
      mat_range: 0.2,
      breadth_w: 0.01,
      band_p10_mult: 10 ** validation.loo.p10,
      band_p90_mult: 10 ** validation.loo.p90,
    },
    validation: {
      loo: {
        median_miss: validation.loo.medianMiss,
        le3: validation.loo.le3,
        le10: validation.loo.le10,
        spearman: validation.loo.spearman,
        p10_log: validation.loo.p10,
        p25_log: validation.loo.p25,
        p75_log: validation.loo.p75,
        p90_log: validation.loo.p90,
      },
      loo_flat: {
        median_miss: validation.looFlat.medianMiss,
        le3: validation.looFlat.le3,
        le10: validation.looFlat.le10,
      },
      loo_size_only: {
        median_miss: validation.looSizeOnly.medianMiss,
        le3: validation.looSizeOnly.le3,
        le10: validation.looSizeOnly.le10,
      },
      loo_cat: {
        median_miss: validation.looCat.medianMiss,
        le3: validation.looCat.le3,
        le10: validation.looCat.le10,
      },
      loo_full_weights: {
        median_miss: validation.looFullWeights.medianMiss,
        le3: validation.looFullWeights.le3,
        le10: validation.looFullWeights.le10,
      },
      walk_forward: {
        train_n: validation.walkForward.trainN,
        test_n: validation.walkForward.testN,
        median_miss: validation.walkForward.medianMiss,
        le3: validation.walkForward.le3,
        le10: validation.walkForward.le10,
        cut: validation.walkForward.cut,
      },
      range_hold: {
        coverage: validation.rangeHold.coverage,
        p10_log: validation.rangeHold.p10,
        p90_log: validation.rangeHold.p90,
      },
      launch_odds: {
        brier_model: validation.launchOdds.brierModel,
        brier_base: validation.launchOdds.brierBase,
        accuracy: validation.launchOdds.accuracy,
        base_accuracy: validation.launchOdds.baseAccuracy,
        test_n: validation.launchOdds.testN,
        base_rate: validation.launchOdds.baseRate,
        age_rates: validation.launchOdds.ageRates,
      },
    },
    ledger,
    categories,
    live_tokens: liveTokens,
    rows: boardRows,
  };
  writeFileSync(
    join(outputDir, "data.js"),
    `window.TOKEN_RADAR = ${JSON.stringify(data, null, 2)};\n`,
    "utf8",
  );

  // The page and its pictures, copied whole.
  cpSync(join(import.meta.dirname, "dashboard"), join(outputDir, "dashboard"), { recursive: true });
  const shotsDir = join(import.meta.dirname, "screenshots");
  const outShots = join(outputDir, "screenshots");
  if (existsSync(shotsDir)) cpSync(shotsDir, outShots, { recursive: true });

  // The dossier: what the judge reads. Skipped only when there are no
  // screenshots yet — a build run before the pictures are taken.
  let dossierBytes = 0;
  const hasShots = existsSync(outShots) && readdirSync(outShots).some((f) => !f.startsWith("."));
  if (hasShots) {
    const dossier = buildDossier(outputDir, { text_max_bytes: 65536 });
    writeFileSync(join(outputDir, "dossier.json"), dossier);
    dossierBytes = dossier.length;
  } else {
    console.log("note: no screenshots/ yet — dossier skipped");
  }

  // The run's own numbers, printed for the record.
  const verdicts = { FARM: 0, MARGINAL: 0, SKIP: 0 };
  for (const r of boardRows) verdicts[r.econ.verdict]++;
  const ledgerSum =
    ledger.ranked +
    ledger.tokenRecorded +
    ledger.bridge +
    ledger.liquidStaking +
    ledger.exchangeCustody +
    ledger.versioned +
    ledger.wrapped;
  console.log(`rows: ${rows.length} (watchlist ${rows.filter((r) => r.is_watchlist).length}, off-list above floor ${rows.filter((r) => r.is_off_list).length})`);
  console.log(`ledger: ranked ${ledger.ranked} + token ${ledger.tokenRecorded} + bridge ${ledger.bridge} + liquid-staking ${ledger.liquidStaking} + exchange ${ledger.exchangeCustody} + versioned ${ledger.versioned} + wrapped ${ledger.wrapped} = ${ledgerSum} (snapshot ${ledger.total})`);
  console.log(`size curve: log10(mcap) = ${fit.intercept.toFixed(4)} + ${fit.slope.toFixed(4)} * log10(TVL), R2 ${fit.r2.toFixed(3)}, residual sd ${fit.residualSd.toFixed(3)} log10, n=${fit.n}`);
  console.log(`LOO V3-CAND: median miss x${validation.loo.medianMiss.toFixed(2)}, <=3x ${(validation.loo.le3 * 100).toFixed(1)}%, <=10x ${(validation.loo.le10 * 100).toFixed(1)}%, Spearman ${validation.loo.spearman.toFixed(3)}, band x${(10 ** validation.loo.p10).toFixed(3)} / x${(10 ** validation.loo.p90).toFixed(2)}`);
  console.log(`ablation LOO: flat x${validation.looFlat.medianMiss.toFixed(2)} | size x${validation.looSizeOnly.medianMiss.toFixed(2)} | +cat k=20 x${validation.looCat.medianMiss.toFixed(2)} | V3-CAND x${validation.loo.medianMiss.toFixed(2)} | full weights x${validation.looFullWeights.medianMiss.toFixed(2)}`);
  console.log(`walk-forward: train ${validation.walkForward.trainN}, test ${validation.walkForward.testN}, median miss x${validation.walkForward.medianMiss.toFixed(2)}, <=3x ${(validation.walkForward.le3 * 100).toFixed(1)}% (cut ${validation.walkForward.cut})`);
  console.log(`range-hold: band from first half covers ${(validation.rangeHold.coverage * 100).toFixed(0)}% of the second half`);
  console.log(`launch odds held out: Brier ${validation.launchOdds.brierModel.toFixed(3)} vs base ${validation.launchOdds.brierBase.toFixed(3)}, accuracy ${(validation.launchOdds.accuracy * 100).toFixed(1)}% vs base ${(validation.launchOdds.baseAccuracy * 100).toFixed(1)}% (n=${validation.launchOdds.testN})`);
  console.log(`top-10 ranked: ${rows.slice(0, 10).map((r) => `${r.slug} $${r.implied_value_usd.toLocaleString("en-US")}`).join(", ")}`);
  console.log(`verdicts at $1,000 / 7%: FARM ${verdicts.FARM}, MARGINAL ${verdicts.MARGINAL}, SKIP ${verdicts.SKIP}`);
  console.log(`dossier: ${dossierBytes} bytes`);
}

main();
