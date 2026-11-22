import assert from 'node:assert/strict';
import { appendFileSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { request } from 'node:http';
import { after, before, test } from 'node:test';
import type { Server } from 'node:http';
import { loadPricing } from '../src/pricing.js';
import { listen } from '../src/server.js';
import { Store } from '../src/store.js';
import { A, C, CODEX_FIXTURES, duplicateIdDir, FIXTURES } from './helpers.js';

const PORT = 4187;
const SA = `/session/-Users-dev-acme-api/${A}`;
let server: Server;

before(async () => {
  server = await listen(new Store(FIXTURES, CODEX_FIXTURES), loadPricing(), PORT);
});
after(() => server.close());

function get(path: string, opts: { method?: string; host?: string; port?: number; headers?: Record<string, string> } = {}): Promise<{ status: number; headers: Record<string, any>; body: string }> {
  return new Promise((resolve, reject) => {
    const port = opts.port ?? PORT;
    const req = request({ agent: false, host: '127.0.0.1', port, path, method: opts.method ?? 'GET', headers: { host: opts.host ?? `127.0.0.1:${port}`, ...opts.headers } }, (res) => {
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
  assert.match(sorted.body, /<th class="num" aria-sort="descending">Est\. cost/);
  assert.match(sorted.body, /<option value="cost" selected>/);
  const filtered = await get('/?project=%2FUsers%2Fdev%2Facme-api');
  assert.doesNotMatch(filtered.body, /Write a short about page/);
});

test('requests for other host names and non-GET methods are refused', async () => {
  assert.equal((await get('/', { host: 'evil.example:80' })).status, 403);
  assert.equal((await get('/', { host: `attacker.test:${PORT}` })).status, 403);
  assert.equal((await get('/', { host: `localhost:${PORT}` })).status, 200);
  assert.equal((await get('/', { method: 'POST' })).status, 405);
});

test('other sites may link here but not load pages as subresources', async () => {
  const fetchMeta = (site: string, mode: string, dest: string) => ({ 'sec-fetch-site': site, 'sec-fetch-mode': mode, 'sec-fetch-dest': dest });
  // An attacker page timing <img src="http://127.0.0.1:4180/search?q=…"> or fetch(…, {mode: 'no-cors'}).
  assert.equal((await get('/search?q=hunter2', { headers: fetchMeta('cross-site', 'no-cors', 'image') })).status, 403);
  assert.equal((await get('/search?q=hunter2', { headers: fetchMeta('cross-site', 'cors', 'empty') })).status, 403);
  // Another local server on 127.0.0.1 is "same-site"; an iframe is refused too.
  assert.equal((await get('/', { headers: fetchMeta('same-site', 'no-cors', 'script') })).status, 403);
  assert.equal((await get('/', { headers: fetchMeta('cross-site', 'navigate', 'iframe') })).status, 403);
  // Clicking a link, a bookmark, the page's own requests and clients without fetch metadata (curl) are fine.
  assert.equal((await get(SA, { headers: fetchMeta('cross-site', 'navigate', 'document') })).status, 200);
  assert.equal((await get('/', { headers: fetchMeta('none', 'navigate', 'document') })).status, 200);
  assert.equal((await get('/app.js', { headers: fetchMeta('same-origin', 'no-cors', 'script') })).status, 200);
  const r = await get('/');
  assert.equal(r.headers['cross-origin-opener-policy'], 'same-origin');
  assert.equal(r.headers['cross-origin-resource-policy'], 'same-origin');
});

test('session view shows tools, errors, subagents and raw events', async () => {
  const r = await get(SA);
  assert.equal(r.status, 200);
  for (const s of ['class="tname">Read<', 'class="tname">Bash<', 'class="flag">error<', 'class="subagent"', 'Unreadable line 20', 'Thinking', 'id="i-0"'])
    assert.ok(r.body.includes(s), `missing ${s}`);
  assert.ok(!r.body.includes('file-history-snapshot'), 'checkpoint bookkeeping is not shown');
  assert.equal((await get('/session/-Users-dev-acme-api/does-not-exist')).status, 404);
  assert.equal((await get('/session/x/%E0%A4%A')).status, 400);
});

test('Codex sessions are listed, marked, readable and exportable', async () => {
  const list = (await get('/')).body;
  const link = `/session/19/${C}`;
  assert.ok(list.includes(`href="${link}"`));
  assert.match(list, /<span class="chip agent">Codex<\/span>/);
  const r = await get(link);
  assert.equal(r.status, 200);
  for (const s of ['<dt>Agent</dt><dd>Codex</dd>', 'class="tname">apply_patch<', 'Update src/invoice.ts, Add test/invoice-rounding.test.ts', 'class="flag">error<', 'Context added by Codex: environment_context', '<strong>cents</strong>'])
    assert.ok(r.body.includes(s), `missing ${s}`);
  const md = await get(`${link}/export?format=md&redact=1`);
  assert.match(md.body, /^- Agent: Codex$/m);
  assert.ok(!md.body.includes('/Users/dev'));
  assert.match((await get('/insights')).body, /gpt-5\.1-codex/);
});

test('search highlights matches and escapes the query', async () => {
  const r = await get('/search?q=startServer');
  assert.match(r.body, /<mark>startServer<\/mark>/);
  assert.match(r.body, new RegExp(`${SA}#i-\\d+`));
  const x = await get('/search?q=%3Cscript%3Ealert(1)%3C%2Fscript%3E');
  assert.ok(!x.body.includes('<script>alert(1)'));
  assert.match(x.body, /No session contains this text/);
});

test('search finds sessions by several words, marks each, and can be scoped to a project', async () => {
  const r = await get('/search?q=health%20endpoint');
  assert.match(r.body, /<mark>health<\/mark>/i);
  assert.match(r.body, /<mark>endpoint<\/mark>/i);
  assert.match(r.body, /<select name="project" data-autosubmit>/);
  const hits = (b: string) => b.match(/<li><a href="\/session\/[^"#]+"><strong>/g)?.length ?? 0;
  const all = await get('/search?q=the');
  assert.ok(hits(all.body) >= 2);
  const scoped = await get(`/search?q=the&project=${encodeURIComponent('/Users/dev/acme-api')}`);
  assert.equal(hits(scoped.body), 1);
  assert.match(scoped.body, new RegExp(`href="${SA}"`));
  assert.match(scoped.body, /in dev\/acme-api/);
  // Editing the query in the header box keeps the scope.
  assert.match(scoped.body, /role="search"><input type="hidden" name="project" value="\/Users\/dev\/acme-api">/);
  assert.match((await get(`/search?q=zzzz%20the&project=${encodeURIComponent('/Users/dev/acme-api')}`)).body, /No session in this project contains all of these words/);
});

test('insights page renders charts and tables', async () => {
  const r = await get('/insights');
  assert.equal(r.status, 200);
  for (const s of ['Tokens per day', 'Estimated cost per day', '<svg', 'Most-used tools', 'Slowest tool calls', 'about.md', 'claude-experimental-9'])
    assert.ok(r.body.includes(s), `missing ${s}`);
  // Tables scroll sideways on phones: each scroll box takes keyboard focus (Safari does not focus scrollers by itself).
  assert.equal(r.body.match(/<div class="scroll"(?! tabindex="0" role="region" aria-label="[^"]+")/g), null);
  const week = await get('/insights?days=7&project=nope');
  assert.match(week.body, /No token usage in this range/);
});

test('export downloads markdown and html, redacted on request', async () => {
  const md = await get(`${SA}/export?format=md&redact=1`);
  assert.equal(md.status, 200);
  assert.match(md.headers['content-disposition'], /attachment; filename="tracelens-11111111-aaa\.md"/);
  assert.ok(!md.body.includes('/Users/dev'));
  assert.ok(!md.body.includes('hunter2hunter2'));
  const html = await get(`${SA}/export?format=html`);
  assert.match(html.headers['content-type'], /text\/html/);
  assert.ok(html.body.includes('/Users/dev/acme-api'), 'not redacted unless asked');
});

test('app.js is served as JavaScript', async () => {
  const r = await get('/app.js');
  assert.match(r.headers['content-type'], /javascript/);
  assert.match(r.body, /function reveal/);
});

test('two project folders holding the same session id each get their own page', async () => {
  const dir = duplicateIdDir();
  const port = PORT + 1;
  const dup = await listen(new Store(dir), loadPricing(), port);
  try {
    const at = (path: string) => get(path, { port });
    const list = (await at('/')).body;
    const links = [...list.matchAll(/<a href="(\/session\/[^"]+)">/g)].map((m) => m[1]).sort();
    assert.deepEqual(links, [`/session/-Users-dev-one/${A}`, `/session/-Users-dev-two/${A}`]);
    assert.match((await at(links[0])).body, /<h1>Add health check endpoint<\/h1>/);
    assert.match((await at(links[1])).body, /<h1>Second copy prompt<\/h1>/);
    assert.match((await at(`${links[1]}/export?format=md`)).body, /^# Second copy prompt/);
    assert.equal((await at(`/session/-Users-dev-three/${A}`)).status, 404);
  } finally {
    dup.close();
    rmSync(dir, { recursive: true });
  }
});

test('a session page answers If-None-Match with 304 until its log grows, and marks recent sessions live', async () => {
  const old = await get(SA);
  assert.ok(old.headers.etag, 'session pages carry an ETag');
  assert.doesNotMatch(old.body, /data-live/, 'a session that ended long ago is not live');
  assert.match(old.headers['content-security-policy'], /connect-src 'self'/);

  const dir = mkdtempSync(join(tmpdir(), 'tracelens-live-'));
  mkdirSync(join(dir, '-Users-dev-live'));
  const file = join(dir, '-Users-dev-live', 'live-1.jsonl');
  const line = (text: string) => JSON.stringify({ type: 'user', timestamp: new Date().toISOString(), cwd: '/Users/dev/live', message: { content: text } }) + '\n';
  writeFileSync(file, line('First prompt'));
  const port = PORT + 2;
  const srv = await listen(new Store(dir), loadPricing(), port);
  try {
    const path = '/session/-Users-dev-live/live-1';
    const first = await get(path, { port });
    assert.match(first.body, new RegExp(`data-live="${first.headers.etag.replaceAll('"', '&quot;')}"`), 'a recent session is live and its page holds its ETag');
    const same = await get(path, { port, headers: { 'if-none-match': first.headers.etag } });
    assert.equal(same.status, 304);
    assert.equal(same.body, '');
    appendFileSync(file, line('Second prompt'));
    const grown = await get(path, { port, headers: { 'if-none-match': first.headers.etag } });
    assert.equal(grown.status, 200);
    assert.notEqual(grown.headers.etag, first.headers.etag);
    assert.match(grown.body, /Second prompt/);
  } finally {
    await new Promise((r) => srv.close(r)); // the next test reuses this port
    rmSync(dir, { recursive: true });
  }
});

test('HTML in every log-controlled field stays text on every page', async () => {
  // Payloads in the folder name, session id, summary, cwd, model, prompts, tool names/inputs/outputs,
  // subagent id, block and event types, system text and an unparseable line.
  const X = (tag: string) => `"'><img src=x onerror=alert('${tag}')><svg onload=alert('${tag}')>`;
  const dir = mkdtempSync(join(tmpdir(), 'tracelens-xss-'));
  const folder = '-evil-"><b>';
  const id = "s<i>'x";
  const t = (s: number) => `2026-11-20T10:00:0${s}.000Z`;
  const recs = [
    { type: 'summary', summary: X('summary') },
    { type: 'user', timestamp: t(1), cwd: `/tmp/${X('cwd')}`, message: { content: X('prompt') } },
    { type: 'assistant', timestamp: t(2), message: { id: 'm1', model: X('model'), usage: { input_tokens: 5, output_tokens: 5 }, content: [
      { type: 'text', text: `${X('md')} [l](https://e.test/"onclick=alert(1)) [j](javascript:alert(1)) **${X('bold')}** \`${X('code')}\`` },
      { type: 'thinking', thinking: X('thinking') },
      { type: 'tool_use', id: 'tu1', name: X('tool'), input: { [X('key')]: X('val'), file_path: X('path') } },
      { type: 'tool_use', id: 'tu2', name: 'Task', input: { prompt: X('task') } },
      { type: X('blocktype') },
    ] } },
    { type: 'user', timestamp: t(3), message: { content: [{ type: 'tool_result', tool_use_id: 'tu1', content: X('output'), is_error: true }] } },
    { type: 'user', timestamp: t(4), isSidechain: true, agentId: X('agent'), message: { content: X('task') } },
    { type: 'system', timestamp: t(5), level: 'error', content: X('system') },
    { type: X('eventtype'), timestamp: t(6) },
  ];
  mkdirSync(join(dir, folder));
  writeFileSync(join(dir, folder, `${id}.jsonl`), `${recs.map((r) => JSON.stringify(r)).join('\n')}\n${X('badline')}\n`);
  const port = PORT + 2;
  const srv = await listen(new Store(dir), loadPricing(), port);
  try {
    const href = `/session/${encodeURIComponent(folder)}/${encodeURIComponent(id)}`;
    const paths = ['/', `/?project=${encodeURIComponent(`/tmp/${X('cwd')}`)}`, '/insights', '/search?q=alert', `/search?q=${encodeURIComponent(X('q'))}`, href, `${href}/export?format=html`, `/session/${encodeURIComponent(X('f'))}/${encodeURIComponent(X('id'))}`];
    for (const path of paths) {
      const { status, body } = await get(path, { port });
      assert.ok(status === 200 || status === 404, `${path}: ${status}`);
      for (const bad of ['<img', '<svg onload', '<b>', '<i>', 'href="javascript:', '" onclick'])
        assert.ok(!body.includes(bad), `${path} contains ${bad}`);
    }
    assert.match((await get(href, { port })).body, /&lt;img src=x onerror=alert\(&#39;output&#39;\)/, 'payloads are shown as text');
  } finally {
    srv.close();
    rmSync(dir, { recursive: true });
  }
});

test('a search query cut at 500 characters never ends in half an emoji', async () => {
  const r = await get(`/search?q=${encodeURIComponent('x' + '😀'.repeat(300))}`);
  assert.equal(r.status, 200);
  assert.ok(!r.body.includes('�'), 'half an emoji showed as a replacement character');
});
