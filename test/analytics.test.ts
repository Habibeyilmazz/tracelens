import assert from 'node:assert/strict';
import { test } from 'node:test';
import { computeInsights, sessionStats } from '../src/insights.js';
import { costOf, loadPricing, parsePricing, ratesFor } from '../src/pricing.js';
import { search } from '../src/search.js';
import { A, B, fixtureSessions } from './helpers.js';

const pricing = loadPricing();
const close = (a: number, b: number, msg = "") => assert.ok(Math.abs(a - b) < 1e-9, `${msg} ${a} != ${b}`);

test('bundled pricing.json is valid and matches dated and prefixed model ids', () => {
  assert.equal(ratesFor(pricing, 'claude-sonnet-4-5-20250929'), pricing['claude-sonnet-4-5']);
  assert.equal(ratesFor(pricing, 'claude-sonnet-4-20250514'), pricing['claude-sonnet-4']);
  assert.equal(ratesFor(pricing, 'claude-opus-4-1-20250805'), pricing['claude-opus-4-1']);
  assert.equal(ratesFor(pricing, 'us.anthropic.claude-opus-4-20250514-v1:0'), pricing['claude-opus-4']);
  // An unknown newer version is "not priced", never billed at an older version's rates (opus-4 costs 3x opus-4-5).
  assert.equal(ratesFor(pricing, 'claude-opus-4-10'), undefined, 'neither "claude-opus-4-1" nor "claude-opus-4" prices claude-opus-4-10');
  assert.equal(ratesFor(pricing, 'claude-opus-4-9-20270101'), undefined);
  assert.equal(ratesFor(pricing, 'claude-sonnet-4-7'), undefined);
  assert.equal(ratesFor(pricing, 'gpt-5-2025-08-07'), pricing['gpt-5'], 'a dated OpenAI snapshot keeps its base price');
  assert.equal(ratesFor(pricing, 'claude-haiku-4-5@20251001'), pricing['claude-haiku-4-5']);
  assert.equal(ratesFor(pricing, 'claude-3-5-haiku-20241022'), pricing['claude-3-5-haiku']);
  assert.equal(ratesFor(pricing, '<synthetic>'), undefined);
});

test('cost uses separate rates for 5-minute and 1-hour cache writes', () => {
  const p = parsePricing({ models: { m: { input: 1, output: 2, cacheWrite: 3, cacheWrite1h: 4, cacheRead: 5 } } });
  close(costOf(p, 'm', { input: 1e6, output: 1e6, cacheWrite: 2e6, cacheWrite1h: 1e6, cacheRead: 1e6 })!, 1 + 2 + 3 + 4 + 5);
  assert.equal(costOf(p, 'other', { input: 1, output: 1, cacheWrite: 0, cacheWrite1h: 0, cacheRead: 0 }), undefined);
});

test('a long-prompt tier prices the whole request at its rates once the prompt, cache included, is over the threshold', () => {
  const lc = { above: 100, input: 10, output: 20, cacheWrite: 30, cacheWrite1h: 40, cacheRead: 50 };
  const p = parsePricing({ models: { m: { input: 1, output: 2, cacheWrite: 3, cacheWrite1h: 4, cacheRead: 5, longContext: lc } } });
  const u = (input: number, cacheRead: number) => ({ input, output: 1e6, cacheWrite: 0, cacheWrite1h: 0, cacheRead });
  close(costOf(p, 'm', u(60, 40))!, (60 * 1 + 40 * 5) / 1e6 + 2, 'exactly at the threshold: base rates');
  close(costOf(p, 'm', u(60, 41))!, (60 * 10 + 41 * 50) / 1e6 + 20, 'cache reads count toward the prompt');
  close(costOf(p, 'm', u(60, 41), 50)!, (60 * 1 + 41 * 5) / 1e6 + 2, 'a known per-request prompt size wins over the summed usage');
  // Bundled table: Claude Haiku 5.5 above 100K-token prompts.
  close(costOf(pricing, 'claude-haiku-5-5', { input: 1000, output: 1000, cacheWrite: 0, cacheWrite1h: 0, cacheRead: 100_000 })!, (1000 * 0.5 + 1000 * 2.5 + 100_000 * 0.05) / 1e6);
  close(costOf(pricing, 'claude-haiku-5-5', { input: 1000, output: 1000, cacheWrite: 0, cacheWrite1h: 0, cacheRead: 99_000 })!, (1000 * 0.1 + 1000 * 0.5 + 99_000 * 0.01) / 1e6);
});

test('invalid pricing files are rejected with the offending field', () => {
  const base = { input: 1, output: 1, cacheWrite: 0, cacheWrite1h: 0, cacheRead: 0 };
  assert.throws(() => parsePricing({ models: { x: { ...base, longContext: { ...base, above: '200k' } } } }), /models\["x"\]\.longContext\.above/);
  assert.throws(() => parsePricing({ models: { x: { ...base, longContext: { above: 5, input: 1 } } } }), /models\["x"\]\.longContext\.output/);
  assert.throws(() => parsePricing({}), /"models" map/);
  assert.throws(() => parsePricing({ models: { x: { input: 1, output: -1, cacheWrite: 0, cacheWrite1h: 0, cacheRead: 0 } } }), /models\["x"\]\.output/);
  assert.throws(() => loadPricing('/nonexistent/pricing.json'), /Cannot read pricing file/);
});

