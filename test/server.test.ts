import assert from 'node:assert/strict';
import { request } from 'node:http';
import { after, before, test } from 'node:test';
import type { Server } from 'node:http';
import { loadPricing } from '../src/pricing.js';
import { listen } from '../src/server.js';
import { Store } from '../src/store.js';
import { A, FIXTURES } from './helpers.js';

const PORT = 4187;
let server: Server;

before(async () => {
  server = await listen(new Store(FIXTURES), loadPricing(), PORT);
});
after(() => server.close());

function get(path: string, opts: { method?: string; host?: string } = {}): Promise<{ status: number; headers: Record<string, any>; body: string }> {
  return new Promise((resolve, reject) => {
    const req = request({ host: '127.0.0.1', port: PORT, path, method: opts.method ?? 'GET', headers: { host: opts.host ?? `127.0.0.1:${PORT}` } }, (res) => {
      let body = '';
      res.setEncoding('utf8');
      res.on('data', (c) => (body += c));
      res.on('end', () => resolve({ status: res.statusCode!, headers: res.headers, body }));
    });
    req.on('error', reject);
    req.end();
  });
}

test('session list renders both sessions with security headers', async () => {
  const r = await get('/');
  assert.equal(r.status, 200);
  assert.match(r.body, /Add health check endpoint/);
  assert.match(r.body, /Write a short about page/);
  assert.match(r.headers['content-security-policy'], /default-src 'none'/);
  assert.equal(r.headers['x-content-type-options'], 'nosniff');
  const sorted = await get('/?sort=cost');
  assert.ok(sorted.body.indexOf('Write a short about page') < sorted.body.indexOf('Add health check endpoint'));
  const filtered = await get('/?project=%2FUsers%2Fdev%2Facme-api');
  assert.doesNotMatch(filtered.body, /Write a short about page/);
});

test('requests for other host names and non-GET methods are refused', async () => {
  assert.equal((await get('/', { host: 'evil.example:80' })).status, 403);
  assert.equal((await get('/', { host: `attacker.test:${PORT}` })).status, 403);
  assert.equal((await get('/', { host: `localhost:${PORT}` })).status, 200);
  assert.equal((await get('/', { method: 'POST' })).status, 405);
});

test('session view shows tools, errors, subagents and raw events', async () => {
  const r = await get(`/session/${A}`);
  assert.equal(r.status, 200);
  for (const s of ['class="tname">Read<', 'class="tname">Bash<', 'class="flag">error<', 'class="subagent"', 'Unreadable line 20', 'Thinking', 'id="i-0"'])
    assert.ok(r.body.includes(s), `missing ${s}`);
  assert.ok(!r.body.includes('file-history-snapshot'), 'checkpoint bookkeeping is not shown');
  assert.equal((await get('/session/does-not-exist')).status, 404);
  assert.equal((await get('/session/%E0%A4%A')).status, 400);
});

test('search highlights matches and escapes the query', async () => {
  const r = await get('/search?q=startServer');
  assert.match(r.body, /<mark>startServer<\/mark>/);
  assert.match(r.body, new RegExp(`/session/${A}#i-\\d+`));
  const x = await get('/search?q=%3Cscript%3Ealert(1)%3C%2Fscript%3E');
  assert.ok(!x.body.includes('<script>alert(1)'));
  assert.match(x.body, /No matches/);
});

test('insights page renders charts and tables', async () => {
  const r = await get('/insights');
  assert.equal(r.status, 200);
  for (const s of ['Tokens per day', 'Estimated cost per day', '<svg', 'Most-used tools', 'Slowest tool calls', 'about.md', 'claude-experimental-9'])
    assert.ok(r.body.includes(s), `missing ${s}`);
  const week = await get('/insights?days=7&project=nope');
  assert.match(week.body, /No token usage in this range/);
});

test('export downloads markdown and html, redacted on request', async () => {
  const md = await get(`/session/${A}/export?format=md&redact=1`);
  assert.equal(md.status, 200);
  assert.match(md.headers['content-disposition'], /attachment; filename="tracelens-11111111-aaa\.md"/);
  assert.ok(!md.body.includes('/Users/dev'));
  assert.ok(!md.body.includes('hunter2hunter2'));
  const html = await get(`/session/${A}/export?format=html`);
  assert.match(html.headers['content-type'], /text\/html/);
  assert.ok(html.body.includes('/Users/dev/acme-api'), 'not redacted unless asked');
});

test('app.js is served as JavaScript', async () => {
  const r = await get('/app.js');
  assert.match(r.headers['content-type'], /javascript/);
  assert.match(r.body, /function reveal/);
});
