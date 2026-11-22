import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { discover, parseSession, toUsage } from '../src/claude.js';
import { findSession, Store } from '../src/store.js';
import { sessionToolCalls, type ToolCall } from '../src/types.js';
import { A, B, FIXTURES, fixtureSessions } from './helpers.js';

test('discover finds sessions, nested subagent files and loose agent files', () => {
  const found = discover(FIXTURES);
  assert.deepEqual(found.map((f) => f.id).sort(), [A, B]);
  const b = found.find((f) => f.id === B)!;
  assert.equal(b.subagents.length, 2);
  assert.ok(b.subagents.some((p) => p.endsWith('subagents/agent-a1b2c3.jsonl')));
  assert.ok(b.subagents.some((p) => p.endsWith('agent-zz9.jsonl')));
});

test('session metadata: title from summary, project from cwd, time span, models', () => {
  const { a, b, sessions } = fixtureSessions();
  assert.equal(sessions[0].id, B, 'newest first');
  assert.equal(a.title, 'Add health check endpoint');
  assert.equal(a.project, '/Users/dev/acme-api');
  assert.equal(a.end - a.start, 60_000);
  assert.deepEqual(a.models.sort(), ['claude-haiku-4-5-20251001', 'claude-sonnet-4-5-20250929']);
  // no summary: first real prompt, skipping the slash-command wrapper and meta messages
  assert.equal(b.title, 'Write a short about page for the notes site, research the tone first.');
});

test('usage is counted once per API message even when split over several lines', () => {
  const { a } = fixtureSessions();
  assert.equal(a.usage.length, 7); // 5 main messages + 2 subagent messages
  const sonnet = a.usage.filter((e) => e.model.includes('sonnet'));
  const sum = (k: 'input' | 'output' | 'cacheRead' | 'cacheWrite' | 'cacheWrite1h') => sonnet.reduce((n, e) => n + e.usage[k], 0);
  assert.deepEqual([sum('input'), sum('output'), sum('cacheWrite'), sum('cacheWrite1h'), sum('cacheRead')], [30, 550, 1200, 200, 31700]);
});

test('tool calls get results, durations and errors; subagents attach to their Task call', () => {
  const { a } = fixtureSessions();
  const calls = sessionToolCalls(a);
  assert.deepEqual(calls.map((c) => c.name), ['Read', 'Edit', 'Bash', 'Task', 'Grep']);
  const by = (n: string) => calls.find((c) => c.name === n)!;
  assert.equal(by('Read').durationMs, 1500);
  assert.match(by('Read').output!, /startServer/);
  assert.equal(by('Bash').isError, true);
  assert.equal(by('Bash').durationMs, 12_000);
  const task = by('Task') as ToolCall;
  assert.ok(task.subagent, 'inline sidechain attached');
  assert.equal(task.subagent!.items.filter((i) => i.kind === 'tool').length, 1);
  assert.equal(task.output, 'startServer is called from src/index.ts and test/server.test.ts.');
  assert.equal(a.orphanSubagents.length, 0);
});

test('subagent files attach by prompt; unmatched ones are kept as orphans', () => {
  const { b } = fixtureSessions();
  const task = b.items.find((i) => i.kind === 'tool' && i.name === 'Task') as ToolCall;
  assert.equal(task.subagent?.id, 'a1b2c3');
  assert.deepEqual(b.orphanSubagents.map((s) => s.id), ['zz9']);
});

test('unknown and broken records become raw items instead of crashing', () => {
  const { a, b } = fixtureSessions();
  const labels = [...a.items, ...b.items].filter((i) => i.kind === 'raw').map((i) => (i.kind === 'raw' ? i.label : ''));
  assert.deepEqual(labels.sort(), [
    'Tool result without a matching call',
    'Unreadable line 20',
    'Unrecognized assistant content: mystery_block',
    'Unrecognized event: file-history-snapshot',
    'Unrecognized event: queue-operation',
  ]);
  const sys = a.items.find((i) => i.kind === 'system');
  assert.ok(sys && sys.kind === 'system' && sys.error);
  const meta = b.items.find((i) => i.kind === 'system');
  assert.ok(meta && meta.kind === 'system' && !meta.error && meta.text.startsWith('Caveat'));
});

test('garbage input never throws', () => {
  const dir = mkdtempSync(join(tmpdir(), 'tracelens-'));
  try {
    mkdirSync(join(dir, 'p'));
    writeFileSync(join(dir, 'p', 'x.jsonl'), ['null', '[]', '42', '"str"', '{}', '{"type":"user"}', '{"type":"assistant","message":null}', '{"type":"user","message":{"content":[null,7]}}', '\u0000\u0001'].join('\n'));
    const [s] = new Store(dir).sessions();
    assert.equal(s.id, 'x');
    assert.equal(s.title, '(no prompt)');
    assert.ok(s.items.length >= 5);
    assert.equal(s.start, 0);
  } finally {
    rmSync(dir, { recursive: true });
  }
});

test('toUsage ignores junk values', () => {
  assert.deepEqual(toUsage({ input_tokens: -5, output_tokens: 'x', cache_read_input_tokens: 3, cache_creation_input_tokens: 10, cache_creation: { ephemeral_1h_input_tokens: 99 } }), {
    input: 0,
    output: 0,
    cacheWrite: 10,
    cacheWrite1h: 10,
    cacheRead: 3,
  });
  assert.deepEqual(toUsage(undefined).input, 0);
});

test('findSession resolves ids and unique prefixes', () => {
  const { sessions } = fixtureSessions();
  assert.equal(findSession(sessions, '1111').id, A);
  assert.equal(findSession(sessions, B).id, B);
  assert.throws(() => findSession(sessions, 'zzzz'), /No session matches/);
  const dup = [...sessions, { ...sessions[0], id: `${sessions[0].id.slice(0, 4)}-other` }];
  assert.throws(() => findSession(dup, sessions[0].id.slice(0, 4)), /matches 2 sessions/);
});

test('store re-parses only changed files', () => {
  const dir = mkdtempSync(join(tmpdir(), 'tracelens-'));
  try {
    mkdirSync(join(dir, 'p'));
    const f = join(dir, 'p', 's.jsonl');
    writeFileSync(f, JSON.stringify({ type: 'user', message: { content: 'first' }, timestamp: '2026-01-01T00:00:00Z' }) + '\n');
    const store = new Store(dir);
    const one = store.sessions()[0];
    assert.equal(store.sessions()[0], one, 'cached object reused');
    writeFileSync(f, JSON.stringify({ type: 'user', message: { content: 'second prompt' }, timestamp: '2026-01-01T00:00:00Z' }) + '\n');
    assert.equal(store.sessions()[0].title, 'second prompt');
    assert.equal(parseSession({ id: 's', main: f, subagents: [] }).title, 'second prompt');
  } finally {
    rmSync(dir, { recursive: true });
  }
});
