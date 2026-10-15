---
name: vrp-daily
description: Computes the daily volatility risk premium (VRP) of a 0DTE ATM straddle at a fixed entry time - implied vol from the straddle premium, realized vol from the underlying's minute bars over the rest of the day, VRP = IV - RV - and imports it as a TradeBlocks daily dataset with lookahead-safe timing. Use when IV, RV or VRP per day is needed, e.g. to test a VRP entry filter.
compatibility: Requires a TradeBlocks MCP server with daily datasets (import_daily_dataset) and read access to its data directory (market.duckdb), as with a local install. Minute bars of the underlying in TradeBlocks (fetch_bars from a configured provider). Python 3.9+ with duckdb. Option Omega MCP optional, to create a missing straddle backtest.
metadata:
  author: carsten
  version: "1.0.0"
---

# Daily VRP of a 0DTE straddle

Builds one row per trading day: implied vol of the ATM straddle bought or sold at the entry time, realized vol of the underlying from that minute to the close, and their difference. The result becomes a TradeBlocks daily dataset, so other skills (e.g. a filter test with `filter_curve`) can use it with correct timing. Definitions and their limits: [references/definitions.md](references/definitions.md).

## Prerequisites

- TradeBlocks MCP server with `import_daily_dataset`; the agent can read the server's data directory (the script opens `market.duckdb` read-only).
- Underlying minute bars in TradeBlocks for the period, or a provider configured for `fetch_bars`.
- A straddle price per day at the entry time (step 2).
- `python3` with `duckdb` (`pip install duckdb`).

## Process

```
- [ ] 1 Choose underlying, entry time, period
- [ ] 2 Find a straddle source (block, else Option Omega with consent)
- [ ] 3 Check minute-bar coverage, fill gaps with fetch_bars
- [ ] 4 Compute
- [ ] 5 Import as dataset and verify
```

### 1. Choose underlying, entry time, period

Ask for the underlying (default SPX), the entry time (HH:MM, US Eastern) and the period. All later steps use exactly this entry time.

### 2. Find a straddle source

In this order:

1. **Existing block.** `list_blocks` and `get_block_info`: look for a block of 0DTE ATM straddles (one put and one call, same strike) opened at the entry time. Its `tradelog.csv` in the data directory is the source.
2. **Option quotes.** If the server reports minute option quotes for the underlying, a quote-based straddle price would be more precise than backtest fills; the script does not read quotes yet, so note it and continue.
3. **New Option Omega backtest, only with consent.** If no block exists and the Option Omega MCP is available, explain that a backtest uses the user's Option Omega allowance and ask before running. Then set up a 0DTE short (or long) straddle at the ATM strike, entered at the entry time, held to expiry, one contract, over the period; run it, and import it with [oo-capture](../oo-capture/SKILL.md) if this setup supports capture (the server must be able to read the capture folder), otherwise export the trade log as CSV from Option Omega and import it with `import_csv`.
4. **Nothing available:** say which input is missing and stop.

Backtest fills follow Option Omega's fill model, so IV reflects backtest prices, not exact mid quotes. State this in the result.

### 3. Check coverage

```bash
python3 scripts/vrp_daily.py --check --tradelog <tradelog.csv> --market-db <data-dir>/market.duckdb --entry HH:MM
```

It reports matched trade days and days without minute bars. Fill gaps with `fetch_bars` (`timespan: "1m"`) for the underlying and the missing dates, then check again. Days that stay incomplete are skipped, never estimated.

### 4. Compute

```bash
python3 scripts/vrp_daily.py --tradelog <tradelog.csv> --market-db <data-dir>/market.duckdb \
  --entry HH:MM --out vrp_daily_HHMM.csv --dataset <data-dir>/datasets/vrp_HHMM.csv
```

Incremental by default (existing days in `--out` are kept; `--force` recomputes). The summary line gives new and skipped days. Report numbers only from the output.

### 5. Import and verify

`import_daily_dataset` with the dataset CSV (a `csvPath` under the server's data root, or inline `content`), a name such as `vrp_HHMM`, the underlying as `ticker`, and timing:

| Column | Timing | Why |
|---|---|---|
| `iv` | `open`, `knownBy` = entry time | known at entry |
| `rv`, `vrp`, `rv_5m`, `vrp_5m` | `close` | need the rest of the day; usable from the next day |

Verify with `list_daily_datasets` (rows, coverage) and `list_analysis_fields` (timing per field). A same-day filter may use `iv` only; `rv`/`vrp` apply as prior-day values.

## Interpretation Reference

See [references/definitions.md](references/definitions.md): formulas, the time basis shared by IV and RV, why the window starts at entry, the 5-minute variant, and what backtest fills mean for IV.

## Related Skills

- [Parameter exploration](../optimize/SKILL.md): test a VRP field with `filter_curve` and `suggest_filters`.
- [oo-capture](../oo-capture/SKILL.md): import an Option Omega straddle backtest.
- [market-data](../market-data/SKILL.md): load minute bars.

## What NOT to Do

- Don't run an Option Omega backtest without the user's consent.
- Don't use same-day `rv` or `vrp` to filter same-day trades; they are only known at the close.
- Don't fill missing days with estimates; skip and report them.
- Don't mix entry times: the straddle and the RV window must start at the same minute.
