// The normalized session model. Every log adapter (today: Claude Code) produces these;
// the UI, insights, search and export only ever read this shape.

export interface Usage {
  input: number;
  output: number;
  cacheWrite: number; // all cache-creation tokens
  cacheWrite1h: number; // subset of cacheWrite written with the 1-hour TTL
  cacheRead: number;
}

export interface UsageEvent {
  ts: number; // epoch ms
  model: string;
  usage: Usage;
}

export type Item =
  | { kind: 'user'; n: number; ts: number; text: string }
  | { kind: 'assistant'; n: number; ts: number; text: string; model: string; error: boolean }
  | { kind: 'thinking'; n: number; ts: number; text: string }
  | { kind: 'system'; n: number; ts: number; text: string; error: boolean }
  | ToolCall
  | { kind: 'raw'; n: number; ts: number; label: string; json: string };

export interface ToolCall {
  kind: 'tool';
  n: number;
  ts: number;
  id: string;
  name: string;
  input: unknown;
  output?: string;
  isError: boolean;
  durationMs?: number;
  subagent?: Subagent;
}

export interface Subagent {
  id: string;
  items: Item[];
}

export interface Session {
  id: string;
  source: 'claude-code';
  file: string;
  project: string; // working directory the agent ran in
  title: string;
  start: number; // epoch ms, 0 if unknown
  end: number;
  models: string[];
  items: Item[];
  orphanSubagents: Subagent[]; // subagents we could not attach to a tool call
  usage: UsageEvent[]; // includes subagent usage
}

export function emptyUsage(): Usage {
  return { input: 0, output: 0, cacheWrite: 0, cacheWrite1h: 0, cacheRead: 0 };
}

export function addUsage(a: Usage, b: Usage): Usage {
  return {
    input: a.input + b.input,
    output: a.output + b.output,
    cacheWrite: a.cacheWrite + b.cacheWrite,
    cacheWrite1h: a.cacheWrite1h + b.cacheWrite1h,
    cacheRead: a.cacheRead + b.cacheRead,
  };
}

export const totalTokens = (u: Usage) => u.input + u.output + u.cacheWrite + u.cacheRead;

/** Items in display order, descending into subagents. */
export function* walk(items: Item[]): Generator<Item> {
  for (const it of items) {
    yield it;
    if (it.kind === 'tool' && it.subagent) yield* walk(it.subagent.items);
  }
}

/** Every item of a session, including subagents (attached or not). */
export function sessionItems(s: Session): Item[] {
  const out = [...walk(s.items)];
  for (const sa of s.orphanSubagents) out.push(...walk(sa.items));
  return out;
}

export const sessionToolCalls = (s: Session) => sessionItems(s).filter((i): i is ToolCall => i.kind === 'tool');

/** A failed tool call, an API error message or an error-level system event. */
export const isErrorItem = (it: Item) => (it.kind === 'tool' && it.isError) || ((it.kind === 'assistant' || it.kind === 'system') && it.error);
