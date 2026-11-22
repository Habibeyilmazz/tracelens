// Edge cases found by trying to break tracelens with odd input (round 5). Each one crashed, hung or
// showed wrong output before its fix.
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, truncateSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { parseSession } from '../src/claude.js';
import { parseCodex } from '../src/codex.js';
import { oneLine } from '../src/format.js';
import { computeInsights } from '../src/insights.js';
import { DEFAULT_PRICING_PATH, loadPricing } from '../src/pricing.js';
import { redactSecrets } from '../src/redact.js';
import { sessionPage, sessionsPage } from '../src/render.js';
import { exportMarkdown } from '../src/markdown.js';
import { redactSession } from '../src/redact.js';
import { sessionStats } from '../src/insights.js';
import { Store } from '../src/store.js';
import { search } from '../src/search.js';

const pricing = loadPricing();
const user = (text: string, timestamp = '2026-03-08T09:30:00Z') =>
  JSON.stringify({ type: 'user', timestamp, cwd: '/w', message: { role: 'user', content: text } });
const assistant = (timestamp: string, id = 'm1') =>
  JSON.stringify({ type: 'assistant', timestamp, message: { id, model: 'claude-sonnet-4-5', content: [{ type: 'text', text: 'ok' }], usage: { input_tokens: 10, output_tokens: 5 } } });

function withTemp(fn: (dir: string) => void) {
  const dir = mkdtempSync(join(tmpdir(), 'tracelens-edge-'));
  try {
    fn(dir);
  } finally {
    rmSync(dir, { recursive: true });
  }
}

/** Writes one Claude Code session file and parses it. */
function parse(text: string) {
  let s!: ReturnType<typeof parseSession>;
  withTemp((dir) => {
    const main = join(dir, 's.jsonl');
    writeFileSync(main, text);
    s = parseSession({ id: 's', main, subagents: [] });
  });
  return s;
}

test('one absurdly nested record does not drop the whole session', () => {
  const deep = `{"type":"weird","x":${'['.repeat(100_000)}${']'.repeat(100_000)}}`;
  const s = parse(`${user('still readable')}\n${deep}\n${assistant('2026-03-08T09:31:00Z')}\n`);
  assert.equal(s.title, 'still readable');
  assert.ok(s.items.some((i) => i.kind === 'raw' && /line 2/.test(i.label)));
  assert.ok(s.items.some((i) => i.kind === 'assistant'));
  // and through the store, which used to skip the file with "Maximum call stack size exceeded"
  withTemp((dir) => {
    mkdirSync(join(dir, 'p'));
    writeFileSync(join(dir, 'p', 's.jsonl'), `${user('x')}\n${deep}\n`);
    assert.equal(new Store(dir).sessions().length, 1);
  });
});

test('absurdly nested Codex tool arguments (a JSON string inside the record) stay a string', () => {
  const args = `{"x":${'['.repeat(10_000)}0${']'.repeat(10_000)}}`;
  const s = withCodex([{ timestamp: '2026-03-08T10:00:00Z', type: 'response_item', payload: { type: 'function_call', name: 'shell', call_id: 't', arguments: args } }]);
  const call = s.items.find((i) => i.kind === 'tool');
  assert.equal(call?.kind === 'tool' && call.input, args);
  const st = sessionStats(s, pricing);
  assert.doesNotThrow(() => [sessionPage(s, st), exportMarkdown(s, st), redactSession(s)]);
});

test('a byte-order mark before the first record is ignored', () => {
  const s = parse(`﻿${user('saved by a Windows editor')}\n${assistant('2026-03-08T09:31:00Z')}\n`);
  assert.equal(s.title, 'saved by a Windows editor');
  assert.equal(s.project, '/w');
  assert.ok(!s.items.some((i) => i.kind === 'raw'));
});

