"""Unit tests for vrp_daily (run: python3 -m unittest discover -s scripts)."""
import math
import os
import sys
import unittest

sys.path.insert(0, os.path.dirname(__file__))
import vrp_daily as v  # noqa: E402


class VrpDailyTest(unittest.TestCase):
    def test_implied_vol_inverts_black_scholes(self):
        s, k, t, r = 5000.0, 5000.0, 375 / 390 / 252, 0.045
        for sigma in (0.08, 0.15, 0.40):
            price = v.bs_straddle(s, k, t, r, sigma)
            self.assertAlmostEqual(v.implied_vol(price, s, k, t, r), sigma, places=6)

    def test_implied_vol_rejects_impossible_price(self):
        self.assertIsNone(v.implied_vol(0.0, 5000.0, 5000.0, 0.001, 0.0))

    def test_realized_vol_constant_growth_is_zero(self):
        closes = [100 * math.exp(0.0001 * i) for i in range(50)]
        self.assertAlmostEqual(v.realized_vol(closes, 390), 0.0, places=9)

    def test_realized_vol_annualization(self):
        closes = [100.0, 101.0, 100.0, 101.0, 100.0]
        rets = [math.log(b / a) for a, b in zip(closes, closes[1:])]
        mean = sum(rets) / len(rets)
        sd = math.sqrt(sum((x - mean) ** 2 for x in rets) / len(rets))
        self.assertAlmostEqual(v.realized_vol(closes, 390), sd * math.sqrt(390 * 252), places=12)

    def test_parse_legs(self):
        self.assertEqual(v.parse_legs("1 Jun 1 4150 P STO 17.60 | 1 Jun 1 4150 C STO 19.70"),
                         (4150.0, 17.6, 19.7))
        self.assertIsNone(v.parse_legs("1 Jun 1 4150 P STO 17.60 | 1 Jun 1 4155 C STO 19.70"))


if __name__ == "__main__":
    unittest.main()
