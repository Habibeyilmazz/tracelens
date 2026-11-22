// Claude Code adapter: finds transcript files under a projects directory
// (default ~/.claude/projects) and turns their JSONL records into Sessions.
// Files are only ever opened for reading.

import { closeSync, existsSync, openSync, readdirSync, readFileSync, readSync } from 'node:fs';
import { basename, dirname, join } from 'node:path';
import type { Item, Session, Subagent, ToolCall, Usage, UsageEvent } from './types.js';

export interface SessionFiles {
  id: string;
  main: string;
  subagents: string[];
}

// eslint-style escape hatch: JSONL records are untrusted, loosely-typed input.
type Rec = any;

const isJsonl = (f: string) => f.endsWith('.jsonl');

/** Layout: <dir>/<encoded-cwd>/<session-id>.jsonl, subagents in <session-id>/subagents/*.jsonl
 *  or (older layout) agent-*.jsonl files next to the sessions. */
export function discover(dir: string): SessionFiles[] {
  const out: SessionFiles[] = [];
  for (const project of safeReaddir(dir)) {
    if (!project.isDirectory()) continue;
    const pdir = join(dir, project.name);
    const byId = new Map<string, SessionFiles>();
    const loose: string[] = [];
    const entries = safeReaddir(pdir);
    for (const e of entries) {
      if (!e.isFile() || !isJsonl(e.name)) continue;
      const path = join(pdir, e.name);
      if (e.name.startsWith('agent-')) loose.push(path);
      else byId.set(e.name.slice(0, -6), { id: e.name.slice(0, -6), main: path, subagents: [] });
    }
    for (const e of entries) {
      const s = e.isDirectory() && byId.get(e.name);
      if (!s) continue;
      const sub = join(pdir, e.name, 'subagents');
      for (const f of safeReaddir(sub)) if (f.isFile() && isJsonl(f.name)) s.subagents.push(join(sub, f.name));
    }
    for (const path of loose) {
      const sid = firstRecord(path)?.sessionId;
      const s = typeof sid === 'string' && byId.get(sid);
      if (s) s.subagents.push(path);
    }
    out.push(...byId.values());
  }
  return out;
}

/** Session files for a single .jsonl path given on the command line. */
export function filesForPath(path: string): SessionFiles {
  const id = basename(path).replace(/\.jsonl$/, '');
  const sub = join(dirname(path), id, 'subagents');
  const subagents = existsSync(sub)
    ? safeReaddir(sub).filter((f) => f.isFile() && isJsonl(f.name)).map((f) => join(sub, f.name))
    : [];
  for (const f of safeReaddir(dirname(path)))
    if (f.isFile() && f.name.startsWith('agent-') && isJsonl(f.name) && firstRecord(join(dirname(path), f.name))?.sessionId === id)
      subagents.push(join(dirname(path), f.name));
  return { id, main: path, subagents };
}

function safeReaddir(dir: string) {
  try {
    return readdirSync(dir, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name));
  } catch {
    return [];
  }
}

function firstRecord(path: string): Rec | undefined {
  let fd: number | undefined;
  try {
    // Inside the try: an unreadable or vanished agent file must not break discovery of every session.
    fd = openSync(path, 'r');
    // Read until the first newline; a first record can be large (a long prompt or pasted file).
    const chunks: Buffer[] = [];
    for (let pos = 0; pos < 16 * 1024 * 1024; ) {
      const buf = Buffer.alloc(64 * 1024);
      const n = readSync(fd, buf, 0, buf.length, pos);
      if (!n) break;
      const nl = buf.subarray(0, n).indexOf(10);
      chunks.push(buf.subarray(0, nl < 0 ? n : nl));
      if (nl >= 0) break;
      pos += n;
    }
    return JSON.parse(Buffer.concat(chunks).toString('utf8'));
  } catch {
    return undefined;
  } finally {
    if (fd !== undefined) closeSync(fd);
  }
}

interface Line {
  rec?: Rec;
  raw: string;
  lineNo: number;
}

function readLines(path: string): Line[] {
  const out: Line[] = [];
  readFileSync(path, 'utf8')
    .split('\n')
    .forEach((raw, i) => {
      if (!raw.trim()) return;
      let rec: Rec;
      try {
        rec = JSON.parse(raw);
      } catch {
        rec = undefined;
      }
      // Only plain objects count as records; anything else is shown raw.
      out.push({ rec: rec && typeof rec === 'object' && !Array.isArray(rec) ? rec : undefined, raw, lineNo: i + 1 });
    });
  return out;
}

