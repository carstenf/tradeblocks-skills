# Filter robustness: interpretation guide

Filter-specific notes for `is-this-filter-real`. The plateau rule and verdict wording are shared with is-this-optimum-real in [plateau-and-verdict.md](../../optimize/references/plateau-and-verdict.md).

## Why the best threshold is suspect

A sweep over 19 thresholds in two directions is 38 tries. The best of 38 noisy values is biased upward even when the field has no effect, and the bias grows with every extra threshold and field. Expect a real filter to deliver **less** than its best threshold showed, out of sample and live.

## U-shaped curves

If skipping the middle of the distribution helps, so that **both** extreme tails beat the baseline, the field marks unusual days rather than a monotonic edge. Typical causes are a few large P&L days in each tail, or a regime that drives both the field and the P&L. Report both tails and test single-day dependence for each. A one-sided filter chosen from a U-shape tells half the story.

## Single-day dependence

Short-premium and 0DTE blocks often have a handful of days that dominate total P&L. If removing one day turns Δ from clearly positive to near zero or negative, the filter is really a forecast of that day. Report the day, its P&L, and whether the filter keeps or removes it.

## Coverage and carried-forward values

Dataset values attach as of the last observation before the trade; a missing observation is filled from an older one unless `maxMissedSessions` limits it. Stale values make a filter look smoother than it is; refused values reduce coverage. State the limit and compare against the covered baseline, not the full block.

## Per-year rows

`filter_curve` `perYear` applies the **full-sample** threshold to each year. The threshold was chosen with all years in view, so positive years are consistency evidence, not independent confirmation. Treat `lowSampleWarning` rows as anecdotes.

## Out-of-sample split

One chronological split guards against choosing the threshold with knowledge of the later period. It is weak evidence: one split, one history, different regimes in each half. A positive second half supports the candidate; a negative one, or a first half that picks the opposite direction, is a strong warning.

## How the permutation works (TradeBlocks 4.4)

`filter_curve` with `permutation` answers: how often does the **best** threshold of a sweep on shuffled outcomes do at least as well as the observed best?

- **Selection-adjusted:** each shuffle reruns the whole threshold sweep and keeps its best, so the p-value accounts for picking the best threshold.
- **Calendar-month blocks:** outcomes are shuffled in whole months, order kept inside each month. Dependence within a month survives; dependence across months does not.
- **Add-one correction**, `(exceedances + 1) / (iterations + 1)`: with 499 iterations the smallest possible p is 0.002. Results are deterministic for a given seed.
- **Holm** adjusts across the fields of **one request**. Fields tried in other calls are outside the family; count them as extra burden.
- The p-value belongs to the best threshold of the grid in that call. It does not test the plateau centre or a threshold chosen elsewhere.

A large p (e.g. 0.5) means sweeps on shuffled data routinely find a threshold as good as the observed one: the best threshold is what searching produces, not evidence of an edge.

## Multiple testing

With 20 independent tries at 5 %, at least one "significant" result is more likely than not (`1 − 0.95^20 ≈ 64 %`). Put every field you are comparing into one permutation call, and report fields tried elsewhere.
