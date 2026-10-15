#!/usr/bin/env python3
"""vrp_daily: per-day implied vol (IV), realized vol (RV) and volatility risk premium (VRP)
of a 0DTE ATM straddle entered at a fixed time.

IV  = Black-Scholes implied vol of the straddle premium at entry (same-strike put + call),
      T = minutes from entry to 16:00 / 390 / 252 (trading-time basis), r constant, q = 0.
RV  = realized vol of the underlying's 1-minute closes from the entry bar to 16:00,
      std(log returns) * sqrt(390 * 252) (same time basis as IV).
      rv_5m: the same on 5-minute closes, * sqrt(78 * 252).
VRP = IV - RV, in vol points.

Inputs (read-only):
  --tradelog   straddle trade log: Option Omega CSV export or a TradeBlocks block's tradelog.csv
  --market-db  TradeBlocks market DuckDB (market.duckdb in the TradeBlocks data directory),
               table market.spot (ticker, date, time, close), opened read-only.
Outputs:
  --out        full CSV, one row per day (context columns included)
  --dataset    optional CSV for TradeBlocks import_daily_dataset (date + numeric columns only)

Modes:
  --check      report coverage (matched trades, days with minute bars, missing days) and exit.

Requires python3 and duckdb (pip install duckdb). Exit codes: 0 ok, 2 missing or unusable input.
"""
import argparse
import csv
import math
import os
import re
import sys

MINUTES_PER_DAY = 390
TRADING_DAYS = 252
FIELDS = ["date", "entry_time", "spot", "strike", "put", "call", "straddle", "t_minutes",
          "iv", "rv", "vrp", "rv_5m", "vrp_5m", "n_bars"]
DATASET_FIELDS = ["date", "iv", "rv", "vrp", "rv_5m", "vrp_5m"]
LEG_RE = re.compile(r"(\d+)\s+\w+\s+\d+\s+([\d.]+)\s+([PC])\s+(STO|BTO)\s+([\d.]+)")


def fail(msg):
    print(f"error: {msg}", file=sys.stderr)
    sys.exit(2)


def ncdf(x):
    return 0.5 * (1.0 + math.erf(x / math.sqrt(2.0)))


def bs_straddle(s, k, t, r, sigma):
    """Black-Scholes value of a same-strike call + put."""
    if t <= 0 or sigma <= 0:
        return abs(s - k)
    st = sigma * math.sqrt(t)
    d1 = (math.log(s / k) + (r + 0.5 * sigma * sigma) * t) / st
    d2 = d1 - st
    df = math.exp(-r * t)
    return (s * ncdf(d1) - k * df * ncdf(d2)) + (k * df * ncdf(-d2) - s * ncdf(-d1))


def implied_vol(price, s, k, t, r):
    """Bisection on [0.01 %, 500 %]; None if the price is outside that range."""
    lo, hi = 1e-4, 5.0
    if not (bs_straddle(s, k, t, r, lo) <= price <= bs_straddle(s, k, t, r, hi)):
        return None
    for _ in range(100):
        mid = 0.5 * (lo + hi)
        if bs_straddle(s, k, t, r, mid) > price:
            hi = mid
        else:
            lo = mid
    return 0.5 * (lo + hi)


def parse_legs(legs):
    """'1 Jun 1 4150 P STO 17.60 | 1 Jun 1 4150 C STO 19.70' -> (strike, put, call), else None."""
    put = call = kp = kc = None
    for part in legs.split("|"):
        m = LEG_RE.search(part.strip())
        if not m:
            continue
        k, side, price = float(m.group(2)), m.group(3), float(m.group(5))
        if side == "P":
            put, kp = price, k
        else:
            call, kc = price, k
    if put is None or call is None or kp != kc:
        return None
    return kp, put, call


def realized_vol(closes, bars_per_day):
    rets = [math.log(b / a) for a, b in zip(closes, closes[1:]) if a > 0 and b > 0]
    if len(rets) < 2:
        return None
    mean = sum(rets) / len(rets)
    var = sum((x - mean) ** 2 for x in rets) / len(rets)
    return math.sqrt(var) * math.sqrt(bars_per_day * TRADING_DAYS)


def read_trades(path, entry, date_from, date_to):
    if not os.path.exists(path):
        fail(f"trade log not found: {path}")
    trades, other_times = [], set()
    with open(path, newline="", encoding="utf-8-sig") as fh:
        reader = csv.DictReader(fh)
        need = {"Date Opened", "Time Opened", "Opening Price", "Legs"}
        if not need.issubset(reader.fieldnames or []):
            fail(f"trade log lacks columns {sorted(need - set(reader.fieldnames or []))}")
        for r in reader:
            d, tm = r["Date Opened"], r["Time Opened"][:5]
            if tm != entry:
                other_times.add(tm)
                continue
            if (date_from and d < date_from) or (date_to and d > date_to):
                continue
            legs = parse_legs(r["Legs"])
            if legs:
                trades.append((d, float(r["Opening Price"]), *legs))
    if not trades:
        hint = f"; entry times in the log: {sorted(other_times)[:10]}" if other_times else ""
        fail(f"no straddle trades at {entry} in {path}{hint}")
    return trades