export function textOf(content: unknown): string {
  if (typeof content === 'string') return content;
  if (content == null) return '';
  if (Array.isArray(content))
    return content
      .map((b: Rec) => (b?.type === 'text' && typeof b.text === 'string' ? b.text : b?.type === 'image' ? '[image]' : JSON.stringify(b)))
      .join('\n');
  return JSON.stringify(content, null, 2);
}

const num = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) && v > 0 ? v : 0);

export function toUsage(u: Rec): Usage {
  const cacheWrite = num(u?.cache_creation_input_tokens);
  return {
    input: num(u?.input_tokens),
    output: num(u?.output_tokens),
    cacheWrite,
    cacheWrite1h: Math.min(cacheWrite, num(u?.cache_creation?.ephemeral_1h_input_tokens)),
    cacheRead: num(u?.cache_read_input_tokens),
  };
}

interface Ctx {
  n: number; // running item number, unique across the whole session
  usage: Map<string, UsageEvent>;
  models: Set<string>;
  firstTs: number;
  lastTs: number;
  summary?: string;
}

/** Turn a run of records (main thread or one subagent) into display items. */
function buildItems(lines: Line[], ctx: Ctx, source: string): Item[] {
  const items: Item[] = [];
  const pending = new Map<string, ToolCall>();
  let ts = 0;
  const push = (it: Item) => items.push(it);
  const raw = (label: string, json: string) => push({ kind: 'raw', n: ctx.n++, ts, label, json });

  for (const { rec, raw: rawLine, lineNo } of lines) {
    if (!rec) {
      raw(`Unreadable line ${lineNo}`, rawLine);
      continue;
    }
    const t = typeof rec.timestamp === 'string' ? Date.parse(rec.timestamp) : NaN;
    if (Number.isFinite(t)) {
      ts = t;
      if (!ctx.firstTs || t < ctx.firstTs) ctx.firstTs = t;
      if (t > ctx.lastTs) ctx.lastTs = t;
    }
    const content = rec.message?.content;

    if (rec.type === 'user' && content !== undefined) {
      const blocks = typeof content === 'string' ? [{ type: 'text', text: content }] : Array.isArray(content) ? content : [content];
      for (const b of blocks) {
        if (b?.type === 'text' && typeof b.text === 'string') {
          // Meta messages and post-compaction summaries are written by Claude Code, not typed by the user.
          if (rec.isMeta || rec.isCompactSummary) push({ kind: 'system', n: ctx.n++, ts, text: b.text, error: false });
          else push({ kind: 'user', n: ctx.n++, ts, text: b.text });
        } else if (b?.type === 'tool_result') {
          const call = pending.get(b.tool_use_id);
          if (call) {
            pending.delete(b.tool_use_id);
            call.output = textOf(b.content);
            call.isError = b.is_error === true;
            if (ts >= call.ts && call.ts) call.durationMs = ts - call.ts;
          } else raw('Tool result without a matching call', JSON.stringify(b, null, 2));
        } else if (b?.type === 'image') {
          push({ kind: 'user', n: ctx.n++, ts, text: '[image]' });
        } else raw(`Unrecognized user content: ${String(b?.type)}`, JSON.stringify(b, null, 2));
      }
    } else if (rec.type === 'assistant' && rec.message && typeof rec.message === 'object') {
      const msg = rec.message;
      const model = typeof msg.model === 'string' ? msg.model : 'unknown';
      if (model !== '<synthetic>') ctx.models.add(model);
      // '<synthetic>' messages are made up locally by Claude Code (API errors, "No response requested"): no API usage.
      if (msg.usage && typeof msg.usage === 'object' && model !== '<synthetic>') {
        // Claude Code writes one line per content block, repeating the message's usage: count it once.
        const key = String(msg.id ?? rec.requestId ?? rec.uuid ?? `${source}:${lineNo}`);
        ctx.usage.set(key, { ts, model, usage: toUsage(msg.usage) });
      }
      const error = rec.isApiErrorMessage === true;
      const blocks = typeof content === 'string' ? [{ type: 'text', text: content }] : Array.isArray(content) ? content : [];
      for (const b of blocks) {
        if (b?.type === 'text' && typeof b.text === 'string') {
          if (b.text.trim()) push({ kind: 'assistant', n: ctx.n++, ts, text: b.text, model, error });
        } else if (b?.type === 'thinking') {
          if (typeof b.thinking === 'string' && b.thinking.trim()) push({ kind: 'thinking', n: ctx.n++, ts, text: b.thinking });
        } else if (b?.type === 'redacted_thinking') {
          // encrypted, nothing to show
        } else if (b?.type === 'tool_use') {
          const call: ToolCall = {
            kind: 'tool',
            n: ctx.n++,
            ts,
            id: String(b.id ?? ''),
            name: typeof b.name === 'string' ? b.name : 'unknown',
            input: b.input,
            isError: false,
          };
          pending.set(call.id, call);
          push(call);
        } else raw(`Unrecognized assistant content: ${String(b?.type)}`, JSON.stringify(b, null, 2));
      }
    } else if (rec.type === 'system') {
      const text = typeof rec.content === 'string' ? rec.content : String(rec.subtype ?? 'system event');
      push({ kind: 'system', n: ctx.n++, ts, text, error: rec.level === 'error' });
    } else if (rec.type === 'summary') {
      if (!ctx.summary && typeof rec.summary === 'string') ctx.summary = rec.summary;
    } else if (rec.type === 'file-history-snapshot') {
      // Checkpoint bookkeeping (file backups), written before each prompt; nothing to read in a transcript.
    } else {
      raw(`Unrecognized event: ${String(rec.type)}`, JSON.stringify(rec, null, 2));
    }
  }
  return items;
}

