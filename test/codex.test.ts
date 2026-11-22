import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { contextLabel, discoverCodex, parseCodex } from '../src/codex.js';
import { toolLabel } from '../src/format.js';
import { computeInsights, sessionStats } from '../src/insights.js';
import { exportMarkdown } from '../src/markdown.js';
import { loadPricing, ratesFor } from '../src/pricing.js';
import { search } from '../src/search.js';
import { Store } from '../src/store.js';
import { sessionToolCalls, type Session } from '../src/types.js';
import { A, B, C, CODEX_FIXTURES, D, FIXTURES } from './helpers.js';

const pricing = loadPricing();
const codexSessions = () => new Store(join(tmpdir(), 'tracelens-no-such-dir'), CODEX_FIXTURES).sessions();
const get = (id: string) => codexSessions().find((s) => s.id === id)!;

test('discoverCodex finds rollout files in the dated folders, and nothing else', () => {
  const found = discoverCodex(CODEX_FIXTURES);
  assert.deepEqual(found.map((f) => f.id), [D, C]);
  assert.ok(found[1].main.endsWith(join('2026', '11', '19', `rollout-2026-11-19T09-00-00-${C}.jsonl`)));
  assert.deepEqual(discoverCodex(join(tmpdir(), 'tracelens-no-such-dir')), []);
});

test('a Codex session: metadata, title, project and model', () => {
  const s = get(C);
  assert.equal(s.source, 'codex');
  assert.equal(s.project, '/Users/dev/billing-svc');
  assert.equal(s.title, 'Invoice totals are off by a cent. Fix the rounding and run the tests.');
  assert.deepEqual(s.models, ['gpt-5.1-codex']);
  assert.equal(s.start, Date.parse('2026-11-19T09:00:00.000Z'));
  assert.equal(s.end, Date.parse('2026-11-19T09:00:35.000Z'));
});

test('injected context is collapsed, duplicate events are skipped, prompts and replies appear once', () => {
  const s = get(C);
  const kinds = s.items.map((i) => (i.kind === 'raw' ? `raw:${i.label}` : i.kind));
  assert.deepEqual(kinds.slice(0, 5), [
    'raw:Instructions (developer)',
    'raw:Context added by Codex: environment_context',
    'raw:Context added by Codex: AGENTS.md instructions',
    'user',
    'thinking',
  ]);
  assert.equal(s.items.filter((i) => i.kind === 'user').length, 1);
  assert.equal(s.items.filter((i) => i.kind === 'assistant').length, 1);
  assert.equal(s.items.filter((i) => i.kind === 'thinking').length, 1);
  const raws = s.items.filter((i) => i.kind === 'raw').map((i) => (i.kind === 'raw' ? i.label : ''));
  assert.deepEqual(raws.slice(3), ['Unrecognized event: some_future_event', 'Unrecognized event: future_line_type', 'Unreadable line 29']);
  const err = s.items.find((i) => i.kind === 'system');
  assert.ok(err?.kind === 'system' && err.error && /stream disconnected/.test(err.text));
});

test('tool calls pair with their outputs by call_id, with durations and failures', () => {
  const calls = sessionToolCalls(get(C));
  assert.deepEqual(calls.map((c) => c.name), ['shell_command', 'apply_patch', 'shell', 'update_plan', 'shell_command']);
  const [rg, patch, test1, plan, test2] = calls;
  assert.equal(rg.durationMs, 1000);
  assert.equal(rg.isError, false);
  assert.match(rg.output!, /src\/invoice\.ts:14/);
  assert.match(patch.output!, /^Success/);
  // Older JSON-wrapped output: the text is unwrapped and a non-zero exit code is a failure.
  assert.equal(test1.isError, true);
  assert.equal(test1.output, 'FAIL test/invoice-rounding.test.ts\n  expected 10.01, received 10\n');
  assert.equal(test1.durationMs, 7000);
  assert.equal(plan.output, undefined);
  assert.equal(test2.isError, false);
  assert.deepEqual(test1.input, { command: ['bash', '-lc', 'npm test'], workdir: '/Users/dev/billing-svc', timeout_ms: 120000 });
});