test('timestamps outside 2000-2099 are treated as missing (no year-9999 day loop)', () => {
  const s = parse(`${user('a', '2026-03-08T09:30:00Z')}\n${assistant('9999-12-31T23:00:00Z', 'm1')}\n${assistant('1971-01-01T00:00:00Z', 'm2')}\n`);
  assert.equal(s.start, Date.parse('2026-03-08T09:30:00Z'));
  assert.equal(s.end, s.start);
  // Before, a 9999-12-31 usage made the day filler loop forever ("10000-01-01" < "9999-12-31") until out of memory.
  const days = computeInsights([s], pricing).byDay.map((d) => d.key);
  assert.deepEqual(days, ['2026-03-08']);
  const codex = withCodex([
    { timestamp: '+275760-09-13T00:00:00.000Z', type: 'session_meta', payload: { id: 'c', cwd: '/w' } },
    { timestamp: '2026-03-08T10:00:00Z', type: 'response_item', payload: { type: 'message', role: 'user', content: [{ type: 'input_text', text: 'hi' }] } },
  ]);
  assert.equal(codex.start, Date.parse('2026-03-08T10:00:00Z'));
  assert.equal(codex.end, codex.start);
});

function withCodex(records: object[]) {
  let s!: ReturnType<typeof parseCodex>;
  withTemp((dir) => {
    const main = join(dir, 'rollout-2026-03-08T10-00-00-c.jsonl');
    writeFileSync(main, records.map((r) => JSON.stringify(r)).join('\n'));
    s = parseCodex({ id: 'c', main, subagents: [] });
  });
  return s;
}

test('titles and one-line labels never cut an emoji in half', () => {
  // 140 UTF-16 units: 'x' and 69½ emoji, so the half is dropped.
  const s = parse(`${user('x' + '😀'.repeat(200))}\n`);
  assert.equal(s.title, 'x' + '😀'.repeat(69));
  assert.equal(oneLine('😀'.repeat(10), 6), '😀😀…');
  const prompt = { type: 'message', role: 'user', content: [{ type: 'input_text', text: 'x' + '😀'.repeat(200) }] };
  assert.equal(withCodex([{ timestamp: '2026-03-08T10:00:00Z', type: 'response_item', payload: prompt }]).title, 'x' + '😀'.repeat(69));
});

test('redaction survives multi-megabyte runs without a stack overflow, and still redacts after them', () => {
  // A long base64url blob is all [\w-]: patterns like [\w-]{8,}\. overflowed the regex backtrack stack at ~6M characters.
  const run = 'A'.repeat(12_000_000);
  const token = 'gh' + 'p_' + 'x'.repeat(36);
  for (const s of [`${run}.${run} ${token}`, `sk-${run}! ${token}`, `${run}@${run} ${token}`, `token=${run} ${token}`, `://${run}:${run} ${token}`, `Bearer ${run}! ${token}`]) {
    const out = redactSecrets(s);
    assert.ok(!out.includes(token), 'token after the run leaked');
  }
});

test('a Codex session id from inside the file must be a plain id (a lone surrogate broke the whole session list)', () => {
  const prompt = { type: 'message', role: 'user', content: [{ type: 'input_text', text: 'hi' }] };
  for (const bad of ['x\uD800', 'a/b', '', '.', '..', 'x'.repeat(300), 42]) {
    const s = withCodex([{ timestamp: '2026-03-08T10:00:00Z', type: 'session_meta', payload: { id: bad, cwd: '/w' } }, { timestamp: '2026-03-08T10:00:00Z', type: 'response_item', payload: prompt }]);
    assert.equal(s.id, 'c', `kept id ${JSON.stringify(bad)}`);
    assert.doesNotThrow(() => sessionsPage([{ s, st: sessionStats(s, pricing) }], [s.project], { sort: 'date', dir: '/d' }));
  }
  const ok = withCodex([{ timestamp: '2026-03-08T10:00:00Z', type: 'session_meta', payload: { id: '0199a1b2-c3d4-7e5f-8a9b-0c1d2e3f4a5b' } }]);
  assert.equal(ok.id, '0199a1b2-c3d4-7e5f-8a9b-0c1d2e3f4a5b');
});

test('absurd token counts are ignored instead of making the cost Infinity', () => {
  const big = JSON.stringify({ type: 'assistant', timestamp: '2026-03-08T09:31:00Z', message: { id: 'm', model: 'claude-sonnet-4-5', content: [], usage: { input_tokens: 1e308, output_tokens: 5 } } });
  const s = parse(`${user('a')}\n${big}\n`);
  const st = sessionStats(s, pricing);
  assert.ok(Number.isFinite(st.cost));
  assert.equal(st.usage.input, 0);
  assert.equal(st.usage.output, 5);
});

