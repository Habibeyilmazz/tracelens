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
        [`${it.name} input`, textValues(it.input)],
        [`${it.name} output`, it.output ?? ''],
      ];
    case 'raw':
      return [[it.label, it.json]];
    default:
      return [[it.kind, it.text]];
  }
}

// The strings inside a tool input, unescaped: JSON.stringify turns C:\x into C:\\x and " into \", so searching
// for the text as the page shows it would miss. Depth is bounded: records nested over 200 levels are not parsed.
const textValues = (v: unknown): string =>
  typeof v === 'string' ? v : v && typeof v === 'object' ? Object.values(v).map(textValues).filter(Boolean).join('\n') : v == null ? '' : String(v);

const CONTEXT = 70;

/** Case-insensitive substring search over every message, tool input and tool output.
 *  shortcut: linear scan over in-memory text; fine for thousands of sessions, add an index if it gets slow. */
export function search(sessions: Session[], query: string, perSession = 5): Hit[] {
  const q = query.trim();
  if (!q) return [];
  // A case-insensitive regex on the original text, not indexOf on toLowerCase(): lowercasing can change
  // the length of a string ("İ" becomes two code units), which would shift every highlight after it.
  const re = new RegExp(q.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'giu');
  const hits: Hit[] = [];
  for (const session of sessions) {
    const hit: Hit = { session, total: 0, matches: [] };
    for (const it of sessionItems(session)) {
      for (const [where, text] of searchable(it)) {
        for (const m of text.matchAll(re)) {
          const i = m.index, end = i + m[0].length;
          hit.total++;
          if (hit.matches.length < perSession)
            hit.matches.push({
              n: it.n,
              where,
              before: (i > CONTEXT ? '…' : '') + text.slice(Math.max(0, i - CONTEXT), i),
              match: m[0],
              after: text.slice(end, end + CONTEXT) + (end + CONTEXT < text.length ? '…' : ''),
            });
        }
      }
    }
    if (hit.total) hits.push(hit);
  }
  return hits.sort((a, b) => b.total - a.total);
}
