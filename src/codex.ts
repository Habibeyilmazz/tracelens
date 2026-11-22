// Codex CLI adapter: finds rollout files under a sessions directory (default ~/.codex/sessions,
// laid out as YYYY/MM/DD/rollout-<time>-<uuid>.jsonl) and turns their records into Sessions.
// Files are only ever opened for reading.

import { readdirSync } from 'node:fs';
import { basename, join } from 'node:path';
import { num, readLines, type SessionFiles } from './claude.js';
import type { Item, Session, ToolCall, UsageEvent } from './types.js';

type Rec = any; // JSONL records are untrusted, loosely-typed input

export const isRollout = (path: string) => /^rollout-.*\.jsonl$/.test(basename(path));

export function discoverCodex(dir: string): SessionFiles[] {
  let names: string[];
  try {
    names = readdirSync(dir, { recursive: true, encoding: 'utf8' });
  } catch {
    return [];
  }
  return names
    .filter(isRollout)
    .sort()
    .map((name) => ({ id: idFromName(name), main: join(dir, name), subagents: [] }));
}

const UUID = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i;
const idFromName = (path: string) => UUID.exec(basename(path))?.[0] ?? basename(path, '.jsonl');

// Event messages that repeat what the response items already hold (prompts, replies, reasoning,
// tool calls and their results), or carry nothing to read.
const DUPLICATE_EVENTS = new Set([
  'user_message', 'agent_message', 'agent_reasoning', 'agent_reasoning_raw_content', 'agent_reasoning_section_break',
  'task_started', 'task_complete', 'exec_command_begin', 'exec_command_end', 'exec_command_output_delta',
  'patch_apply_begin', 'patch_apply_end', 'mcp_tool_call_begin', 'mcp_tool_call_end', 'web_search_begin', 'web_search_end',
  'turn_diff', 'plan_update', 'view_image_tool_call',
]);

/** Text Codex injects as a "user" message (environment, AGENTS.md); returns a label for it, or undefined for a real prompt. */
export function contextLabel(text: string): string | undefined {
  const t = text.trim();
  if (t.startsWith('# AGENTS.md instructions')) return 'AGENTS.md instructions';
  const tag = /^<([a-z_ -]+)>[\s\S]*<\/\1>$/i.exec(t);
  return tag ? tag[1] : undefined;
}

function blocksOf(content: unknown): string[] {
  if (typeof content === 'string') return [content];
  if (!Array.isArray(content)) return content == null ? [] : [JSON.stringify(content, null, 2)];
  return content.map((b: Rec) => (typeof b?.text === 'string' ? b.text : b?.type === 'input_image' ? '[image]' : JSON.stringify(b)));
}

/** A tool result's text. Older versions wrapped shell output as JSON: {"output": "...", "metadata": {"exit_code": 1}}. */
function outputOf(o: unknown): { text: string; failed: boolean } {
  if (typeof o === 'string') {
    if (o.startsWith('{')) {
      try {
        const j = JSON.parse(o);
        if (typeof j?.output === 'string') return { text: j.output, failed: num(j.metadata?.exit_code) > 0 };
      } catch {
        // plain text that happens to start with '{'
      }
    }
    // Newer versions start shell results with "Exit code: N" or "Process exited with code N".
    const head = o.split('\n', 4).join('\n');
    const code = /^(?:Exit code:|Process exited with code) (\d+)/m.exec(head);
    return { text: o, failed: !!code && code[1] !== '0' };
  }
  const r = o as Rec;
  const text = typeof r?.content === 'string' ? r.content : blocksOf(r?.content ?? r).join('\n');
  return { text, failed: r?.success === false };
}

const tokens = (u: Rec) => ({ input: num(u?.input_tokens), cached: num(u?.cached_input_tokens), output: num(u?.output_tokens) });

