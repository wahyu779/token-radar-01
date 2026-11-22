// Token Radar v3 — the page. Renders the board from data.js, recomputes
// every econ column live from 00-model.js, and runs the four checks.
(function () {
  "use strict";

  var D = window.TOKEN_RADAR;
  var M = window.TOKEN_RADAR_MODEL;
  var asOfMs = Date.parse(D.as_of + "T00:00:00Z");
  var offsets = {};
  D.categories.forEach(function (c) { offsets[c.category] = c.offset; });

  var state = { q: "", category: "", chain: "", verdict: "", deposit: 1000, drop: 0.07, watchOnly: false, tab: "board" };

  // -- format

  function money(x) {
    if (x === null || x === undefined || !isFinite(x)) return "—";
    var a = Math.abs(x);
    if (a >= 1e9) return "$" + (x / 1e9).toFixed(2) + "B";
    if (a >= 1e6) return "$" + (x / 1e6).toFixed(2) + "M";
    if (a >= 1e3) return "$" + (x / 1e3).toFixed(1) + "K";
    return "$" + x.toFixed(0);
  }
  function money2(x) {
    if (x === null || x === undefined || !isFinite(x)) return "—";
    return (x < 0 ? "−$" : "$") + Math.abs(x).toFixed(2);
  }
  function pct(x) {
    if (x === null || x === undefined || !isFinite(x)) return "—";
    return (x * 100).toFixed(1) + "%";
  }
  function ageFmt(days) {
    if (days >= 365) return (days / 365).toFixed(1) + "y";
    return days + "d";
  }
  function esc(s) {
    return String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
  }
  function $(id) { return document.getElementById(id); }

  // -- checks

  function runChecks() {
    var rec = 0, band = 0, econ = 0, steps = 0;
    D.rows.forEach(function (r) {
      if (M.curveValueFor(r, D.model, offsets, asOfMs) === r.curve_value_usd &&
          M.impliedFor(r, D.model, offsets, asOfMs) === r.implied_value_usd) rec++;
      if (r.p10_usd <= r.p25_usd && r.p25_usd <= r.p75_usd && r.p75_usd <= r.p90_usd &&
          r.p10_usd <= r.implied_value_usd && r.implied_value_usd <= r.p90_usd) band++;
      var e = M.econFor(r, r.totals, 1000, 0.07);
      var s = r.econ;
      var close = function (a, b) { return (a === null && b === null) || (a !== null && b !== null && Math.abs(a - b) <= Math.max(1e-6, Math.abs(b) * 1e-9)); };
      if (e.verdict === s.verdict && close(e.slice_usd, s.slice_usd) && close(e.net_if_launch_usd, s.net_if_launch_usd) &&
          close(e.breakeven, s.breakeven) && close(e.ev_usd, s.ev_usd) && close(e.net_per_hour_usd, s.net_per_hour_usd)) econ++;
      var stepsNow = M.farmStepsFor(r);
      if (stepsNow.length === r.farm_steps.length && stepsNow.every(function (st, i) { return st === r.farm_steps[i]; })) steps++;
    });
    var led = D.ledger;
    var ledSum = led.ranked + led.tokenRecorded + led.bridge + led.liquidStaking + led.exchangeCustody + led.versioned + led.wrapped;
    var ledOk = ledSum === led.total && led.total === 758;
    return {
      recompute: { ok: rec, n: D.rows.length },
      band: { ok: band, n: D.rows.length },
      econ: { ok: econ, n: D.rows.length },
      steps: { ok: steps, n: D.rows.length },
      ledger: { ok: ledOk, sum: ledSum },
    };
  }

  var checks = runChecks();

  function renderBadges() {
    var b = [
      { label: "board recomputes", ok: checks.recompute.ok === checks.recompute.n, text: checks.recompute.ok + "/" + checks.recompute.n },
      { label: "band holds", ok: checks.band.ok === checks.band.n, text: checks.band.ok + "/" + checks.band.n },
      { label: "econ closes", ok: checks.econ.ok === checks.econ.n, text: checks.econ.ok + "/" + checks.econ.n },
      { label: "ledger sums", ok: checks.ledger.ok, text: checks.ledger.sum + " / 758" },
    ];
    $("badges").innerHTML = b.map(function (x) {
      return '<span class="badge' + (x.ok ? "" : " fail") + '">' + (x.ok ? "✓" : "✗") + " " + x.label + " <b>" + x.text + "</b></span>";
    }).join("");
  }

  // -- header panels

  function renderKpis() {
    var v = D.validation;
    var counts = verdictCounts(state.deposit, state.drop);
    var impTot = 0; D.rows.forEach(function (r) { impTot += r.implied_value_usd; });
    var tiles = [
      { k: "Pricing · leave-one-out", v: "×" + v.loo.median_miss.toFixed(2), s: "median miss, " + D.model.live_count + " live tokens · within 3× " + pct(v.loo.le3) + " · within 10× " + pct(v.loo.le10) },
      { k: "Fit · walk-forward", v: "×" + v.walk_forward.median_miss.toFixed(2), s: "younger half · train " + v.walk_forward.train_n + " / test " + v.walk_forward.test_n + " · within 3× " + pct(v.walk_forward.le3) + " · cut " + v.walk_forward.cut },
      { k: "Band · range-hold", v: pct(v.range_hold.coverage), s: "first-half band covers the second half · P10 ×" + D.model.band_p10_mult.toFixed(3) + " / P90 ×" + D.model.band_p90_mult.toFixed(2) },
      { k: "Launch odds · held out", v: v.launch_odds.brier_model.toFixed(3), s: "Brier vs base " + v.launch_odds.brier_base.toFixed(3) + " · accuracy " + pct(v.launch_odds.accuracy) + " vs " + pct(v.launch_odds.base_accuracy) + " (n=" + v.launch_odds.test_n + ")" },
      { k: "Farm math · at $" + state.deposit.toLocaleString("en-US"), v: counts.FARM + " FARM", s: counts.MARGINAL + " MARGINAL / " + counts.SKIP + " SKIP · drop " + (state.drop * 100).toFixed(1) + "% · $250: " + verdictCounts(250, 0.07).FARM + " · $10,000: " + verdictCounts(10000, 0.07).FARM },
      { k: "Ranked · implied value", v: "198 · $" + (impTot / 1e6).toFixed(1) + "M", s: "40 watchlist + 20 off-list + 138 below floor · rank 1 " + D.rows[0].name + " $" + (D.rows[0].implied_value_usd / 1e6).toFixed(1) + "M" },
    ];
    $("kpis").innerHTML = tiles.map(function (t) {
      return '<div class="kpi"><div class="k">' + t.k + '</div><div class="v">' + t.v + '</div><div class="s">' + t.s + "</div></div>";
    }).join("");
  }

  function renderLedger() {
    var led = D.ledger;
    var segs = [
      { n: led.ranked, label: "ranked", color: "#39d98a" },
      { n: led.tokenRecorded, label: "already record a token", color: "#58a6ff" },
      { n: led.bridge, label: "bridges", color: "#8b98a9" },
      { n: led.liquidStaking, label: "liquid staking & restaking", color: "#b392f0" },
      { n: led.exchangeCustody, label: "exchange custody", color: "#f0b429" },
      { n: led.versioned, label: "versioned names", color: "#5c6b7d" },
      { n: led.wrapped, label: "wrapped or staked names", color: "#3a4a5c" },
    ];
    $("ledgerbar").innerHTML = segs.map(function (s) {
      return '<div style="width:' + (s.n / led.total * 100).toFixed(2) + "%;background:" + s.color + '" title="' + s.n + " " + s.label + '"></div>';
    }).join("");
    $("ledgertext").textContent = segs.map(function (s) { return s.n + " " + s.label; }).join(" · ") + " = " + led.total + ". Nothing is dropped silently.";
  }

  function renderPricing() {
    $("formula").textContent =
      "log10(mcap) = " + D.model.intercept.toFixed(4) + " + " + D.model.slope.toFixed(4) + " · log10(TVL)\n" +
      "curve = 10^(a + b·log10(TVL) + off_c) × g × m × d\n" +
      "ranked = round(curve × p_ref)";
    $("fitline").textContent =
      "Fitted on " + D.model.live_count + " live tokens · R² " + D.model.r2.toFixed(3) + " · residual sd " + D.model.residual_sd.toFixed(3) +
      " log10 · category offsets shrunk k=20 · band P10 ×" + D.model.band_p10_mult.toFixed(3) + " / P90 ×" + D.model.band_p90_mult.toFixed(2) + ".";
  }

  function renderSpotlight() {
    $("spotlight").innerHTML = D.rows.slice(0, 5).map(function (r) {
      return '<div class="spot" data-slug="' + esc(r.slug) + '"><div class="r">#' + r.rank + " · " + esc(r.category) + '</div><div class="n">' + esc(r.name) + '</div><div class="v">' + money(r.implied_value_usd) + '</div><div class="c">curve ' + money(r.curve_value_usd) + " × odds " + pct(r.p_ref) + "</div></div>";
    }).join("");
  }

  // -- econ + filters

  function verdictCounts(deposit, drop) {
    var c = { FARM: 0, MARGINAL: 0, SKIP: 0 };
    D.rows.forEach(function (r) { c[M.econFor(r, r.totals, deposit, drop).verdict]++; });
    return c;
  }

  function filteredRows() {
    var q = state.q.trim().toLowerCase();
    return D.rows.filter(function (r) {
      if (state.watchOnly && !r.is_watchlist) return false;
      if (state.category && r.category !== state.category) return false;
      if (state.chain && r.chains.indexOf(state.chain) === -1) return false;
      if (q && (r.name + " " + r.slug + " " + r.category).toLowerCase().indexOf(q) === -1) return false;
      if (state.verdict) {
        var e = M.econFor(r, r.totals, state.deposit, state.drop);
        if (e.verdict !== state.verdict) return false;
      }
      return true;
    });
  }

  function renderBoard() {
    var rows = filteredRows();
    var counts = verdictCounts(state.deposit, state.drop);
    $("count").textContent = "Showing " + rows.length + " of " + D.rows.length + " · " +
      counts.FARM + " FARM / " + counts.MARGINAL + " MARGINAL / " + counts.SKIP + " SKIP at $" +
      state.deposit.toLocaleString("en-US") + " and a " + (state.drop * 100).toFixed(1) + "% drop";
    $("verdictcounts").textContent = counts.FARM + " FARM / " + counts.MARGINAL + " MARGINAL / " + counts.SKIP + " SKIP";
    var html = "";
    rows.forEach(function (r) {
      var e = M.econFor(r, r.totals, state.deposit, state.drop);
      var first = r.farm_steps[0];
      var cut = first.indexOf(" Cost: ");
      var stepText = cut >= 0 ? first.slice(0, cut) : first;
      if (stepText.length > 90) stepText = stepText.slice(0, 87) + "…";
      var chainList = r.chains.slice(0, 3).join(", ") + (r.chains.length > 3 ? " +" + (r.chains.length - 3) : "");
      html += '<tr data-slug="' + esc(r.slug) + '">' +
        '<td class="num rank">' + r.rank + "</td>" +
        '<td><span class="name">' + esc(r.name) + "</span>" + (r.is_watchlist ? '<span class="wl">WATCHLIST</span>' : "") + '<span class="sub">' + esc(r.category) + " · " + esc(chainList) + "</span></td>" +
        '<td class="num">' + money(r.tvl_usd) + "</td>" +
        '<td class="num">' + (r.change_7d === null ? "—" : (r.change_7d >= 0 ? "+" : "") + r.change_7d.toFixed(1) + "%") + "</td>" +
        '<td class="num">' + ageFmt(r.age_days) + "</td>" +
        '<td class="num">' + pct(r.p_ref) + "</td>" +
        '<td class="num"><b>' + money(r.implied_value_usd) + '</b><span class="sub">P25 ' + money(r.p25_usd) + " – P75 " + money(r.p75_usd) + "</span></td>" +
        '<td class="num">' + money2(e.slice_usd) + "</td>" +
        '<td class="num">' + money2(e.net_if_launch_usd) + "</td>" +
        '<td class="num">' + (e.breakeven === Infinity ? "never" : pct(e.breakeven)) + "</td>" +
        '<td class="num">' + money2(e.net_per_hour_usd) + "/h</td>" +
        '<td><span class="pill ' + e.verdict + '">' + e.verdict + "</span></td>" +
        '<td class="farmcell">' + esc(stepText) + '<span class="sub">8 steps · gas ' + money2(r.totals.gas_usd) + " · pays from " + (e.pays_from_deposit_usd === Infinity ? "never" : money(e.pays_from_deposit_usd)) + "</span></td>" +
        "</tr>";
    });
    $("rows").innerHTML = html || '<tr><td colspan="13">No protocols match these filters.</td></tr>';
  }

  // -- tabs

  function renderModelTab() {
    var v = D.validation;
    $("model-intro").textContent =
      "The model is a size curve with category offsets and three small terms, fitted at runtime from the snapshot — no constant is typed from a paper. " +
      "Below are its tests, all computed from the same snapshot.";
    var abl = [
      ["Flat median ratio (no model)", v.loo_flat],
      ["Size curve alone", v.loo_size_only],
      ["Size curve + category offset (k = 20)", v.loo_cat],
      ["This model (V3-CAND)", v.loo],
      ["Same terms at full weight", v.loo_full_weights],
    ];
    $("ablation").querySelector("tbody").innerHTML = abl.map(function (row) {
      return "<tr><td>" + row[0] + '</td><td class="num">×' + row[1].median_miss.toFixed(2) + '</td><td class="num">' + pct(row[1].le3) + '</td><td class="num">' + pct(row[1].le10) + "</td></tr>";
    }).join("");
    $("wfline").textContent =
      "Walk-forward: fit on the " + v.walk_forward.train_n + " older-listed live tokens, tested on the " + v.walk_forward.test_n +
      " younger (cut " + v.walk_forward.cut + "): median miss ×" + v.walk_forward.median_miss.toFixed(2) + ", within 3× " + pct(v.walk_forward.le3) +
      ", within 10× " + pct(v.walk_forward.le10) + ". Range-hold: the band from the first half of the leave-one-out errors covers " +
      pct(v.range_hold.coverage) + " of the second half.";
    $("oddsline").textContent =
      "Age-by-size buckets, trained on the older half of dated protocols and tested on the younger half (n = " + v.launch_odds.test_n +
      "): Brier " + v.launch_odds.brier_model.toFixed(3) + " against the base rate's " + v.launch_odds.brier_base.toFixed(3) +
      "; accuracy " + pct(v.launch_odds.accuracy) + " against " + pct(v.launch_odds.base_accuracy) + ". The buckets help a little, on Brier — they do not turn the odds into a forecast.";
    $("agerates").querySelector("tbody").innerHTML = v.launch_odds.age_rates.map(function (a) {
      return "<tr><td>" + (a.label === "0-1y" ? "Under a year" : a.label === "1-2y" ? "1–2 years" : "Over two years") + '</td><td class="num">' + a.n + '</td><td class="num">' + pct(a.rate) + "</td></tr>";
    }).join("");
    var cats = D.categories.filter(function (c) { return c.n_live > 0; });
    $("offsets").querySelector("tbody").innerHTML = cats.map(function (c) {
      return "<tr><td>" + esc(c.category) + '</td><td class="num">' + c.n_live + '</td><td class="num">' + (c.offset >= 0 ? "+" : "") + c.offset.toFixed(3) + '</td><td class="num">' + pct(c.p_ref) + '</td><td class="num">' + c.n_board + "</td></tr>";
    }).join("");
  }

  function renderLiveTab() {
    $("livetable").querySelector("tbody").innerHTML = D.live_tokens.map(function (p) {
      return "<tr><td>" + esc(p.name) + "</td><td>" + esc(p.category) + '</td><td class="num">' + money(p.tvl_usd) + '</td><td class="num">' + money(p.mcap_usd) + '</td><td class="num">×' + (p.mcap_usd / p.tvl_usd).toFixed(2) + "</td></tr>";
    }).join("");
  }

  function renderCatsTab() {
    $("catstable").querySelector("tbody").innerHTML = D.categories.map(function (c) {
      return "<tr><td>" + esc(c.category) + '</td><td class="num">' + c.n_total + '</td><td class="num">' + c.n_token + '</td><td class="num">' + pct(c.p_ref) + '</td><td class="num">' + c.n_live + '</td><td class="num">' + (c.n_live > 0 ? (c.offset >= 0 ? "+" : "") + c.offset.toFixed(3) : "—") + '</td><td class="num">' + c.n_board + "</td></tr>";
    }).join("");
  }

  function renderFarmTab() {
    var deps = [250, 1000, 10000];
    var drops = [0.035, 0.07, 0.14];
    $("farmmatrix").querySelector("tbody").innerHTML = deps.map(function (dep) {
      var cells = drops.map(function (dr) {
        var c = verdictCounts(dep, dr);
        return '<td class="num">' + c.FARM + " FARM · " + c.MARGINAL + " MARG · " + c.SKIP + " SKIP</td>";
      }).join("");
      return "<tr><td>$" + dep.toLocaleString("en-US") + "</td>" + cells + "</tr>";
    }).join("");
    var workedSlugs = ["steakhouse-financial", "onre", "bittensor-dtao"];
    $("worked").innerHTML = workedSlugs.map(function (slug) {
      var r = D.rows.filter(function (x) { return x.slug === slug; })[0];
      if (!r) return "";
      var e = M.econFor(r, r.totals, 1000, 0.07);
      var vw = e.verdict === "FARM" ? "farms" : e.verdict === "MARGINAL" ? "is marginal" : "skips";
      var pays = e.pays_from_deposit_usd === Infinity ? "never" : "$" + Math.round(e.pays_from_deposit_usd).toLocaleString("en-US");
      var line;
      if (slug === "steakhouse-financial") line = "The biggest curve on the board (" + money(r.curve_value_usd) + ") still " + vw + " at $1,000: its " + money(r.tvl_usd) + " TVL shrinks the slice to " + money2(e.slice_usd) + " against " + money2(r.totals.gas_usd) + " of gas, and " + pct(r.p_ref) + " odds cannot cover a " + pct(e.breakeven) + " break-even.";
      else if (slug === "onre") line = "A " + money(r.curve_value_usd) + " curve at " + pct(r.p_ref) + " odds ranks #" + r.rank + " at " + money(r.implied_value_usd) + " — and still " + vw + " at $1,000: the slice is " + money2(e.slice_usd) + " against " + money2(r.totals.gas_usd) + " of gas, break-even " + pct(e.breakeven) + ".";
      else line = "The #" + r.rank + " ranked row (" + money(r.implied_value_usd) + ") " + vw + " at $1,000: " + money2(r.totals.gas_usd) + " of gas on a " + money2(e.slice_usd) + " slice, break-even " + pct(e.breakeven) + ".";
      return '<div class="worked"><h4>' + esc(r.name) + " — #" + r.rank + " · " + e.verdict + '</h4><p>' + line + " It pays from a " + pays + " deposit.</p><p class=\"note\">slice " + money2(e.slice_usd) + " · net if launch " + money2(e.net_if_launch_usd) + " · EV " + money2(e.ev_usd) + " · net/hour " + money2(e.net_per_hour_usd) + "</p></div>";
    }).join("");
    var best = D.rows.map(function (r) {
      return { r: r, e: M.econFor(r, r.totals, 1000, 0.07) };
    }).sort(function (a, b) { return b.e.net_per_hour_usd - a.e.net_per_hour_usd; }).slice(0, 5);
    $("besthour").querySelector("tbody").innerHTML = best.map(function (x) {
      return "<tr><td>" + esc(x.r.name) + " (#" + x.r.rank + ")</td>" +
        '<td class="num">' + money2(x.e.slice_usd) + '</td><td class="num">' + money2(x.e.net_if_launch_usd) + "</td>" +
        '<td class="num">' + pct(x.e.breakeven) + '</td><td class="num">' + money2(x.e.ev_usd) + '</td><td class="num">' + money2(x.e.net_per_hour_usd) + "/h</td></tr>";
    }).join("");
  }

  // -- detail dialog

  function openDetail(slug) {
    var r = D.rows.filter(function (x) { return x.slug === slug; })[0];
    if (!r) return;
    var e = M.econFor(r, r.totals, state.deposit, state.drop);
    var cat = D.categories.filter(function (c) { return c.category === r.category; })[0];
    $("d-name").textContent = r.name;
    $("d-sub").textContent = "#" + r.rank + " · " + r.category + " · TVL " + money(r.tvl_usd) + " · 7d " +
      (r.change_7d === null ? "—" : (r.change_7d >= 0 ? "+" : "") + r.change_7d.toFixed(1) + "%") +
      " · no token for " + ageFmt(r.age_days) + " · " + r.chains.join(", ") + (r.is_watchlist ? " · WATCHLIST" : "");
    $("d-val").textContent = money(r.implied_value_usd);
    $("d-chips").innerHTML =
      '<span class="chip">curve <b>' + money(r.curve_value_usd) + '</b></span>' +
      '<span class="chip">odds <b>' + pct(r.p_ref) + '</b></span>' +
      '<span class="chip">band <b>' + money(r.p10_usd) + " – " + money(r.p90_usd) + '</b></span>' +
      '<span class="chip">offset <b>' + (r.offset >= 0 ? "+" : "") + r.offset.toFixed(3) + '</b></span>' +
      '<span class="chip">growth <b>×' + r.growth.toFixed(2) + '</b></span>' +
      '<span class="chip">maturity <b>×' + r.maturity.toFixed(2) + '</b></span>' +
      '<span class="chip">breadth <b>×' + r.breadth.toFixed(2) + '</b></span>';
    var cell = function (k, v, cls) {
      return '<div class="ecell"><div class="k">' + k + '</div><div class="v' + (cls ? " " + cls : "") + '">' + v + "</div></div>";
    };
    $("d-econ").innerHTML =
      cell("Slice if launch", money2(e.slice_usd)) +
      cell("Net if launch", money2(e.net_if_launch_usd), e.net_if_launch_usd >= 0 ? "pos" : "neg") +
      cell("Break-even", e.breakeven === Infinity ? "never" : pct(e.breakeven)) +
      cell("Expected value", money2(e.ev_usd), e.ev_usd >= 0 ? "pos" : "neg") +
      cell("Net per hour", money2(e.net_per_hour_usd) + "/h", e.net_per_hour_usd >= 0 ? "pos" : "neg") +
      cell("Pays from", e.pays_from_deposit_usd === Infinity ? "never" : money(e.pays_from_deposit_usd));
    $("d-tier").textContent =
      "Plan capital " + money(r.totals.capital_usd) + " — money put to work in the protocol, not spent; only the gas is spent. It is not the deposit you chose ($" +
      state.deposit.toLocaleString("en-US") + "), which only sizes the slice. The plan spends " + money2(r.totals.gas_usd) +
      " of gas across 8 steps and " + r.totals.active_minutes + " active minutes over a " + r.totals.hold_days + "-day hold.";
    if (cat) {
      $("d-pref").textContent = r.p_ref === 0
        ? "Launch odds 0% — none of the " + cat.n_total + " protocols in " + r.category + " records a token yet. The ranked value is the $1 gate floor; the curve value if it launched is " + money(r.curve_value_usd) + "."
        : "Launch odds " + pct(r.p_ref) + " — " + cat.n_token + " of " + cat.n_total + " " + r.category + " protocols already record a token. A stock share, not a forecast.";
    }
    $("d-break").textContent =
      "curve " + money(r.curve_value_usd) + " × odds " + pct(r.p_ref) + " = " + money(r.implied_value_usd) + " ranked" +
      " · band P10 " + money(r.p10_usd) + " – P90 " + money(r.p90_usd) +
      " · offset " + (r.offset >= 0 ? "+" : "") + r.offset.toFixed(3) +
      " · growth ×" + r.growth.toFixed(2) + " · maturity ×" + r.maturity.toFixed(2) + " · breadth ×" + r.breadth.toFixed(2);
    var rowRec = M.curveValueFor(r, D.model, offsets, asOfMs) === r.curve_value_usd && M.impliedFor(r, D.model, offsets, asOfMs) === r.implied_value_usd;
    var rowBand = r.p10_usd <= r.p25_usd && r.p25_usd <= r.p75_usd && r.p75_usd <= r.p90_usd;
    var e0 = M.econFor(r, r.totals, 1000, 0.07);
    var rowEcon = e0.verdict === r.econ.verdict && Math.abs(e0.slice_usd - r.econ.slice_usd) <= Math.max(1e-6, Math.abs(r.econ.slice_usd) * 1e-9);
    var stepsNow = M.farmStepsFor(r);
    var rowSteps = stepsNow.length === r.farm_steps.length && stepsNow.every(function (st, i) { return st === r.farm_steps[i]; });
    var chk = function (ok, label) { return '<div class="' + (ok ? "ok" : "bad") + '">' + (ok ? "✓" : "✗") + " " + label + "</div>"; };
    $("d-checks").innerHTML =
      chk(rowRec, "this row recomputes: curve " + money(r.curve_value_usd) + " × odds " + pct(r.p_ref) + " = " + money(r.implied_value_usd)) +
      chk(rowBand, "the band holds: P10 ≤ P25 ≤ P75 ≤ P90") +
      chk(rowEcon, "the econ closes at $1,000 and 7%: slice " + money2(r.econ.slice_usd) + " · " + r.econ.verdict) +
      chk(rowSteps, "the 8 farm steps match the build");
    $("d-steps").innerHTML = r.farm_steps.map(function (st) {
      var ci = st.indexOf(" Cost: ");
      var text = ci >= 0 ? st.slice(0, ci) : st;
      var ct = ci >= 0 ? st.slice(ci + 7) : "";
      var ti = ct.indexOf(" Time: ");
      var cost = ti >= 0 ? ct.slice(0, ti) : ct;
      var time = ti >= 0 ? ct.slice(ti + 7) : "";
      return "<li>" + esc(text) + '<span class="ct">Cost: <b>' + esc(cost) + "</b> · Time: " + esc(time) + "</span></li>";
    }).join("");
    $("d-totals").innerHTML = "Plan totals: capital <b>" + money(r.totals.capital_usd) + "</b> · gas <b>" + money2(r.totals.gas_usd) +
      "</b> · active <b>" + r.totals.active_minutes + " min</b> · hold <b>" + r.totals.hold_days + " days</b> · 8 steps";
    var dlg = $("detail");
    if (!dlg.open) dlg.showModal();
    if (history.replaceState) history.replaceState(null, "", "#p=" + r.slug);
  }

  // -- wiring

  function setTab(tab) {
    state.tab = tab;
    document.querySelectorAll(".tabs button").forEach(function (b) { b.classList.toggle("on", b.dataset.tab === tab); });
    ["board", "model", "live", "cats", "farm"].forEach(function (t) {
      $("view-" + t).hidden = t !== tab;
    });
    if (tab === "model") renderModelTab();
    if (tab === "live") renderLiveTab();
    if (tab === "cats") renderCatsTab();
    if (tab === "farm") renderFarmTab();
  }

  function initControls() {
    var cats = [];
    D.rows.forEach(function (r) { if (cats.indexOf(r.category) === -1) cats.push(r.category); });
    cats.sort().forEach(function (c) {
      var o = document.createElement("option"); o.value = c; o.textContent = c; $("category").appendChild(o);
    });
    var chains = [];
    D.rows.forEach(function (r) { r.chains.forEach(function (ch) { if (chains.indexOf(ch) === -1) chains.push(ch); }); });
    chains.sort().forEach(function (c) {
      var o = document.createElement("option"); o.value = c; o.textContent = c; $("chain").appendChild(o);
    });
    $("q").addEventListener("input", function (ev) { state.q = ev.target.value; renderBoard(); });
    $("category").addEventListener("change", function (ev) { state.category = ev.target.value; renderBoard(); });
    $("chain").addEventListener("change", function (ev) { state.chain = ev.target.value; renderBoard(); });
    $("verdict").addEventListener("change", function (ev) { state.verdict = ev.target.value; renderBoard(); });
    $("deposit").addEventListener("change", function (ev) { state.deposit = Number(ev.target.value); renderBoard(); renderKpis(); });
    $("drop").addEventListener("change", function (ev) { state.drop = Number(ev.target.value); renderBoard(); renderKpis(); });
    $("watchonly").addEventListener("change", function (ev) { state.watchOnly = ev.target.checked; renderBoard(); });
    document.querySelectorAll(".tabs button").forEach(function (b) {
      b.addEventListener("click", function () { setTab(b.dataset.tab); });
    });
    $("rows").addEventListener("click", function (ev) {
      var tr = ev.target.closest("tr[data-slug]");
      if (tr) openDetail(tr.dataset.slug);
    });
    $("spotlight").addEventListener("click", function (ev) {
      var el = ev.target.closest("[data-slug]");
      if (el) openDetail(el.dataset.slug);
    });
    $("d-close").addEventListener("click", function () {
      $("detail").close();
      if (history.replaceState) history.replaceState(null, "", location.pathname + location.search);
    });
    $("detail").addEventListener("click", function (ev) {
      if (ev.target === $("detail")) {
        $("detail").close();
        if (history.replaceState) history.replaceState(null, "", location.pathname + location.search);
      }
    });
  }

  function initHash() {
    var h = location.hash || "";
    var m = h.match(/#p=([a-z0-9-]+)/);
    if (m) { openDetail(m[1]); return; }
    var v = h.match(/#verdict=(farm|marginal|skip)/i);
    if (v) {
      state.verdict = v[1].toUpperCase();
      $("verdict").value = state.verdict;
      renderBoard();
    }
  }

  renderBadges();
  renderKpis();
  renderLedger();
  renderPricing();
  renderSpotlight();
  initControls();
  renderBoard();
  initHash();
})();
