// Records docs/demo.gif from a running tracelens server (normally `npm run demo`): session list,
// a transcript with tool calls, a search, insights. Needs Playwright's Chromium and ffmpeg on PATH.
// Usage: node scripts/demo-gif.mjs http://127.0.0.1:4180 [out.gif]
import { chromium } from 'playwright';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const base = process.argv[2] ?? 'http://127.0.0.1:4180';
const out = process.argv[3] ?? 'docs/demo.gif';
const tmp = mkdtempSync(join(tmpdir(), 'tracelens-gif-'));
const size = { width: 1200, height: 750 };

const browser = await chromium.launch();
const context = await browser.newContext({ viewport: size, recordVideo: { dir: tmp, size } });
const page = await context.newPage();
const pause = (ms) => page.waitForTimeout(ms);
const scroll = async (dy, steps = 10) => {
  for (let i = 0; i < steps; i++) await page.mouse.wheel(0, dy / steps), await pause(40);
};

await page.goto(base + '/?sort=cost');
await pause(1800);
await page.locator('td.title a').first().click();
await page.waitForLoadState();
await pause(1200);
await scroll(500);
await page.locator('details.tool:has(.subagent) > summary').first().click();
await pause(1400);
await scroll(700);
await pause(800);
const search = page.getByRole('searchbox', { name: 'Search all sessions' });
await page.evaluate(() => scrollTo(0, 0));
await search.click();
await search.pressSequentially('refund decimal', { delay: 90 });
await search.press('Enter');
await page.waitForLoadState();
await pause(1800);
await page.locator('a[href*="#i-"]').first().click();
await page.waitForLoadState();
await pause(1800);
await page.getByRole('link', { name: 'Insights' }).click();
await page.waitForLoadState();
await pause(1500);
await scroll(600);
await pause(1500);
await context.close();
await browser.close();

const video = join(tmp, readdirSync(tmp).find((f) => f.endsWith('.webm')));
// Two passes through one palette keep the GIF small and the UI colours exact.
execFileSync('ffmpeg', ['-y', '-loglevel', 'error', '-i', video, '-vf',
  'fps=10,scale=900:-1:flags=lanczos,split[a][b];[a]palettegen=max_colors=96:stats_mode=diff[p];[b][p]paletteuse=dither=none:diff_mode=rectangle',
  out]);
rmSync(tmp, { recursive: true });
console.log(`wrote ${out}`);
