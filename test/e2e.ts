// End-to-end: the main user journey in a real browser against `tracelens serve` started by the CLI.
// Run with `npm run test:e2e` (needs Playwright's Chromium); kept out of `npm test` so that stays fast.
import assert from 'node:assert/strict';
import { spawn, type ChildProcess } from 'node:child_process';
import { appendFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { after, before, test } from 'node:test';
import { chromium, type Browser, type Page } from 'playwright';
import { CODEX_FIXTURES, FIXTURES } from './helpers.js';

const PORT = 4186;
const BASE = `http://127.0.0.1:${PORT}`;
const CLI = fileURLToPath(new URL('../src/cli.js', import.meta.url));
let server: ChildProcess;
let browser: Browser;
const problems: string[] = [];

async function serve(port: number, dir: string, codexDir: string): Promise<ChildProcess> {
  const child = spawn(process.execPath, [CLI, 'serve', '--no-open', '--port', String(port), '--dir', dir, '--codex-dir', codexDir], {
    env: { ...process.env, CODEX_HOME: join(tmpdir(), 'tracelens-no-codex-home') },
    stdio: ['ignore', 'pipe', 'inherit'],
  });
  await new Promise<void>((resolve, reject) => {
    child.stdout!.on('data', (d: Buffer) => d.toString().includes('open http') && resolve());
    child.once('exit', (code) => reject(new Error(`tracelens serve exited with ${code}`)));
  });
  return child;
}

before(async () => {
  server = await serve(PORT, FIXTURES, CODEX_FIXTURES);
  browser = await chromium.launch();
});

after(async () => {
  await browser?.close();
  server?.kill();
});

async function open(path: string): Promise<Page> {
  const page = await browser.newPage();
  page.on('console', (m) => m.type() === 'error' && problems.push(`${path}: ${m.text()}`));
  page.on('pageerror', (e) => problems.push(`${path}: ${e.message}`));
  await page.goto(BASE + path);
  return page;
}

test('list → session → tool call → search → insights → export', async () => {
  const page = await open('/');
  // Session list: both agents' sessions, sortable, with a project filter.
  await assert.doesNotReject(page.getByRole('link', { name: 'Add health check endpoint' }).waitFor());
  assert.ok(await page.locator('tr:has(.chip.agent)').count(), 'a Codex session is listed');
  await page.getByLabel('Sort by').selectOption('cost');
  await page.waitForURL(/sort=cost/);

  // Open a session and its failing tool call.
  await page.getByRole('link', { name: 'Add health check endpoint' }).click();
  await page.waitForURL(/\/session\/-Users-dev-acme-api\//);
  assert.equal(await page.getByRole('heading', { level: 1 }).textContent(), 'Add health check endpoint');
  const failed = page.locator('details.tool.error').first();
  assert.equal(await failed.getAttribute('open'), null, 'tool calls start collapsed');
  await failed.locator('summary').click();
  assert.match((await failed.locator('.io').textContent()) ?? '', /expected 200, got 404/);
  // The subagent is nested under its Task call.
  assert.equal(await page.locator('details.tool:has(.tname:text-is("Task")) .subagent').count(), 1);
  await page.getByRole('button', { name: 'Expand all tool calls' }).click();
  assert.equal(await page.locator('details.tool:not([open])').count(), 0);

  // Search from the header; a hit opens the session at the matching item, with its tool call expanded.
  await page.getByRole('searchbox', { name: 'Search all sessions' }).fill('startServer');
  await page.getByRole('button', { name: 'Search' }).click();
  await page.waitForURL(/\/search\?q=startServer/);
  assert.match((await page.locator('mark').first().textContent()) ?? '', /startServer/i);
  await page.locator('a[href*="#i-"]').filter({ hasText: 'Grep' }).first().click();
  await page.waitForURL(/#i-\d+$/);
  const anchor = new URL(page.url()).hash.slice(1);
  const shown = await page.locator(`[id="${anchor}"]`).evaluate((el: any) => {
    for (let p = el; p; p = p.parentElement) if (p.tagName === 'DETAILS' && !p.open) return false;
    return true;
  });
  assert.ok(shown, 'every <details> around the matched item (a subagent step inside a Task call) was opened');
  // Chromium opens <details> around a fragment target by itself, so the check above passes without app.js.
  // Close them and fire hashchange with no navigation: only app.js reveal() can reopen them.
  const reopened = await page.locator(`[id="${anchor}"]`).evaluate((el: any) => {
    const closed: any[] = [];
    for (let p = el; p; p = p.parentElement) if (p.tagName === 'DETAILS') (p.open = false), closed.push(p);
    const w = el.ownerDocument.defaultView;
    w.dispatchEvent(new w.HashChangeEvent('hashchange'));
    return closed.length > 0 && closed.every((d) => d.open);
  });
  assert.ok(reopened, 'app.js reveal() opens every <details> around the hash target');

  // Insights: totals, a daily chart, tables.
  await page.getByRole('link', { name: 'Insights' }).click();
  await page.waitForURL(/\/insights$/);
  assert.ok(await page.locator('svg').count(), 'charts render');
  assert.equal(await page.getByRole('heading', { name: 'Estimated cost per day' }).count(), 1);
  assert.match((await page.locator('main').textContent()) ?? '', /Bash/);

  // Export the session as Markdown, redacted (the default).
  await page.goto(`${BASE}/?sort=date`);
  await page.getByRole('link', { name: 'Add health check endpoint' }).click();
  const [download] = await Promise.all([page.waitForEvent('download'), page.getByRole('button', { name: 'Download' }).click()]);
  const md = readFileSync((await download.path())!, 'utf8');
  assert.match(md, /^# Add health check endpoint/);
  assert.ok(!md.includes('hunter2hunter2'), 'the password in the tool output is redacted');
  assert.ok(!md.includes('/Users/dev'), 'paths are redacted');
  await page.close();
  assert.deepEqual(problems, []);
});

test('an unknown session and a broken URL give friendly pages, not a crash', async () => {
  const page = await open('/session/nope/nope');
  assert.match((await page.locator('h1').textContent()) ?? '', /Session not found/);
  const res = await page.goto(`${BASE}/session/%E0%A4%A/x`);
  assert.equal(res?.status(), 400);
  await page.close();
});

test('a running session updates in place and keeps open tool calls open', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'tracelens-e2e-live-'));
  mkdirSync(join(dir, '-Users-dev-live'));
  const file = join(dir, '-Users-dev-live', 'live-1.jsonl');
  const step = (n: number) =>
    appendFileSync(
      file,
      [
        { type: 'assistant', message: { id: `m${n}`, content: [{ type: 'text', text: `Step ${n} reply` }, { type: 'tool_use', id: `t${n}`, name: 'Bash', input: { command: `run step ${n}` } }] } },
        { type: 'user', message: { content: [{ type: 'tool_result', tool_use_id: `t${n}`, content: `output of step ${n}` }] } },
      ].map((r) => JSON.stringify({ ...r, timestamp: new Date().toISOString(), cwd: '/Users/dev/live' }) + '\n').join(''),
    );
  appendFileSync(file, JSON.stringify({ type: 'user', timestamp: new Date().toISOString(), cwd: '/Users/dev/live', message: { content: 'Watch me work' } }) + '\n');
  step(0);
  const port = PORT - 1;
  const live = await serve(port, dir, join(dir, 'no-codex'));
  try {
    const page = await browser.newPage();
    const errors: string[] = [];
    page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
    page.on('pageerror', (e) => errors.push(e.message));
    await page.goto(`http://127.0.0.1:${port}/session/-Users-dev-live/live-1`);
    assert.match((await page.locator('[data-live]').textContent()) ?? '', /Live/);
    await page.locator('details.tool summary').first().click();
    step(1);
    await page.getByText('Step 1 reply').waitFor({ timeout: 10_000 });
    assert.equal(await page.locator('details.tool').count(), 2);
    assert.equal(await page.locator('details.tool').first().getAttribute('open'), '', 'the tool call opened before the update is still open');
    assert.equal(await page.locator('details.tool').nth(1).getAttribute('open'), null, 'the new tool call arrives collapsed');
    assert.match((await page.locator('[data-live]').textContent()) ?? '', /updated/);
    await page.close();
    assert.deepEqual(errors, []);
  } finally {
    live.kill();
    rmSync(dir, { recursive: true });
  }
});