test('exit codes in plain-text output mark failures, but only in the header lines', () => {
  const dir = mkdtempSync(join(tmpdir(), 'tracelens-codex-'));
  try {
    const rec = (type: string, payload: object) => JSON.stringify({ timestamp: '2026-11-19T09:00:00.000Z', type, payload });
    const lines = [
      rec('response_item', { type: 'function_call', name: 'exec_command', arguments: '{"cmd":"make"}', call_id: 'a' }),
      rec('response_item', { type: 'function_call_output', call_id: 'a', output: 'Chunk ID: 1\nWall time: 2 seconds\nProcess exited with code 2\nOutput:\nmake: *** [all] Error 2' }),
      rec('response_item', { type: 'function_call', name: 'shell_command', arguments: '{"command":"cat log"}', call_id: 'b' }),
      rec('response_item', { type: 'function_call_output', call_id: 'b', output: 'Exit code: 0\nWall time: 0 seconds\nOutput:\nline\nExit code: 1' }),
      rec('response_item', { type: 'function_call', name: 'mcp__x', arguments: 'not json', call_id: 'c' }),
      rec('response_item', { type: 'function_call_output', call_id: 'c', output: { content: 'denied', success: false } }),
      rec('response_item', { type: 'function_call_output', call_id: 'zzz', output: 'orphan' }),
    ];
    const file = join(dir, 'rollout-x.jsonl');
    writeFileSync(file, lines.join('\n'));
    const s = parseCodex({ id: 'x', main: file, subagents: [] });
    const [make, cat, mcp] = sessionToolCalls(s);
    assert.equal(make.isError, true);
    assert.equal(cat.isError, false);
    assert.equal(mcp.input, 'not json');
    assert.equal(mcp.isError, true);
    assert.equal(mcp.output, 'denied');
    const last = s.items.at(-1);
    assert.equal(last?.kind === 'raw' && last.label, 'Tool result without a matching call');
    assert.equal(s.title, '(no prompt)');
    assert.equal(s.project, '(unknown folder)');
  } finally {
    rmSync(dir, { recursive: true });
  }
});

test('token usage counts the growth of the cumulative total once, cached input as cache reads', () => {
  const s = get(C);
  // Totals 9000/6000/300 → (repeat) → 21000/15000/900 → 30000/22000/1500 (input/cached/output).
  assert.equal(s.usage.length, 3);
  const st = sessionStats(s, pricing);
  assert.deepEqual(st.usage, { input: 8000, output: 1500, cacheWrite: 0, cacheWrite1h: 0, cacheRead: 22000 });
  // gpt-5.1-codex is priced as gpt-5.1: $1.25 input, $0.125 cached, $10 output per million.
  assert.ok(Math.abs(st.cost - (8000 * 1.25 + 22000 * 0.125 + 1500 * 10) / 1e6) < 1e-12);
  assert.equal(st.errors, 2); // the failed test run and the stream error
});

test('a shrinking total (resumed session) falls back to the per-response numbers', () => {
  const dir = mkdtempSync(join(tmpdir(), 'tracelens-codex-'));
  try {
    const tc = (total: number[], last: number[]) => {
      const u = ([i, c, o]: number[]) => ({ input_tokens: i, cached_input_tokens: c, output_tokens: o });
      return JSON.stringify({ timestamp: '2026-11-19T09:00:00.000Z', type: 'event_msg', payload: { type: 'token_count', info: { total_token_usage: u(total), last_token_usage: u(last) } } });
    };
    const file = join(dir, 'rollout-y.jsonl');
    writeFileSync(file, [tc([100, 0, 10], [100, 0, 10]), tc([40, 0, 5], [40, 0, 5]), tc([60, 20, 7], [20, 20, 2]), JSON.stringify({ type: 'event_msg', payload: { type: 'token_count', info: null } })].join('\n'));
    const s = parseCodex({ id: 'y', main: file, subagents: [] });
    assert.deepEqual(s.usage.map((e) => [e.usage.input, e.usage.cacheRead, e.usage.output]), [[100, 0, 10], [40, 0, 5], [0, 20, 2]]);
    assert.equal(s.usage[0].model, 'unknown');
  } finally {
    rmSync(dir, { recursive: true });
  }
});

test('the pre-envelope rollout layout is read too', () => {
  const s = get(D);
  assert.equal(s.title, 'List the files in this folder');
  assert.equal(s.start, Date.parse('2025-08-01T10:00:00.000Z'));
  assert.deepEqual(s.models, []);
  const [ls] = sessionToolCalls(s);
  assert.equal(ls.output, 'README.md\nsrc\n');
  assert.equal(toolLabel(ls.input), 'ls');
  assert.deepEqual(s.items.map((i) => i.kind), ['user', 'tool', 'assistant']);
  assert.equal(s.project, '(unknown folder)');
});

