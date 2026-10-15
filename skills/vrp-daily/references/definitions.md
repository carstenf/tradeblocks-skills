# VRP definitions

All values are annualized volatilities in percent (vol points). IV and RV use the same window and the same time basis, so their difference is meaningful.

## Implied volatility (`iv`)

Black-Scholes implied vol of the straddle premium (put + call at the same strike) at entry:

- Time to expiry `T = minutes from entry to 16:00 / 390 / 252` (trading-time basis).
- Spot = the trade's opening underlying price; strike from the legs.
- Rate `r` = 4.5 % by default (forward drift). For 0DTE its effect is below 0.01 vol points at the money and about 0.06 when the strike is 10 points from spot. Dividends are ignored.
- Solved by bisection between 0.01 % and 500 %; a premium outside that range yields no value for the day.

Premiums from a backtest follow its fill model (slippage, mid or not), so `iv` reflects those prices rather than exact market mids.

## Realized volatility (`rv`)

Standard deviation of 1-minute log returns of the underlying from the entry bar to 16:00, annualized with `sqrt(390 * 252)`.

- The window starts at entry, not at the open: the opening minutes carry much variance that the straddle never sees.
- `rv_5m` uses 5-minute closes aligned to the entry minute, annualized with `sqrt(78 * 252)`; it is less affected by microstructure noise.
- Days with less than 80 % of the expected bars, or without a bar at the entry minute, are skipped.

## VRP

`vrp = iv - rv`, and `vrp_5m = iv - rv_5m`. Positive values mean the straddle was priced above the volatility that followed.

## Timing

`iv` is known at the entry time. `rv` and `vrp` are known only after the close, so as filters they can only be used from the next day (import them with `close` timing). A live filter on today's VRP needs a forecast of `rv`, which this skill does not provide.
