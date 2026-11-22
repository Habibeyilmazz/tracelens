import { costOf, type Pricing } from './pricing.js';
import { addUsage, emptyUsage, isErrorItem, sessionItems, totalTokens, type Session, type ToolCall, type Usage } from './types.js';

const pad = (n: number) => String(n).padStart(2, '0');
/** Calendar day in the machine's local time zone. */
export const dayKey = (ts: number) => {
  const d = new Date(ts);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
};

export const EDIT_TOOLS = new Set(['Edit', 'MultiEdit', 'Write', 'NotebookEdit']);

export function editedPath(call: ToolCall): string | undefined {
  if (!EDIT_TOOLS.has(call.name) || call.isError || call.output === undefined) return undefined;
  const input = call.input as any;
  const p = input?.file_path ?? input?.notebook_path;
  return typeof p === 'string' ? p : undefined;
}

export interface SessionStats {
  usage: Usage;
  cost: number;
  unpriced: boolean; // some tokens belong to a model without a price
  tools: number;
  errors: number;
}

export function sessionStats(s: Session, pricing: Pricing): SessionStats {
  let usage = emptyUsage();
  let cost = 0;
  let unpriced = false;
  for (const ev of s.usage) {
    usage = addUsage(usage, ev.usage);
    const c = costOf(pricing, ev.model, ev.usage);
    if (c === undefined) unpriced ||= totalTokens(ev.usage) > 0;
    else cost += c;
  }
  let tools = 0;
  let errors = 0;
  for (const it of sessionItems(s)) {
    if (it.kind === 'tool') tools++;
    if (isErrorItem(it)) errors++;
  }
  return { usage, cost, unpriced, tools, errors };
}

export interface Row {
  key: string;
  sessions: number;
  usage: Usage;
  cost: number;
}

export interface ToolRow {
  name: string;
  calls: number;
  errors: number;
  avgMs: number;
  maxMs: number;
}

export interface Insights {
  sessions: number;
  usage: Usage;
  cost: number;
  toolCalls: number;
  unpricedModels: string[];
  byDay: Row[];
  byProject: Row[];
  byModel: Row[];
  tools: ToolRow[];
  slowest: { session: Session; call: ToolCall }[];
  files: { path: string; edits: number; sessions: number }[];
}

export interface InsightOptions {
  days?: number; // only activity in the last N days
  project?: string;
  now?: number;
}

export function computeInsights(all: Session[], pricing: Pricing, opts: InsightOptions = {}): Insights {
  const cutoff = opts.days ? (opts.now ?? Date.now()) - opts.days * 86_400_000 : -Infinity;
  const sessions = all.filter((s) => (!opts.project || s.project === opts.project) && (s.end || s.start) >= cutoff);

  const rows = { day: new Map<string, Row & { ids: Set<string> }>(), project: new Map<string, Row & { ids: Set<string> }>(), model: new Map<string, Row & { ids: Set<string> }>() };
  const bump = (map: Map<string, Row & { ids: Set<string> }>, key: string, sid: string, u: Usage, cost: number) => {
    let r = map.get(key);
    if (!r) map.set(key, (r = { key, sessions: 0, usage: emptyUsage(), cost: 0, ids: new Set() }));
    r.ids.add(sid);
    r.sessions = r.ids.size;
    r.usage = addUsage(r.usage, u);
    r.cost += cost;
  };

  let usage = emptyUsage();
  let cost = 0;
  const unpriced = new Set<string>();
  const tools = new Map<string, ToolRow & { timed: number; totalMs: number }>();
  const timed: { session: Session; call: ToolCall }[] = [];
  const files = new Map<string, { edits: number; ids: Set<string> }>();
  let toolCalls = 0;

  for (const s of sessions) {
    for (const ev of s.usage) {
      if (ev.ts < cutoff) continue;
      const c = costOf(pricing, ev.model, ev.usage);
      if (c === undefined && totalTokens(ev.usage) > 0) unpriced.add(ev.model);
      usage = addUsage(usage, ev.usage);
      cost += c ?? 0;
      // Undated usage still counts in the totals, but must not create a 1970 day (and a 20,000-day chart).
      if (ev.ts || s.start) bump(rows.day, dayKey(ev.ts || s.start), s.id, ev.usage, c ?? 0);
      bump(rows.project, s.project, s.id, ev.usage, c ?? 0);
      bump(rows.model, ev.model, s.id, ev.usage, c ?? 0);
    }
    for (const it of sessionItems(s)) {
      if (it.kind !== 'tool' || it.ts < cutoff) continue;
      toolCalls++;
      let t = tools.get(it.name);
      if (!t) tools.set(it.name, (t = { name: it.name, calls: 0, errors: 0, avgMs: 0, maxMs: 0, timed: 0, totalMs: 0 }));
      t.calls++;
      if (it.isError) t.errors++;
      if (it.durationMs !== undefined) {
        t.timed++;
        t.totalMs += it.durationMs;
        t.maxMs = Math.max(t.maxMs, it.durationMs);
        timed.push({ session: s, call: it });
      }
      const path = editedPath(it);
      if (path) {
        let f = files.get(path);
        if (!f) files.set(path, (f = { edits: 0, ids: new Set() }));
        f.edits++;
        f.ids.add(s.id);
      }
    }
  }

  const strip = (m: Map<string, Row & { ids: Set<string> }>) => [...m.values()].map(({ ids: _ids, ...r }) => r);
  return {
    sessions: sessions.length,
    usage,
    cost,
    toolCalls,
    unpricedModels: [...unpriced].sort(),
    byDay: fillDays(strip(rows.day)),
    byProject: strip(rows.project).sort((a, b) => b.cost - a.cost || b.sessions - a.sessions),
    byModel: strip(rows.model).sort((a, b) => b.cost - a.cost),
    tools: [...tools.values()]
      .map(({ timed: n, totalMs, ...t }) => ({ ...t, avgMs: n ? totalMs / n : 0 }))
      .sort((a, b) => b.calls - a.calls || a.name.localeCompare(b.name)),
    slowest: timed.sort((a, b) => b.call.durationMs! - a.call.durationMs!).slice(0, 10),
    files: [...files.entries()]
      .map(([path, f]) => ({ path, edits: f.edits, sessions: f.ids.size }))
      .sort((a, b) => b.edits - a.edits || a.path.localeCompare(b.path))
      .slice(0, 20),
  };
}

/** Sorted days with empty days filled in, so a chart's x axis is honest. */
function fillDays(rows: Row[]): Row[] {
  if (!rows.length) return [];
  const byKey = new Map(rows.map((r) => [r.key, r]));
  const keys = [...byKey.keys()].sort();
  const [y, m, d] = keys[0].split('-').map(Number);
  const cur = new Date(y, m - 1, d, 12); // noon avoids DST edge cases
  const out: Row[] = [];
  for (let k = dayKey(cur.getTime()); k <= keys[keys.length - 1]; cur.setDate(cur.getDate() + 1), k = dayKey(cur.getTime()))
    out.push(byKey.get(k) ?? { key: k, sessions: 0, usage: emptyUsage(), cost: 0 });
  return out;
}