test('the project folder falls back to the <cwd> in the environment context', () => {
  const dir = mkdtempSync(join(tmpdir(), 'tracelens-codex-'));
  try {
    const file = join(dir, 'rollout-z.jsonl');
    const env = { type: 'message', role: 'user', content: [{ type: 'input_text', text: '<environment_context>\n  <cwd>/srv/app</cwd>\n</environment_context>' }] };
    writeFileSync(file, JSON.stringify({ id: 'z', timestamp: '2025-08-01T10:00:00Z' }) + '\n' + JSON.stringify(env) + '\n');
    assert.equal(parseCodex({ id: 'z', main: file, subagents: [] }).project, '/srv/app');
  } finally {
    rmSync(dir, { recursive: true });
  }
});

test('context labels: environment and AGENTS.md blocks, not prompts that mention tags', () => {
  assert.equal(contextLabel('<environment_context>\n<cwd>/x</cwd>\n</environment_context>'), 'environment_context');
  assert.equal(contextLabel('<user_instructions>be brief</user_instructions>\n'), 'user_instructions');
  assert.equal(contextLabel('# AGENTS.md instructions for /x\n\n<INSTRUCTIONS>…</INSTRUCTIONS>'), 'AGENTS.md instructions');
  assert.equal(contextLabel('<div> is not centered, fix it'), undefined);
  assert.equal(contextLabel('<b>bold</b> then more text'), undefined);
});

test('tool labels for Codex calls', () => {
  assert.equal(toolLabel({ command: ['bash', '-lc', 'npm   test'], workdir: '/x' }), 'npm test');
  assert.equal(toolLabel({ command: ['git', 'status'] }), 'git status');
  assert.equal(toolLabel({ cmd: 'make all', yield_time_ms: 1000 }), 'make all');
  assert.equal(toolLabel('*** Begin Patch\n*** Update File: a.ts\n@@\n*** Delete File: b.ts\n*** End Patch'), 'Update a.ts, Delete b.ts');
  assert.equal(toolLabel({ input: '*** Begin Patch\n*** Add File: c.ts\n+x\n*** End Patch' }), 'Add c.ts');
});

test('insights: Codex and Claude Code sessions together; apply_patch counts as edits', () => {
  const all = new Store(FIXTURES, CODEX_FIXTURES).sessions();
  assert.deepEqual(new Set(all.map((s) => s.id)), new Set([A, B, C, D]));
  const ins = computeInsights(all, pricing);
  assert.ok(ins.byModel.some((r) => r.key === 'gpt-5.1-codex' && r.usage.cacheRead === 22000));
  assert.ok(ins.tools.some((t) => t.name === 'apply_patch' && t.calls === 1));
  const files = ins.files.map((f) => f.path);
  assert.ok(files.includes('/Users/dev/billing-svc/src/invoice.ts'), files.join());
  assert.ok(files.includes('/Users/dev/billing-svc/test/invoice-rounding.test.ts'));
  assert.ok(!ins.unpricedModels.some((m) => m.startsWith('gpt')), ins.unpricedModels.join());
});

test('search finds text in Codex sessions', () => {
  const hits = search(codexSessions(), 'invoice-rounding');
  assert.equal(hits[0].session.id, C);
});

test('Markdown export names the agent', () => {
  const s: Session = get(C);
  const md = exportMarkdown(s, sessionStats(s, pricing));
  assert.match(md, /^- Agent: Codex$/m);
  assert.match(md, /Tool: apply_patch Update src\/invoice\.ts, Add test\/invoice-rounding\.test\.ts/);
});

test('OpenAI model ids are priced by their own entry, never by a different version', () => {
  const key = (m: string) => Object.entries(pricing).find(([, r]) => r === ratesFor(pricing, m))?.[0];
  assert.equal(key('gpt-5-codex'), 'gpt-5');
  assert.equal(key('gpt-5.1-codex-max'), 'gpt-5.1');
  assert.equal(key('gpt-5.4-mini-2026-03-01'), 'gpt-5.4-mini');
  assert.equal(key('gpt-6.1-sol'), 'gpt-6.1-sol');
  assert.equal(ratesFor(pricing, 'gpt-5.9'), undefined, 'an unknown 5.x is not priced as gpt-5');
  assert.equal(key('claude-opus-4-1-20250805'), 'claude-opus-4-1');
});

test('a Codex folder next to a Claude Code folder: one store, no cross-talk', () => {
  const dir = mkdtempSync(join(tmpdir(), 'tracelens-codex-'));
  try {
    mkdirSync(join(dir, '2026', '01', '02'), { recursive: true });
    writeFileSync(join(dir, '2026', '01', '02', 'notes.jsonl'), '{}\n'); // not a rollout file
    assert.deepEqual(new Store(FIXTURES, dir).sessions().map((s) => s.source), ['claude-code', 'claude-code']);
  } finally {
    rmSync(dir, { recursive: true });
  }
});
