import { fileURLToPath } from 'node:url';
import { Store } from '../src/store.js';

export const FIXTURES = fileURLToPath(new URL('../../test/fixtures/projects', import.meta.url));
export const A = '11111111-aaaa-4aaa-8aaa-111111111111';
export const B = '22222222-bbbb-4bbb-8bbb-222222222222';

export function fixtureSessions() {
  const sessions = new Store(FIXTURES).sessions();
  const get = (id: string) => sessions.find((s) => s.id === id)!;
  return { sessions, a: get(A), b: get(B) };
}
