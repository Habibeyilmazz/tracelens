// Edge cases found by trying to break tracelens with odd input (round 5). Each one crashed, hung or
// showed wrong output before its fix.
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { parseSession } from '../src/claude.js';
import { parseCodex } from '../src/codex.js';
import { oneLine } from '../src/format.js';
import { computeInsights } from '../src/insights.js';
import { loadPricing } from '../src/pricing.js';
import { redactSecrets } from '../src/redact.js';
import { Store } from '../src/store.js';

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

// Writes 600 MB to the temp folder, so it only runs with TRACELENS_SLOW_TESTS=1.
test('a session file over 512 MB (V8 string limit) is read, not skipped', { skip: !process.env.TRACELENS_SLOW_TESTS && 'set TRACELENS_SLOW_TESTS=1' }, () => {
  withTemp((dir) => {
    mkdirSync(join(dir, 'p'));
    const pad = 'x'.repeat(1_000_000);
    const out = join(dir, 'p', 'big.jsonl');
    writeFileSync(out, `${user('huge session')}\n`);
    const chunk = Array.from({ length: 100 }, () => JSON.stringify({ type: 'progress', timestamp: '2026-03-08T09:31:00Z', pad })).join('\n') + '\n';
    for (let i = 0; i < 6; i++) writeFileSync(out, chunk, { flag: 'a' });
    const [s] = new Store(dir).sessions();
    assert.equal(s?.title, 'huge session');
    assert.equal(s.items.filter((i) => i.kind === 'raw').length, 600);
  });
});
