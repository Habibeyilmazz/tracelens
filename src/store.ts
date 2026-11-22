import { statSync } from 'node:fs';
import { discover, parseSession } from './claude.js';
import type { Session } from './types.js';

/** Keeps parsed sessions in memory and re-parses only files whose size or mtime changed. */
export class Store {
  private cache = new Map<string, { sig: string; session: Session }>();

  constructor(readonly dir: string) {}

  sessions(): Session[] {
    const next = new Map<string, { sig: string; session: Session }>();
    for (const files of discover(this.dir)) {
      const sig = [files.main, ...files.subagents].map(signature).join('|');
      const hit = this.cache.get(files.main);
      if (hit && hit.sig === sig) {
        next.set(files.main, hit);
        continue;
      }
      try {
        next.set(files.main, { sig, session: parseSession(files) });
      } catch (err) {
        // A file vanishing or being unreadable mid-scan must not take the UI down.
        console.warn(`tracelens: skipped ${files.main}: ${(err as Error).message}`);
      }
    }
    this.cache = next;
    return [...next.values()].map((v) => v.session).sort((a, b) => b.start - a.start);
  }
}

function signature(path: string): string {
  try {
    const s = statSync(path);
    return `${path}:${s.size}:${s.mtimeMs}`;
  } catch {
    return `${path}:missing`;
  }
}

/** Exact id, or a unique id prefix. Throws with a message fit for the user otherwise. */
export function findSession(sessions: Session[], query: string): Session {
  const exact = sessions.find((s) => s.id === query);
  if (exact) return exact;
  const matches = sessions.filter((s) => s.id.startsWith(query));
  if (matches.length === 1) return matches[0];
  if (matches.length === 0) throw new Error(`No session matches "${query}". Run "tracelens list" to see session ids.`);
  throw new Error(`"${query}" matches ${matches.length} sessions; use more characters of the id.`);
}