/** Inline subagent records (isSidechain) are grouped by agentId, else by the root of their parentUuid chain. */
function groupSidechains(lines: Line[]): Line[][] {
  const rootOf = new Map<string, string>();
  const groups = new Map<string, Line[]>();
  for (const l of lines) {
    const r = l.rec;
    let key: string;
    if (typeof r.agentId === 'string') key = r.agentId;
    else {
      key = (r.parentUuid && rootOf.get(r.parentUuid)) || r.uuid || `line-${l.lineNo}`;
      if (r.uuid) rootOf.set(r.uuid, key);
    }
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key)!.push(l);
  }
  return [...groups.values()];
}

function firstPrompt(items: Item[]): string | undefined {
  const u = items.find((i) => i.kind === 'user');
  return u?.kind === 'user' ? u.text.trim() : undefined;
}

export function parseSession(files: SessionFiles): Session {
  const ctx: Ctx = { n: 0, usage: new Map(), models: new Set(), firstTs: 0, lastTs: 0 };
  const lines = readLines(files.main);
  const main = lines.filter((l) => !l.rec?.isSidechain);
  const items = buildItems(main, ctx, files.main);

  const subagents: Subagent[] = [];
  const sideGroups = groupSidechains(lines.filter((l) => l.rec?.isSidechain));
  sideGroups.forEach((g, i) => subagents.push({ id: String(g[0].rec.agentId ?? `inline-${i + 1}`), items: buildItems(g, ctx, files.main) }));
  for (const f of files.subagents) {
    const sl = readLines(f);
    const agentId = sl.find((l) => typeof l.rec?.agentId === 'string')?.rec.agentId;
    subagents.push({ id: String(agentId ?? basename(f, '.jsonl')), items: buildItems(sl, ctx, f) });
  }

  // Attach each subagent to the Task/Agent tool call whose prompt started it. Calls are in time
  // order, so matching subagents in start order pairs repeated identical prompts correctly.
  const orphanSubagents: Subagent[] = [];
  const calls = items.filter((i): i is ToolCall => i.kind === 'tool' && (i.name === 'Task' || i.name === 'Agent'));
  const startOf = (sa: Subagent) => sa.items.find((i) => i.ts)?.ts ?? Infinity;
  for (const sa of subagents.sort((x, y) => startOf(x) - startOf(y))) {
    const prompt = firstPrompt(sa.items);
    const call = calls.find((c) => !c.subagent && typeof (c.input as Rec)?.prompt === 'string' && (c.input as Rec).prompt.trim() === prompt);
    if (call) call.subagent = sa;
    else orphanSubagents.push(sa);
  }

  const cwd = lines.find((l) => typeof l.rec?.cwd === 'string')?.rec.cwd as string | undefined;
  const titleSource = ctx.summary ?? firstTitle(items) ?? '(no prompt)';
  return {
    id: files.id,
    source: 'claude-code',
    file: files.main,
    project: cwd ?? basename(dirname(files.main)),
    title: titleSource.replace(/\s+/g, ' ').trim().slice(0, 140),
    start: ctx.firstTs,
    end: ctx.lastTs,
    models: [...ctx.models],
    items,
    orphanSubagents,
    usage: [...ctx.usage.values()],
  };
}

function firstTitle(items: Item[]): string | undefined {
  const users = items.filter((i) => i.kind === 'user') as { text: string }[];
  // Slash-command wrappers start with '<'; prefer a real prompt.
  return (users.find((u) => !u.text.trimStart().startsWith('<')) ?? users[0])?.text;
}
