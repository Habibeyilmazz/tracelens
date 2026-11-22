import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Store } from '../src/store.js';

export const FIXTURES = fileURLToPath(new URL('../../test/fixtures/projects', import.meta.url));
export const CODEX_FIXTURES = fileURLToPath(new URL('../../test/fixtures/codex', import.meta.url));
export const C = '33333333-cccc-4ccc-8ccc-333333333333';
export const D = '44444444-dddd-4ddd-8ddd-444444444444';
export const A = '11111111-aaaa-4aaa-8aaa-111111111111';
export const B = '22222222-bbbb-4bbb-8bbb-222222222222';

/** A temp projects folder where session A appears in two project folders, the second with a different first prompt. */
export function duplicateIdDir(): string {
  const dir = mkdtempSync(join(tmpdir(), 'tracelens-dup-'));
  const src = readFileSync(join(FIXTURES, '-Users-dev-acme-api', `${A}.jsonl`), 'utf8');
  for (const [folder, text] of [['-Users-dev-one', src], ['-Users-dev-two', src.replaceAll('Add health check endpoint', 'Second copy prompt')]]) {
    mkdirSync(join(dir, folder));
    writeFileSync(join(dir, folder, `${A}.jsonl`), text);
  }
  return dir;
}

export function fixtureSessions() {
  const sessions = new Store(FIXTURES).sessions();
  const get = (id: string) => sessions.find((s) => s.id === id)!;
  return { sessions, a: get(A), b: get(B) };
}
