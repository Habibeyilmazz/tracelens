import assert from 'node:assert/strict';
import { test } from 'node:test';
import { fmtDuration, fmtOffset, fmtTokens, fmtUSD, toolLabel } from '../src/format.js';
import { sessionStats } from '../src/insights.js';
import { exportMarkdown, fence } from '../src/markdown.js';
import { loadPricing } from '../src/pricing.js';
import { redact, redactPaths, redactSecrets, redactSession } from '../src/redact.js';
import { esc, exportHtml, searchPage } from '../src/render.js';
import type { Session } from '../src/types.js';
import { fixtureSessions } from './helpers.js';

const pricing = loadPricing();

test('secrets are redacted', () => {
  // Built at runtime so the repository never contains strings that look like live credentials.
  const ant = 'sk-' + 'ant-api03-' + 'a'.repeat(40);
  const gh = 'ghp' + '_' + 'b'.repeat(36);
  const aws = 'AKIA' + 'C'.repeat(16);
  const jwt = 'eyJ' + 'h'.repeat(20) + '.' + 'p'.repeat(20) + '.' + 's'.repeat(20);
  const text = `key ${ant} gh ${gh} aws ${aws} jwt ${jwt}\nAuthorization: Bearer ${'t'.repeat(30)}\nDB_PASSWORD=hunter2hunter2\napi_key: "abcdef123456"\npostgres://admin:pa55word@db/x\nmail me@example.org`;
  const out = redactSecrets(text);
  for (const leaked of [ant, gh, aws, jwt, 'hunter2hunter2', 'abcdef123456', 'pa55word', 'me@example.org', 't'.repeat(30)]) assert.ok(!out.includes(leaked), `leaked ${leaked}`);
  assert.match(out, /DB_PASSWORD=\[REDACTED\]/);
  assert.match(out, /postgres:\/\/\[REDACTED\]@db/);
  const pk = `-----BEGIN RSA PRIVATE KEY-----\nMIIabc\n-----END RSA PRIVATE KEY-----`;
  assert.equal(redactSecrets(pk), '[REDACTED PRIVATE KEY]');
});

test('quoted secrets are redacted whole, and secret-named keys in tool inputs too', () => {
  assert.equal(redactSecrets('password="correct horse battery"'), 'password="[REDACTED]"');
  assert.equal(redactSecrets(`{"api_key": "abc \\" def123"}`), '{"api_key": "[REDACTED]"}');
  const { a } = fixtureSessions();
  const withInput: Session = { ...a, items: [{ kind: 'tool', n: 0, ts: a.start, id: 't', name: 'Bash', input: { password: 'hunter2hunter2', api_key: 'abcdef123456', count: 'ok' }, isError: false }] };
  const r = redactSession(withInput);
  assert.deepEqual((r.items[0] as { input: unknown }).input, { password: '[REDACTED]', api_key: '[REDACTED]', count: 'ok' });
});

test('redaction stays linear on long adversarial runs (no regex backtracking blow-up)', () => {
  // Each of these took seconds at 40 KB and minutes at 1 MB with the old patterns; tool output is untrusted.
  const units = ['a', 'a.', 'a-', 'eyJa-', 'ghp_', 'AKIA', 'token', 'token-', 'a@', 'a://a:', '/Users/', 'C:\\Users\\', 'token="', "token='", 'token=\\', 'x='];
  const t = performance.now();
  for (const u of units) redact(u.repeat(Math.ceil(200_000 / u.length)), '/p');
  assert.ok(performance.now() - t < 3000, `took ${Math.round(performance.now() - t)}ms`);
});

test('secret assignments inside other values are still found', () => {
  assert.equal(redactSecrets('url: https://x.test/cb?token=abcdef123'), 'url: https://x.test/cb?token=[REDACTED]');
  assert.equal(redactSecrets('-H "x-api-key: abcdef123"'), '-H "x-api-key: [REDACTED]"');
  assert.equal(redactSecrets('max_tokens: 4096, tokenizer: cl100k'), 'max_tokens: 4096, tokenizer: [REDACTED]');
  const jwt = 'eyJ' + 'h'.repeat(20) + '.' + 'p'.repeat(20) + '.' + 's'.repeat(20);
  assert.equal(redactSecrets(`id_token=${jwt} raw ${jwt}`), 'id_token=[REDACTED] raw [REDACTED]');
});

test('ordinary numbers and words survive secret redaction', () => {
  const text = '"input_tokens": 123456, max_tokens: 4096, token count is fine';
  assert.equal(redactSecrets(text), text);
});

test('paths: project becomes <project>, home folders lose the user name', () => {
  assert.equal(redactPaths('/Users/dev/acme/src/a.ts and /Users/dev/other', '/Users/dev/acme', '/Users/dev'), '<project>/src/a.ts and ~/other');
  assert.equal(redactPaths('/home/alice/x and C:\\Users\\Bob\\y', undefined, '/nowhere'), '~/x and ~\\y');
  // the same path inside JSON text (raw records) has doubled backslashes
  assert.equal(redactPaths(JSON.stringify('C:\\Users\\Bob\\y'), undefined, '/nowhere'), '"~\\\\y"');
  assert.equal(redact('see /Users/zed/p/notes.md', '/Users/zed/p'), 'see <project>/notes.md');
});

