import { cut } from './format.js';
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
  shown: number; // matches visible in those snippets (one snippet can hold several)
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

/** Splits a query into terms: "quoted phrases" stay whole, everything else splits on whitespace.
 *  Quote marks are syntax, never part of a term; repeated terms count once. */
export function terms(query: string): string[] {
  const out = new Map<string, string>();
  for (const m of query.normalize('NFC').matchAll(/"([^"]*)"|[^\s"]+/g)) {
    const t = (m[1] ?? m[0]).trim().replace(/\s+/g, ' ');
    if (t && !out.has(t.toLowerCase())) out.set(t.toLowerCase(), t);
  }
  return [...out.values()];
}

const CONTEXT = 70;
// A term as a regex source: characters literal, and a phrase's spaces match any run of whitespace, as snippets show it.
export const termSource = (t: string) => t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/ /g, '\\s+');

/** Case-insensitive search over every message, tool input and tool output. A session is a hit when it holds
 *  every term somewhere (any order, any message), so a few remembered words find it.
 *  shortcut: linear scan over in-memory text; fine for thousands of sessions, add an index if it gets slow. */
export function search(sessions: Session[], query: string, perSession = 5): Hit[] {
  const ts = terms(query);
  if (!ts.length) return [];
  // A case-insensitive regex on the original text, not indexOf on toLowerCase(): lowercasing can change
  // the length of a string ("İ" becomes two code units), which would shift every highlight after it.
  const src = ts.map(termSource);
  const each = src.map((s) => new RegExp(s, 'iu'));
  // One pass finds every occurrence for counting and snippets; longest first so "refunds" wins over "refund".
  const order = src.map((_, i) => i).sort((a, b) => src[b].length - src[a].length);
  const all = new RegExp(order.map((i) => `(${src[i]})`).join('|'), 'giu');
  const hits: Hit[] = [];
  for (const session of sessions) {
    let total = 0;
    const found = ts.map(() => false);
    const shown = ts.map(() => false);
    // Snippets in page order: the first perSession, plus the first that shows each term. At most perSession + terms.
    const cands: { m: Match; covers: Set<number>; count: number }[] = [];
    const texts: [number, string, string][] = [];
    for (const it of sessionItems(session))
      for (const [where, raw] of searchable(it)) {
        const text = raw.normalize('NFC'); // "é" can be one code point or "e" + accent (macOS file names); match either
        // Presence is tested per term: "refund" is in "refunds" even though the one-pass regex reports "refunds".
        each.forEach((re, i) => (found[i] ||= re.test(text)));
        texts.push([it.n, where, text]);
      }
    // Snippets only for sessions holding every term: the one-pass regex is the slow part on long queries.
    if (!found.every(Boolean)) continue;
    for (const [n, where, text] of texts) {
      let shownTo = -1, last: (typeof cands)[number] | undefined; // a match inside the previous snippet's text joins it
      for (const m of text.matchAll(all)) {
        const i = m.index, end = i + m[0].length;
        const term = order[m.slice(1).findIndex((g) => g !== undefined)];
        total++;
        if (end <= shownTo && (last || shown[term])) {
          if (last) last.covers.add(term), last.count++, (shown[term] = true);
          continue;
        }
        shownTo = end + CONTEXT;
        last = undefined;
        if (cands.length >= perSession && shown[term]) continue;
        shown[term] = true;
        last = {
          covers: new Set([term]),
          count: 1,
          m: {
            n,
            where,
            before: (i > CONTEXT ? '…' : '') + text.slice(Math.max(0, i - CONTEXT), i).replace(/^[\uDC00-\uDFFF]/, ''), // no half emoji
            match: m[0],
            after: cut(text.slice(end, end + CONTEXT), CONTEXT) + (end + CONTEXT < text.length ? '…' : ''),
          },
        };
        cands.push(last);
      }
    }
    // First the earliest snippet for each term, so every word shows up at least once; then fill in page order.
    const picked = new Set<(typeof cands)[number]>();
    for (let t = 0; t < ts.length && picked.size < perSession; t++)
      if (![...picked].some((c) => c.covers.has(t))) {
        const c = cands.find((c) => c.covers.has(t)); // none when the term only occurs inside a longer one
        if (c) picked.add(c);
      }
    for (const c of cands) if (picked.size < perSession) picked.add(c);
    const keep = cands.filter((c) => picked.has(c));
    hits.push({ session, total, matches: keep.map((c) => c.m), shown: keep.reduce((a, c) => a + c.count, 0) });
  }
  return hits.sort((a, b) => b.total - a.total);
}
