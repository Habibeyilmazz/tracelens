// Drives a running tracelens server with Playwright: checks each page for console
// errors and horizontal overflow, and saves screenshots.
// Usage: node scripts/screenshots.mjs http://127.0.0.1:4181 [out-dir]
import { chromium } from 'playwright';
import { mkdirSync } from 'node:fs';

const base = process.argv[2] ?? 'http://127.0.0.1:4181';
const out = process.argv[3] ?? 'docs/screenshots';
mkdirSync(`${out}/qa`, { recursive: true }); // qa/ holds extra checks, not committed

const browser = await chromium.launch();
const problems = [];
async function shoot(name, path, { width = 1280, height = 860, scheme = 'light', full = false, before, scrolled = false } = {}) {
  const page = await browser.newPage({ viewport: { width, height }, colorScheme: scheme, deviceScaleFactor: 2 });
  page.on('console', (m) => m.type() === 'error' && problems.push(`${name}: console ${m.text()}`));
  page.on('pageerror', (e) => problems.push(`${name}: ${e.message}`));
  const res = await page.goto(base + path);
  if (!res.ok()) problems.push(`${name}: HTTP ${res.status()}`);
  if (before) {
    await before(page);
    if (!scrolled) await page.evaluate(() => window.scrollTo(0, 0));
  }
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  if (overflow > 0) problems.push(`${name}: page scrolls horizontally by ${overflow}px`);
  await page.screenshot({ path: `${out}/${name}.png`, fullPage: full });
  await page.close();
  return page;
}

const home = await browser.newPage();
await home.goto(base + '/?sort=cost');
const href = await home.locator('td.title a').first().getAttribute('href');
await home.close();

await shoot('sessions', '/');
await shoot('insights', '/insights');
await shoot('qa/insights-full', '/insights', { full: true });
await shoot('session', href, {
  before: async (p) => {
    await p.locator('details.tool:has(.subagent) > summary').first().click().catch(() => {});
    await p.locator('details.tool.error > summary').first().click().catch(() => {});
  },
});
await shoot('session-reply', href, {
  width: 1100,
  height: 620,
  scrolled: true,
  before: (p) => p.locator('.k-assistant').last().evaluate((el) => el.scrollIntoView({ block: 'end' })),
});
await shoot('qa/sessions-mobile-dark', '/', { width: 390, height: 844, scheme: 'dark' });
await shoot('search', '/search?q=config.timeoutMs');
await shoot('session-dark', href, { scheme: 'dark', before: (p) => p.locator('[data-toggle=open]').click() });
await shoot('qa/insights-dark', '/insights', { scheme: 'dark' });
await shoot('qa/sessions-mobile', '/', { width: 390, height: 844 });
await shoot('qa/session-mobile', href, { width: 390, height: 844, before: (p) => p.locator('[data-toggle=open]').click() });
await shoot('qa/insights-mobile', '/insights', { width: 390, height: 844, full: true });
await browser.close();

if (problems.length) {
  console.error(problems.join('\n'));
  process.exit(1);
}
console.log(`screenshots written to ${out}`);