test('a pricing file saved with a byte-order mark (Windows Notepad) still loads', () => {
  withTemp((dir) => {
    const file = join(dir, 'pricing.json');
    writeFileSync(file, '\uFEFF' + readFileSync(DEFAULT_PRICING_PATH, 'utf8'));
    assert.deepEqual(loadPricing(file), pricing);
  });
});

// Writes 600 MB to the temp folder, so it only runs with TRACELENS_SLOW_TESTS=1.
test('a session file over 512 MB (V8 string limit) is read, not skipped', { skip: !process.env.TRACELENS_SLOW_TESTS && 'set TRACELENS_SLOW_TESTS=1' }, () => {
  withTemp((dir) => {
    mkdirSync(join(dir, 'p'));
    const pad = 'x'.repeat(1_000_000);
    const out = join(dir, 'p', 'big.jsonl');
    writeFileSync(out, `${user('huge session')}\n`);
    const chunk = Array.from({ length: 100 }, () => JSON.stringify({ type: 'future-record', timestamp: '2026-03-08T09:31:00Z', pad })).join('\n') + '\n';
    for (let i = 0; i < 6; i++) writeFileSync(out, chunk, { flag: 'a' });
    const [s] = new Store(dir).sessions();
    assert.equal(s?.title, 'huge session');
    assert.equal(s.items.filter((i) => i.kind === 'raw').length, 600);
  });
});

// A sparse file: 2.2 GB long, almost no disk used. Node will not read a file over 2 GiB in one go.
test('a session file over 2 GiB is skipped with a warning; the other sessions still load', () => {
  withTemp((dir) => {
    mkdirSync(join(dir, 'p'));
    writeFileSync(join(dir, 'p', 'ok.jsonl'), `${user('small session')}\n`);
    writeFileSync(join(dir, 'p', 'huge.jsonl'), '');
    truncateSync(join(dir, 'p', 'huge.jsonl'), 2200 * 1024 * 1024);
    const warn = console.warn;
    const warnings: string[] = [];
    console.warn = (msg: string) => warnings.push(msg);
    try {
      assert.deepEqual(new Store(dir).sessions().map((s) => s.title), ['small session']);
    } finally {
      console.warn = warn;
    }
    assert.match(warnings.join('\n'), /skipped .*huge\.jsonl/);
  });
});

test('assistant content in an unknown shape (an object, not a list) is shown raw, not dropped', () => {
  const rec = JSON.stringify({ type: 'assistant', timestamp: '2026-03-08T09:31:00Z', message: { id: 'm1', model: 'claude-sonnet-4-5', content: { type: 'future_block', text: 'x' } } });
  const s = parse(`${user('hi')}\n${rec}\n`);
  assert.ok(s.items.some((i) => i.kind === 'raw' && /future_block/.test(i.label)));
});

test('search finds tool input text as shown, without JSON escapes (Windows paths, quotes)', () => {
  const call = JSON.stringify({ type: 'assistant', timestamp: '2026-03-08T09:31:00Z', message: { id: 'm1', model: 'claude-sonnet-4-5', content: [{ type: 'tool_use', id: 't1', name: 'Read', input: { file_path: 'C:\\work\\report.txt', pattern: 'say "hi"' } }] } });
  const s = parse(`${user('hi')}\n${call}\n`);
  for (const q of ['C:\\work\\report.txt', 'say "hi"']) assert.equal(search([s], q)[0]?.total, 1, q);
});

test('Codex: a negative exit code and a JSON-text output with success:false are failures', () => {
  const call = (id: string) => ({ timestamp: '2026-03-08T10:00:00Z', type: 'response_item', payload: { type: 'function_call', name: 'shell', call_id: id, arguments: '{}' } });
  const out = (id: string, output: string) => ({ timestamp: '2026-03-08T10:00:01Z', type: 'response_item', payload: { type: 'function_call_output', call_id: id, output } });
  const s = withCodex([call('a'), out('a', 'Exit code: -1\nkilled'), call('b'), out('b', '{"success":false,"content":"denied"}'), call('c'), out('c', 'Exit code: 0\nok')]);
  assert.deepEqual(s.items.filter((i) => i.kind === 'tool').map((i) => i.kind === 'tool' && i.isError), [true, true, false]);
});
