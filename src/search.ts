import { sessionItems, type Item, type Session } from './types.js';

export interface Match {
  n: number; // item number, the anchor in the session view
  where: string;
  before: string;
  match: string;
  after: string;
}

export interface Hit {
  session: Session;
  total: number;
  matches: Match[]; // first few only
}

function searchable(it: Item): [string, string][] {
  switch (it.kind) {
    case 'tool':
      return [
        [`${it.name} input`, JSON.stringify(it.input ?? '')],
        [`${it.name} output`, it.output ?? ''],
      ];
    case 'raw':
      return [[it.label, it.json]];
    default:
      return [[it.kind, it.text]];
  }
}

const CONTEXT = 70;

/** Case-insensitive substring search over every message, tool input and tool output.
 *  shortcut: linear scan over in-memory text; fine for thousands of sessions, add an index if it gets slow. */
export function search(sessions: Session[], query: string, perSession = 5): Hit[] {
  const q = query.trim().toLowerCase();
  if (!q) return [];
  const hits: Hit[] = [];
  for (const session of sessions) {
    const hit: Hit = { session, total: 0, matches: [] };
    for (const it of sessionItems(session)) {
      for (const [where, text] of searchable(it)) {
        const lower = text.toLowerCase();
        for (let i = lower.indexOf(q); i >= 0; i = lower.indexOf(q, i + q.length)) {
          hit.total++;
          if (hit.matches.length < perSession)
            hit.matches.push({
              n: it.n,
              where,
              before: (i > CONTEXT ? '…' : '') + text.slice(Math.max(0, i - CONTEXT), i),
              match: text.slice(i, i + q.length),
              after: text.slice(i + q.length, i + q.length + CONTEXT) + (i + q.length + CONTEXT < text.length ? '…' : ''),
            });
        }
      }
    }
    if (hit.total) hits.push(hit);
  }
  return hits.sort((a, b) => b.total - a.total);
}