test('redactSession rewrites every string, including tool inputs and subagents', () => {
  const { a } = fixtureSessions();
  const r = redactSession(a);
  const json = JSON.stringify(r);
  assert.ok(!json.includes('/Users/dev'), 'no home paths left');
  assert.ok(!json.includes('hunter2hunter2'));
  assert.equal(r.items.length, a.items.length);
  assert.ok(JSON.stringify(a).includes('hunter2hunter2'), 'original untouched');
});

test('markdown export contains the conversation, tools and nested subagent', () => {
  const { a } = fixtureSessions();
  const md = exportMarkdown(a, sessionStats(a, pricing));
  assert.match(md, /^# Add health check endpoint/);
  assert.match(md, /### User \[0:00\]\n\nAdd a \/health endpoint/);
  assert.match(md, /<summary>Tool: Bash npm test \(error\), 12s<\/summary>/);
  assert.match(md, /\*\*Subagent `inline-1`\*\*/);
  assert.match(md, /#### User \[0:31\]/, 'subagent turns are one heading level deeper');
  assert.match(md, /Estimated cost: \$0\.02/);
});

test('fence always outlasts backticks in the content', () => {
  assert.equal(fence('a ``` b'), '````\na ``` b\n````');
  assert.equal(fence('plain', 'json'), '```json\nplain\n```');
});

test('html export is self-contained and escapes transcript content', () => {
  const { a } = fixtureSessions();
  const evil: Session = { ...a, title: '<script>alert(1)</script>', items: [{ kind: 'user', n: 0, ts: a.start, text: '<img src=x onerror=alert(1)>' }] };
  const html = exportHtml(evil, sessionStats(evil, pricing));
  assert.ok(!html.includes('<script>alert'), 'title escaped');
  assert.ok(!html.includes('<img src=x'), 'message escaped');
  assert.ok(!/<script|<link|src="http/i.test(html), 'no scripts or external resources');
  assert.match(html, /<style>/);
  assert.equal(esc(`<a href="x">'&'</a>`), '&lt;a href=&quot;x&quot;&gt;&#39;&amp;&#39;&lt;/a&gt;');
});

test('formatters', () => {
  assert.deepEqual([fmtDuration(250), fmtDuration(1500), fmtDuration(75_000), fmtDuration(3_720_000), fmtDuration(undefined)], ['250ms', '1.5s', '1m 15s', '1h 02m', '—']);
  assert.deepEqual([fmtOffset(61_000), fmtOffset(3_661_000)], ['1:01', '1:01:01']);
  assert.deepEqual([fmtTokens(999), fmtTokens(1234), fmtTokens(45_600), fmtTokens(2_340_000)], ['999', '1.2k', '46k', '2.34M']);
  assert.deepEqual([fmtUSD(0), fmtUSD(0.004), fmtUSD(1.234), fmtUSD(1234)], ['$0', '<$0.01', '$1.23', '$1234']);
  assert.equal(toolLabel({ command: 'npm   test', description: 'x' }), 'npm test');
  assert.equal(toolLabel({ foo: 1, bar: 'baz' }), 'baz');
  assert.equal(toolLabel(null), '');
});

test('the header links to the first error even when it is not a tool call', () => {
  const { a } = fixtureSessions();
  const s: Session = { ...a, orphanSubagents: [], items: [{ kind: 'system', n: 7, ts: a.start, text: 'API Error: 529', error: true }] };
  assert.match(exportHtml(s, sessionStats(s, pricing)), /<a href="#i-7">first error<\/a>/);
});

test('a code fence survives output with a huge number of backtick runs', () => {
  const text = '`x '.repeat(200_000);
  assert.ok(fence(text).startsWith('```\n'));
});

test('search results count every session, list the top 100 and say so', () => {
  const { a } = fixtureSessions();
  const hits = Array.from({ length: 101 }, (_, i) => ({ session: { ...a, id: `s${i}` }, total: 1, matches: [] }));
  const html = searchPage('x', hits);
  assert.match(html, /101 matches in 101 sessions/);
  assert.match(html, /Showing the 100 sessions with the most matches/);
  assert.equal(html.match(/href="\/session\/s\d+"/g)!.length, 100);
});

test('assistant text is rendered as Markdown, user text stays as typed', () => {
  const { a } = fixtureSessions();
  const s: Session = {
    ...a,
    orphanSubagents: [],
    items: [
      { kind: 'user', n: 0, ts: a.start, text: 'keep **this** literal' },
      { kind: 'assistant', n: 1, ts: a.start, text: '## Plan\n- **one** `two`\n\n<img src=x onerror=alert(1)>', model: 'm', error: false },
    ],
  };
  const html = exportHtml(s, sessionStats(s, pricing));
  assert.match(html, /<div class="msg">keep \*\*this\*\* literal<\/div>/);
  assert.match(html, /<div class="msg md"><p class="mh">Plan<\/p><ul><li><strong>one<\/strong> <code>two<\/code><\/li><\/ul><p>&lt;img src=x/);
});
