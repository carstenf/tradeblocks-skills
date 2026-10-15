# Result object

One JSON object per run. Charts, tables and the verdict are all rendered from it so they agree. Numbers are copied from TradeBlocks tool output, never estimated. Use `null` for anything not run. The values below only illustrate the shape.

```json
{
  "block": "straddle-0dte-0945-atm",
  "strategy": null,
  "field": "vrp.vrp_0945",
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
  "checks": [{"name": "Plateau stable", "result": "region of 1 threshold", "flag": "WARN"}],
  "verdict": "…"
}
```

Field notes:
- `delta` = kept-trade total P&L minus `baseline.totalPl` (covered trades only).
- `direction`: `lt` keeps trades with field < threshold, `gt` keeps field > threshold.
- `eligible`: kept fraction ≥ `rule.minKeptFraction`.
- `flags`: any of `boundary`, `cliff`, `flat`, `narrow_region`, `u_shape`, `rule_dependent`.
- `years`: from `filter_curve` `perYear` (full-sample threshold applied per year); mark partial years and `lowSampleWarning` rows in the verdict.
- `significance`: copied from `filter_curve` `permutation` for the candidate; `family` lists the fields in that one request (the Holm family), `outsideFamily` the fields tried elsewhere.
