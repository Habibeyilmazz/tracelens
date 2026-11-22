import { statSync } from 'node:fs';
import { basename, dirname } from 'node:path';
import { discover, parseSession } from './claude.js';
import { discoverCodex, parseCodex } from './codex.js';
import type { Session } from './types.js';

/** Keeps parsed sessions in memory and re-parses only files whose size or mtime changed. */
export class Store {
  private cache = new Map<string, { sig: string; session: Session }>();

  /** dir: Claude Code projects folder. codexDir: Codex CLI sessions folder, if any. */
  constructor(readonly dir: string, readonly codexDir?: string) {}

  sessions(): Session[] {
    const next = new Map<string, { sig: string; session: Session }>();
    const found = [
      ...discover(this.dir).map((files) => ({ files, parse: parseSession })),
      ...(this.codexDir ? discoverCodex(this.codexDir).map((files) => ({ files, parse: parseCodex })) : []),
    ];
    for (const { files, parse } of found) {
      const sig = [files.main, ...files.subagents].map(signature).join('|');
      const hit = this.cache.get(files.main);
      if (hit && hit.sig === sig) {
        next.set(files.main, hit);
        continue;
      }
      try {
        next.set(files.main, { sig, session: parse(files) });
      } catch (err) {
        // A file vanishing or being unreadable mid-scan must not take the UI down.
        console.warn(`tracelens: skipped ${files.main}: ${(err as Error).message}`);
      }
    }
    this.cache = next;
    return [...next.values()]
      .map((v) => v.session)
      .filter((s) => s.items.length || s.orphanSubagents.length || s.usage.length) // drops e.g. files holding only summary lines
      .sort((a, b) => b.start - a.start);
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

/** The project folder a session file sits in; with the id it names one session (ids can repeat across folders). */
export const folderOf = (s: Session) => basename(dirname(s.file));

/** Exact id, or a unique id prefix. Throws with a message fit for the user otherwise. */
export function findSession(sessions: Session[], query: string): Session {
  const exact = sessions.filter((s) => s.id === query);
  const matches = exact.length ? exact : sessions.filter((s) => s.id.startsWith(query));
  if (matches.length === 1) return matches[0];
  if (matches.length === 0) throw new Error(`No session matches "${query}". Run "tracelens list" to see session ids.`);
  if (exact.length)
    throw new Error(`session ${query} is in ${exact.length} project folders; export it by its file path instead:\n${exact.map((s) => `  ${s.file}`).join('\n')}`);
  throw new Error(`"${query}" matches ${matches.length} sessions; use more characters of the id.`);
}