test('session stats: tokens, estimated cost, tool calls and errors', () => {
  const { a, b } = fixtureSessions();
  const sa = sessionStats(a, pricing);
  close(sa.cost, 0.0238); // sonnet 0.0228 + haiku subagent 0.001
  assert.equal(sa.tools, 5);
  assert.equal(sa.errors, 2); // failed Bash call + API error system event
  assert.equal(sa.unpriced, false);
  const sb = sessionStats(b, pricing);
  close(sb.cost, 0.122575);
  assert.equal(sb.unpriced, true, 'claude-experimental-9 has no price');
});

test('insights aggregate by day, project, model, tool and edited file', () => {
  const { sessions } = fixtureSessions();
  const ins = computeInsights(sessions, pricing);
  assert.equal(ins.sessions, 2);
  close(ins.cost, 0.0238 + 0.122575);
  assert.deepEqual(ins.byDay.map((d) => d.key), ['2026-11-20', '2026-11-21']);
  assert.deepEqual(ins.byProject.map((p) => p.key), ['/Users/dev/notes-site', '/Users/dev/acme-api']);
  assert.deepEqual(ins.unpricedModels, ['claude-experimental-9']);
  const haiku = ins.byModel.find((m) => m.key === 'claude-haiku-4-5-20251001')!;
  assert.equal(haiku.sessions, 2);
  assert.equal(ins.toolCalls, 8);
  assert.deepEqual(ins.tools.slice(0, 1).map((t) => [t.name, t.calls]), [['Task', 2]]);
  assert.equal(ins.tools.find((t) => t.name === 'Bash')!.errors, 1);
  assert.equal(ins.slowest[0].call.name, 'Task'); // 32s in session B
  assert.equal(ins.slowest[0].call.durationMs, 32_000);
  assert.deepEqual(ins.files.map((f) => f.path).sort(), ['/Users/dev/acme-api/src/server.ts', '/Users/dev/notes-site/about.md']);
});

test('cache-only usage of an unpriced model is flagged; edits without a result are not counted', () => {
  const { a } = fixtureSessions();
  const s = { ...a, usage: [{ ts: a.start, model: 'mystery', usage: { input: 0, output: 0, cacheWrite: 0, cacheWrite1h: 0, cacheRead: 100 } }] };
  assert.equal(sessionStats(s, pricing).unpriced, true);
  assert.deepEqual(computeInsights([s], pricing).unpricedModels, ['mystery']);
  const pending = { ...a, usage: [], orphanSubagents: [], items: [{ kind: 'tool' as const, n: 0, ts: a.start, id: 'w', name: 'Write', input: { file_path: '/x' }, isError: false }] };
  assert.deepEqual(computeInsights([pending], pricing).files, []);
});

test('insights filters by project and by days, and fills empty days', () => {
  const { sessions, a } = fixtureSessions();
  const onlyA = computeInsights(sessions, pricing, { project: '/Users/dev/acme-api' });
  assert.equal(onlyA.sessions, 1);
  const recent = computeInsights(sessions, pricing, { days: 1, now: Date.parse('2026-11-21T12:00:00Z') });
  assert.equal(recent.sessions, 1);
  const gap = { ...a, id: 'later', usage: a.usage.map((e) => ({ ...e, ts: e.ts + 3 * 86_400_000 })) };
  const ins = computeInsights([a, gap], pricing);
  assert.deepEqual(ins.byDay.map((d) => d.key), ['2026-11-20', '2026-11-21', '2026-11-22', '2026-11-23']);
  assert.equal(ins.byDay[1].cost, 0);
  // usage with no timestamp anywhere counts in totals but gets no day (not 1970-01-01)
  const undated = { ...a, id: 'undated', start: 0, end: 0, usage: a.usage.map((e) => ({ ...e, ts: 0 })) };
  const ins2 = computeInsights([a, undated], pricing);
  assert.deepEqual(ins2.byDay.map((d) => d.key), ['2026-11-20']);
  assert.equal(ins2.byDay[0].usage.input * 2, ins2.usage.input);
});

test('search is case-insensitive and covers messages, tool inputs, outputs and subagents', () => {
  const { sessions } = fixtureSessions();
  const hits = search(sessions, 'STARTSERVER');
  assert.equal(hits.length, 1);
  assert.equal(hits[0].session.id, A);
  assert.ok(hits[0].total >= 5);
  assert.ok(hits[0].matches.length <= 5);
  assert.ok(hits[0].matches.some((m) => m.where === 'Grep input'), 'subagent tool input searched');
  const m = search(sessions, 'friendly and brief')[0];
  assert.equal(m.session.id, B);
  assert.equal(m.matches[0].match, 'Friendly and brief');
  assert.deepEqual(search(sessions, '   '), []);
  assert.deepEqual(search(sessions, 'no-such-text-anywhere'), []);
  // highlights stay aligned when lowercasing would change the text's length, and regex characters are literal
  const tr = { ...sessions[0], items: [{ kind: 'user' as const, n: 0, ts: 0, text: 'İstanbul foo (a+b)' }], orphanSubagents: [] };
  assert.equal(search([tr], 'FOO')[0].matches[0].match, 'foo');
  assert.equal(search([tr], 'foo')[0].matches[0].before, 'İstanbul ');
  assert.equal(search([tr], '(a+b)')[0].total, 1);
});
