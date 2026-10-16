import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import * as os from 'node:os';
import http from 'node:http';

const home = await fs.mkdtemp(path.join(os.tmpdir(), 'oo-pull-test-'));
process.env.XDG_DATA_HOME = home;
const { pull } = await import('../scripts/oo-pull.mjs');
after(async () => fs.rm(home, { recursive: true, force: true }));

const columns = ['dateOpened', 'timeOpened', 'dateClosed', 'timeClosed', 'daysInTrade', 'underlying', 'legs', 'numberOfContracts', 'premiumPerContract', 'averageClosingCostPerContract', 'openingUnderlyingPrice', 'closingUnderlyingPrice', 'reasonClosed', 'profit', 'profitPercentage', 'fundsAtClose', 'buyingPowerRequired'];
const row = (n) => ['2026-01-02', '10:00:00', '2026-01-02', '15:00:00', 0, 'SPX', '1 Jan 2 5000 P STO 1.25 | 1 Jan 2 4990 P BTO 0.50', 1, 75, 0, 5000, 5010, 'Expired', n % 2 ? 2 : -1, null, 1000, 925];

// A small OO MCP server: one saved backtest of `total` trades, paged as OO pages, plus its curve.
function ooServer({ total = 250, refuseAt = null } = {}) {
  const calls = [];
  const profit = Array.from({ length: total }, (_, i) => (i % 2 ? 2 : -1)).reduce((a, b) => a + b, 0);
  const reply = (name, args) => {
    if (name === 'get_saved_backtest') return { id: 'bt-1', name: 'Fixture IC', parameters: { rangeStart: '2026-01-02', rangeEnd: '2026-01-05' }, result: { numberOfTrades: total, numberOfOpenTrades: 0, profit } };
    if (name === 'get_trade_log') {
      if (refuseAt !== null && args.offset >= refuseAt) return { error: 'Too many requests for this tool.' };
      const rows = Array.from({ length: Math.min(args.limit, total - args.offset) }, (_, i) => row(args.offset + i));
      const end = args.offset + rows.length;
      return { tradeColumns: columns, trades: rows, offset: args.offset, totalCount: total, nextOffset: end < total ? end : null, sortedBy: args.sortBy, direction: args.direction };
    }
    if (name === 'get_equity_curve') return { seriesStart: '2026-01-02', seriesEnd: '2026-01-05', pointColumns: ['date', 'netLiquidity', 'startingLiquidity', 'realizedFunds', 'tradingFunds', 'profitLoss', 'profitLossPercentage', 'drawdownPercentage'],
      points: [['2026-01-02', 1000, 1000, 1000, 1000, 0, 0, 0], ['2026-01-05', 990, 1000, 1000, 1000, -10, -1, -1]] };
    throw new Error(name);
  };
  const server = http.createServer((req, res) => {
    let body = '';
    req.on('data', (chunk) => { body += chunk; });
    req.on('end', () => {
      const message = JSON.parse(body);
      if (message.id === undefined) { res.writeHead(202); res.end(); return; }
      let result;
      if (message.method === 'initialize') result = { protocolVersion: '2025-03-26', capabilities: {}, serverInfo: { name: 'oo-mock', version: '0' } };
      else {
        calls.push({ name: message.params.name, args: message.params.arguments });
        const data = reply(message.params.name, message.params.arguments);
        result = data.error ? { isError: true, content: [{ type: 'text', text: data.error }] } : { content: [{ type: 'text', text: JSON.stringify(data) }] };
      }
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ jsonrpc: '2.0', id: message.id, result }));
    });
  });
  return new Promise((resolve) => server.listen(0, '127.0.0.1', () => resolve({ server, calls, url: `http://127.0.0.1:${server.address().port}/mcp` })));
}

test('pull pages a saved backtest through the capture hook and returns a verified capture with its curve', async () => {
  const { server, calls, url } = await ooServer();
  try {
    const summary = await pull({ url, sourceKey: 'savedBacktestId', sourceId: 'bt-1', minGapMs: 0 });
    assert.equal(summary.trades, 250);
    assert.equal(summary.reconciliation, 'count and net profit match OO to the cent');
    assert.equal(summary.curve.rows, 2);
    assert.equal(calls.filter((c) => c.name === 'get_trade_log').length, 3);
    assert.ok(calls.filter((c) => c.name === 'get_trade_log').every((c) => c.args.limit === 100 && c.args.sortBy === 'opened' && c.args.direction === 'asc'));
    const csv = await fs.readFile(summary.csvPath, 'utf8');
    assert.equal(csv.trim().split('\n').length, 251);
    await fs.access(summary.dailyLogPath);
  } finally { server.close(); }
});

test('dry run reads only the headline and leaves no capture behind', async () => {
  const { server, calls, url } = await ooServer();
  try {
    const before = await fs.readdir(path.join(home, 'tradeblocks', 'oo-captures')).catch(() => []);
    const summary = await pull({ url, sourceKey: 'savedBacktestId', sourceId: 'bt-1', minGapMs: 0, dryRun: true });
    assert.deepEqual([summary.dryRun, summary.trades, calls.length], [true, 250, 1]);
    const after = await fs.readdir(path.join(home, 'tradeblocks', 'oo-captures'));
    assert.deepEqual(after.filter((name) => name !== 'active').sort(), before.filter((name) => name !== 'active').sort());
  } finally { server.close(); }
});

test('an OO refusal stops the pull before any CSV is written', async () => {
  const { server, url } = await ooServer({ refuseAt: 100 });
  try {
    await assert.rejects(pull({ url, sourceKey: 'savedBacktestId', sourceId: 'bt-1', minGapMs: 0 }), (error) => error.message.startsWith('OO_REFUSED: get_trade_log'));
    const dirs = (await fs.readdir(path.join(home, 'tradeblocks', 'oo-captures'))).filter((name) => name !== 'active');
    for (const dir of dirs) {
      const files = await fs.readdir(path.join(home, 'tradeblocks', 'oo-captures', dir));
      if (!files.includes('verification.json')) assert.ok(!files.includes('tradelog.csv'));
    }
  } finally { server.close(); }
});
