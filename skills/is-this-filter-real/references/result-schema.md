# Result object

One JSON object per run. Charts, tables and the verdict are all rendered from it so they agree. Numbers are copied from TradeBlocks tool output, never estimated. Use `null` for anything not run. The values below only illustrate the shape.

```json
{
  "block": "straddle-0dte-0945-atm",
  "strategy": null,
  "field": "vrp.vrp_0945",
  "purpose": "edge",
  "unit": "day",
  "objective": "totalPl",
  "granularity": {"entriesPerDay": 1, "removedDays": 820},
  "timing": "close",
  "maxMissedSessions": 1,
  "baseline": {"covered": 1094, "totalPl": 6709, "uncovered": 1, "uncoveredPl": -1147},
  "rule": {"minKeptFraction": 0.2, "tol": 0.25, "tolCheck": 0.5},
  "curve": [
    {"threshold": -1.49, "direction": "lt", "kept": 110, "keptFraction": 0.10,
     "winRate": 0.664, "totalPl": 30543, "delta": 23834, "eligible": false}
  ],
  "best":   {"threshold": -0.057, "direction": "lt", "delta": 13033},
  "centre": {"threshold": -0.057, "direction": "lt", "delta": 13033},
  "region": {"thresholds": [-0.057], "stableUnderTolCheck": true},
  "flags": ["boundary", "u_shape"],
  "suggestFilters": {"rule": "Skip when vrp.vrp_0945 < 2.223", "keptFraction": 0.25, "confidence": "high", "agrees": false},
  "years": [{"year": 2023, "covered": 250, "keptCentre": 60, "deltaBest": 1200, "deltaCentre": 900}],
  "singleDay": [{"date": "2025-04-09", "pl": -32085, "keptByCentre": false, "deltaWith": 13033, "deltaWithout": -2000}],
  "oos": {"split": "2024-08-14", "isThreshold": -0.2, "isDeltaPerKept": 80.1, "oosDeltaPerKept": -12.4},
  "significance": {"pValue": 0.55, "pValueHolm": 1.0, "iterations": 499, "blockCount": 53, "seed": 42,
                   "grid": "default percentileSteps", "family": ["vrp.vrp_0945", "vrp.vrp5_0945", "vrp.iv_0945"],
                   "outsideFamily": []},
  "risk": {"objective": null, "plCost": null, "maxDrawdownBase": null, "maxDrawdownFiltered": null, "marBase": null, "marFiltered": null, "episode": null, "pValue": null, "iterations": null},
  "outsideServer": [],
  "regimes": {"source": "analyze_regime_performance", "definitions": {
    "primary":     {"definition": "…", "buckets": [{"regime": "…", "trades": 0, "totalPl": 0, "avgPl": 0, "winRate": 0}]},
    "alternative": {"definition": "…", "buckets": []}}, "rankingHolds": null},
  "checks": [{"name": "Plateau stable", "result": "region of 1 threshold", "flag": "WARN"}],
  "verdict": "…"
}
```

Field notes:
- `purpose`: `edge` or `risk` (step 1). `granularity`: entries per day and days removed at the candidate.
- `unit`: `day` or `trade` (`trade` only after `day_field_varies`). `objective`: the step 1 objective.
- `risk`: server-reported values for the candidate (risk purpose); `null` when not run, with the refusal named in `checks`. `outsideServer`: labelled supplements (method, script path), never used to flip a check.
- `delta` = kept-trade total P&L minus `baseline.totalPl` (covered trades only).
- `direction`: `lt` keeps trades with field < threshold, `gt` keeps field > threshold.
- `eligible`: kept fraction ≥ `rule.minKeptFraction`.
- `flags`: any of `boundary`, `cliff`, `flat`, `narrow_region`, `u_shape`, `rule_dependent`.
- `years`: from `filter_curve` `perYear` (full-sample threshold applied per year); mark partial years and `lowSampleWarning` rows in the verdict.
- `regimes`: descriptive only, copied from `perGroup` or the server's regime breakdown; `null` when not run.
- `significance`: copied from `filter_curve` `permutation` for the candidate; `family` lists the fields in that one request (the Holm family), `outsideFamily` the fields tried elsewhere.