export function parseCodex(files: SessionFiles): Session {
  const items: Item[] = [];
  const pending = new Map<string, ToolCall>();
  const usage: UsageEvent[] = [];
  const models = new Set<string>();
  let n = 0, ts = 0, first = 0, last = 0;
  let id = files.id, cwd: string | undefined, model = 'unknown';
  let prevTotal: ReturnType<typeof tokens> | undefined;

  const push = (it: Item) => items.push(it);
  const raw = (label: string, json: string) => push({ kind: 'raw', n: n++, ts, label, json });
  const note = (text: string, error = false) => push({ kind: 'system', n: n++, ts, text, error });
  const call = (name: unknown, callId: unknown, input: unknown) => {
    const c: ToolCall = { kind: 'tool', n: n++, ts, id: String(callId ?? ''), name: typeof name === 'string' ? name : 'unknown', input, isError: false };
    if (c.id) pending.set(c.id, c);
    push(c);
  };

  for (const { rec, raw: rawLine, lineNo } of readLines(files.main)) {
    if (!rec) {
      raw(`Unreadable line ${lineNo}`, rawLine);
      continue;
    }
    const t = typeof rec.timestamp === 'string' ? Date.parse(rec.timestamp) : NaN;
    if (Number.isFinite(t)) {
      ts = t;
      if (!first || t < first) first = t;
      if (t > last) last = t;
    }

    let type = rec.type;
    let p = rec.payload;
    if (!p || typeof p !== 'object') {
      // Files from before the {timestamp, type, payload} envelope: a bare metadata line, then bare response items.
      if (rec.record_type === 'state') continue;
      if (lineNo === 1 && rec.type === undefined && typeof rec.id === 'string') [type, p] = ['session_meta', rec];
      else [type, p] = ['response_item', rec];
    }

    if (type === 'session_meta') {
      if (typeof p.id === 'string' && p.id) id = p.id;
      if (typeof p.cwd === 'string') cwd ??= p.cwd;
    } else if (type === 'turn_context') {
      if (typeof p.model === 'string' && p.model) models.add((model = p.model));
      if (typeof p.cwd === 'string') cwd ??= p.cwd;
    } else if (type === 'response_item') {
      switch (p.type) {
        case 'message':
          for (const text of blocksOf(p.content)) {
            if (!text.trim()) continue;
            if (p.role === 'assistant') {
              push({ kind: 'assistant', n: n++, ts, text, model, error: false });
            } else if (p.role === 'user') {
              const ctx = contextLabel(text);
              if (ctx) {
                raw(`Context added by Codex: ${ctx}`, text);
                cwd ??= /<cwd>([^<\n]+)<\/cwd>/.exec(text)?.[1].trim();
              }
              else push({ kind: 'user', n: n++, ts, text });
            } else raw(`Instructions (${String(p.role)})`, text);
          }
          break;
        case 'reasoning': {
          const text = [...blocksOf(p.summary), ...(Array.isArray(p.content) ? blocksOf(p.content) : [])].join('\n\n');
          if (text.trim()) push({ kind: 'thinking', n: n++, ts, text });
          break;
        }
        case 'function_call': {
          let input: unknown = p.arguments;
          try {
            if (typeof input === 'string') input = JSON.parse(input);
          } catch {
            // keep the raw argument string
          }
          call(p.name, p.call_id, input);
          break;
        }
        case 'custom_tool_call':
          call(p.name, p.call_id, p.input);
          break;
        case 'local_shell_call':
          call('local_shell', p.call_id ?? p.id, p.action);
          break;
        case 'web_search_call':
          call('web_search', undefined, p.action ?? {});
          break;
        case 'function_call_output':
        case 'custom_tool_call_output': {
          const c = pending.get(p.call_id);
          if (!c) {
            raw('Tool result without a matching call', JSON.stringify(p, null, 2));
            break;
          }
          pending.delete(p.call_id);
          const out = outputOf(p.output);
          c.output = out.text;
          c.isError = out.failed;
          if (c.ts && ts >= c.ts) c.durationMs = ts - c.ts;
          break;
        }
        case 'ghost_snapshot':
          break; // undo bookkeeping (a git commit id), nothing to read
        default:
          raw(`Unrecognized response item: ${String(p.type)}`, JSON.stringify(rec, null, 2));
      }
    } else if (type === 'event_msg') {
      if (p.type === 'token_count') {
        const info = p.info;
        if (!info) continue;
        // total_token_usage is cumulative and the same total is often written twice: count the growth since the
        // last one. If it ever shrinks (a resumed session), fall back to the per-response numbers.
        const total = info.total_token_usage ? tokens(info.total_token_usage) : undefined;
        const lastResp = info.last_token_usage ? tokens(info.last_token_usage) : undefined;
        let u: ReturnType<typeof tokens> | undefined;
        if (total && prevTotal && total.input >= prevTotal.input && total.output >= prevTotal.output && total.cached >= prevTotal.cached)
          u = { input: total.input - prevTotal.input, cached: total.cached - prevTotal.cached, output: total.output - prevTotal.output };
        else u = prevTotal ? lastResp : (total ?? lastResp);
        if (total) prevTotal = total;
        if (!u || !(u.input || u.output)) continue;
        // OpenAI counts cached tokens inside input_tokens, and reasoning tokens inside output_tokens.
        usage.push({ ts, model, usage: { input: Math.max(0, u.input - u.cached), output: u.output, cacheWrite: 0, cacheWrite1h: 0, cacheRead: Math.min(u.cached, u.input) } });
      } else if (p.type === 'error') note(typeof p.message === 'string' ? p.message : 'Error', true);
      else if (p.type === 'stream_error') note(`Stream error${typeof p.message === 'string' ? `: ${p.message}` : ''}`);
      else if (p.type === 'turn_aborted') note(`Turn aborted${typeof p.reason === 'string' ? ` (${p.reason})` : ''}`);
      else if (p.type === 'context_compacted') note('Context compacted: earlier messages were summarised for the model.');
      else if (!DUPLICATE_EVENTS.has(p.type)) raw(`Unrecognized event: ${String(p.type)}`, JSON.stringify(rec, null, 2));
    } else if (type === 'compacted') {
      if (typeof p.message === 'string' && p.message.trim()) note(`Compaction summary:\n${p.message}`);
    } else {
      raw(`Unrecognized event: ${String(type)}`, JSON.stringify(rec, null, 2));
    }
  }

  const prompt = items.find((i) => i.kind === 'user');
  return {
    id,
    source: 'codex',
    file: files.main,
    project: cwd ?? '(unknown folder)', // the day folder a rollout sits in says nothing about the project
    title: (prompt?.kind === 'user' ? prompt.text : '(no prompt)').replace(/\s+/g, ' ').trim().slice(0, 140),
    start: first,
    end: last,
    models: [...models],
    items,
    orphanSubagents: [],
    usage,
  };
}