def open_market(path, underlying):
    try:
        import duckdb
    except ImportError:
        fail("duckdb is not installed: pip install duckdb")
    if not os.path.exists(path):
        fail(f"market database not found: {path}")
    con = duckdb.connect(path, read_only=True)
    try:
        cols = {d[0] for d in con.execute("SELECT * FROM market.spot LIMIT 0").description}
    except duckdb.Error:
        cols = set()
    if not {"ticker", "date", "time", "close"}.issubset(cols):
        fail("market.spot with columns ticker, date, time, close not found; "
             "this TradeBlocks version stores minute bars differently")
    n = con.execute("SELECT COUNT(*) FROM market.spot WHERE ticker=?", [underlying]).fetchone()[0]
    if n == 0:
        fail(f"no {underlying} minute bars in market.spot; load them with TradeBlocks fetch_bars")
    return con


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--tradelog", required=True)
    ap.add_argument("--market-db", required=True)
    ap.add_argument("--entry", required=True, help="entry time HH:MM, as in the trade log")
    ap.add_argument("--underlying", default="SPX")
    ap.add_argument("--out", help="full CSV (default ./vrp_daily_HHMM.csv)")
    ap.add_argument("--dataset", help="also write an import_daily_dataset CSV here")
    ap.add_argument("--from", dest="date_from")
    ap.add_argument("--to", dest="date_to")
    ap.add_argument("--rate", type=float, default=0.045,
                    help="risk-free rate (forward drift). 0DTE: below 0.01 vol points at the money, "
                         "about 0.06 when the strike is 10 points from spot")
    ap.add_argument("--force", action="store_true", help="recompute days already in --out")
    ap.add_argument("--check", action="store_true", help="report coverage only")
    a = ap.parse_args()

    if not re.fullmatch(r"\d{2}:\d{2}", a.entry):
        fail("--entry must be HH:MM")
    eh, em = map(int, a.entry.split(":"))
    t_min = 16 * 60 - (eh * 60 + em)
    if t_min <= 0:
        fail("--entry must be before 16:00")
    t_years = t_min / MINUTES_PER_DAY / TRADING_DAYS
    out = a.out or f"vrp_daily_{a.entry.replace(':', '')}.csv"

    trades = read_trades(a.tradelog, a.entry, a.date_from, a.date_to)
    con = open_market(a.market_db, a.underlying)

    if a.check:
        days = {d for d, *_ in trades}
        have = {str(r[0]) for r in con.execute(
            "SELECT DISTINCT date FROM market.spot WHERE ticker=? AND time=?",
            [a.underlying, a.entry]).fetchall()}
        missing = sorted(days - have)
        print(f"trades at {a.entry}: {len(days)} days, {min(days)} .. {max(days)}")
        print(f"{a.underlying} minute bars at entry: {len(days & have)} of these days")
        if missing:
            print(f"missing minute bars: {len(missing)} days, first {missing[:5]}, last {missing[-5:]}")
        return 0

    existing = {}
    if os.path.exists(out) and not a.force:
        with open(out, newline="") as fh:
            existing = {r["date"]: r for r in csv.DictReader(fh)}
    todo = [t for t in trades if t[0] not in existing]
    rows, skipped = list(existing.values()), 0
    for d, spot, k, put, call in todo:
        bars = con.execute(
            "SELECT time, close FROM market.spot WHERE ticker=? AND date=? AND time>=? AND time<='16:00' "
            "ORDER BY time", [a.underlying, d, a.entry]).fetchall()
        if len(bars) < t_min * 0.8 or bars[0][0] != a.entry:
            skipped += 1
            continue
        closes = [c for _, c in bars]
        closes_5m = [c for tm, c in bars if int(tm[3:5]) % 5 == em % 5]
        rv = realized_vol(closes, MINUTES_PER_DAY)
        rv5 = realized_vol(closes_5m, MINUTES_PER_DAY // 5)
        straddle = put + call
        iv = implied_vol(straddle, spot, k, t_years, a.rate)
        if iv is None or rv is None:
            skipped += 1
            continue
        rows.append({
            "date": d, "entry_time": a.entry, "spot": spot, "strike": k, "put": put, "call": call,
            "straddle": round(straddle, 2), "t_minutes": t_min,
            "iv": round(iv * 100, 3), "rv": round(rv * 100, 3), "vrp": round((iv - rv) * 100, 3),
            "rv_5m": round(rv5 * 100, 3) if rv5 else "", "vrp_5m": round((iv - rv5) * 100, 3) if rv5 else "",
            "n_bars": len(bars),
        })
    con.close()

    rows.sort(key=lambda r: r["date"])
    for path, fields in ((out, FIELDS), (a.dataset, DATASET_FIELDS)):
        if not path:
            continue
        os.makedirs(os.path.dirname(os.path.abspath(path)), exist_ok=True)
        tmp = path + ".tmp"
        with open(tmp, "w", newline="") as fh:
            w = csv.DictWriter(fh, fieldnames=fields, extrasaction="ignore")
            w.writeheader()
            w.writerows(rows)
        os.replace(tmp, path)
    print(f"wrote {out}: {len(rows)} days ({len(todo) - skipped} new, {skipped} skipped: "
          f"incomplete minute bars or no valid IV)" + (f"; dataset {a.dataset}" if a.dataset else ""))
    return 0


if __name__ == "__main__":
    sys.exit(main())
