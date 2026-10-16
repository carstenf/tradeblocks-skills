#!/usr/bin/env node
// oo-pull: run oo-capture's paging loop as a script instead of model turns.
// It calls the OO MCP server itself (Streamable HTTP), feeds every response to oo-capture's own hook
// and runs oo-capture's verify, so the result is the same verified capture the skill produces,
// without one model turn per 100-trade page. The model only sees the final summary.
import http from 'node:http';
import https from 'node:https';
import { randomUUID } from 'node:crypto';
import { realpathSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { start, hook, stop, verify, remove } from './oo-capture.mjs';
import { plusYears } from './oo-session-calendar.mjs';

const SOURCES = { runId: 'get_backtest_results', savedBacktestId: 'get_saved_backtest', savedPortfolioId: 'get_saved_portfolio' };
const SERVER = 'mcp__optionomega'; // tool-name prefix recorded for every call; verify requires one server per capture

function fail(reason, detail) { throw new Error(`${reason}: ${detail}`); }

// Minimal Streamable-HTTP MCP client. With HTTP_PROXY set, plain-HTTP requests go to the proxy as
// absolute-URI requests (so an injecting gateway can add credentials); OO_MCP_TOKEN adds a bearer token.
export function client(url, { token = process.env.OO_MCP_TOKEN, proxy = process.env.HTTP_PROXY || process.env.http_proxy } = {}) {
  const target = new URL(url);
  const viaProxy = proxy && target.protocol === 'http:' ? new URL(proxy) : null;
  const lib = target.protocol === 'https:' ? https : http;
  let session = null, protocol = null, nextId = 1;
  const post = (body) => new Promise((resolve, reject) => {
    const headers = { 'content-type': 'application/json', accept: 'application/json, text/event-stream', 'content-length': Buffer.byteLength(body) };
    if (session) headers['mcp-session-id'] = session;
    if (protocol) headers['mcp-protocol-version'] = protocol;
    if (token) headers.authorization = `Bearer ${token}`;
    const options = viaProxy
      ? { host: viaProxy.hostname, port: viaProxy.port || 80, method: 'POST', path: target.href, headers: { ...headers, host: target.host } }
      : { host: target.hostname, port: target.port || (target.protocol === 'https:' ? 443 : 80), method: 'POST', path: target.pathname + target.search, headers };
    if (viaProxy && (viaProxy.username || viaProxy.password)) options.headers['proxy-authorization'] = `Basic ${Buffer.from(`${decodeURIComponent(viaProxy.username)}:${decodeURIComponent(viaProxy.password)}`).toString('base64')}`;
    const req = (viaProxy ? http : lib).request(options, (res) => {
      const chunks = [];
      if (res.headers['mcp-session-id']) session = res.headers['mcp-session-id'];
      res.on('data', (chunk) => chunks.push(chunk));
      res.on('end', () => resolve({ status: res.statusCode, type: res.headers['content-type'] || '', text: Buffer.concat(chunks).toString('utf8') }));
    });
    req.setTimeout(180000, () => req.destroy(new Error('timeout')));
    req.on('error', reject);
    req.end(body);
  });
  const parse = (response) => {
    if (response.status >= 400) fail('OO_HTTP', `${response.status} ${response.text.slice(0, 200)}`);
    if (!response.type.includes('text/event-stream')) return JSON.parse(response.text);
    const messages = response.text.split(/\n\n/).map((event) => event.split('\n').filter((line) => line.startsWith('data:')).map((line) => line.slice(5).trim()).join('\n')).filter(Boolean).map((data) => JSON.parse(data));
    return messages.find((message) => message.id !== undefined) ?? messages.at(-1);
  };
  const rpc = async (method, params) => {
    const message = parse(await post(JSON.stringify({ jsonrpc: '2.0', id: nextId++, method, params })));
    if (message.error) fail('OO_RPC', `${method}: ${JSON.stringify(message.error).slice(0, 200)}`);
    return message.result;
  };
  return {
    async initialize() {
      const result = await rpc('initialize', { protocolVersion: '2025-03-26', capabilities: {}, clientInfo: { name: 'oo-pull', version: '1.0.0' } });
      protocol = result?.protocolVersion ?? null;
      await post(JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' })).catch(() => {});
    },
    callTool: (name, args) => rpc('tools/call', { name, arguments: args }),
  };
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const nextDay = (date) => { const day = new Date(`${date}T00:00:00Z`); day.setUTCDate(day.getUTCDate() + 1); return day.toISOString().slice(0, 10); };
// End of a window: two calendar years after its start, as oo-capture's verify allows, or rangeEnd if earlier.
const windowEnd = (from, rangeEnd) => { const end = plusYears(from, 2); return end < rangeEnd ? end : rangeEnd; };

// Pull one source into a verified capture. `minGapMs` keeps under OO's per-user rate limit (60 calls a minute).
export async function pull({ url, sourceKey, sourceId, strategy, minGapMs = 1100, log = () => {}, mcp = client(url), dryRun = false }) {
  if (!SOURCES[sourceKey] || typeof sourceId !== 'string' || !sourceId) fail('SOURCE', 'pass exactly one of runId, savedBacktestId, savedPortfolioId');
  await mcp.initialize();
  const session = `oo-pull-${randomUUID()}`;
  const { id } = await start(session);
  let last = 0, calls = 0, stopped = false;
  const call = async (name, args) => {
    for (let attempt = 0; ; attempt++) {
      const wait = last + minGapMs - Date.now();
      if (wait > 0) await sleep(wait);
      last = Date.now();
      calls++;
      const result = await mcp.callTool(name, args);
      const text = result?.content?.length === 1 && result.content[0].type === 'text' ? result.content[0].text : null;
      if (result?.isError) {
        const seconds = /(\d+)\s*seconds?/i.exec(text || '')?.[1];
        if (seconds && attempt < 5 && /limit|rate|too many/i.test(text)) { await sleep((Number(seconds) + 1) * 1000); continue; }
        fail('OO_REFUSED', `${name}: ${(text || '').slice(0, 300)}`);
      }
      if (text === null) fail('OO_RESULT', `${name} returned no single text content`);
      const recorded = await hook({ tool_name: `${SERVER}__${name}`, tool_input: args, session_id: session, tool_use_id: null, tool_response: result.content });
      if (!recorded || recorded.failure) fail(recorded?.failure || 'CAPTURE_FAILURE', recorded?.detail || name);
      return JSON.parse(text);
    }
  };
  try {
    const headline = await call(SOURCES[sourceKey], { [sourceKey]: sourceId });
    const result = sourceKey === 'runId' ? headline : headline.result;
    const range = sourceKey === 'savedPortfolioId' ? headline.settings : headline.parameters;
    log(`${sourceKey}=${sourceId}: ${result?.numberOfTrades} trades, about ${Math.ceil((result?.numberOfTrades ?? 0) / 100)} pages, range ${range?.rangeStart ?? 'none'}..${range?.rangeEnd ?? 'none'}`);
    if (dryRun) { await stop(session); stopped = true; await remove(id); return { dryRun: true, calls, trades: result?.numberOfTrades ?? null, range: range ? { rangeStart: range.rangeStart, rangeEnd: range.rangeEnd } : null }; }
    for (let offset = 0; ;) {
      const page = await call('get_trade_log', { [sourceKey]: sourceId, sortBy: 'opened', direction: 'asc', limit: 100, offset });
      if (page.nextOffset == null) break;
      offset = page.nextOffset;
      if (offset % 2000 === 0) log(`${offset}/${page.totalCount}`);
    }
    if (range?.rangeStart && range?.rangeEnd) {
      for (let from = range.rangeStart; from <= range.rangeEnd;) {
        const through = windowEnd(from, range.rangeEnd);
        await call('get_equity_curve', { parameters: { [sourceKey]: sourceId, seriesStart: from, seriesEnd: through } });
        from = nextDay(through);
      }
    }
    await stop(session); stopped = true;
    return { ...(await verify(id, strategy)), calls };
  } catch (error) {
    if (!stopped) await stop(session).catch(() => {});
    error.message = `${error.message} (capture ${id} kept for inspection, ${calls} OO calls)`;
    throw error;
  }
}

const cli = process.argv[1] && realpathSync(process.argv[1]) === fileURLToPath(import.meta.url);
if (cli) {
  const args = process.argv.slice(2);
  const value = (flag) => { const at = args.indexOf(flag); return at >= 0 ? args[at + 1] : undefined; };
  const flags = { '--run': 'runId', '--saved': 'savedBacktestId', '--portfolio': 'savedPortfolioId' };
  const chosen = Object.keys(flags).filter((flag) => value(flag));
  try {
    if (chosen.length !== 1) fail('COMMAND', 'use oo-pull (--run <id> | --saved <id> | --portfolio <id>) [--strategy <name>] [--dry-run] with OO_MCP_URL set');
    const url = value('--url') || process.env.OO_MCP_URL;
    if (!url) fail('OO_MCP_URL', 'set OO_MCP_URL (or --url) to an OO MCP endpoint this script may call');
    const summary = await pull({ url, sourceKey: flags[chosen[0]], sourceId: value(chosen[0]), strategy: value('--strategy'), dryRun: args.includes('--dry-run'), log: (line) => console.error(`oo-pull: ${line}`) });
    console.log(JSON.stringify(summary));
  } catch (error) { console.error(error.message); process.exitCode = 1; }
}
