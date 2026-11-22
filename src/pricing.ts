import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import type { Usage } from './types.js';

export interface Rates {
  input: number;
  output: number;
  cacheWrite: number;
  cacheWrite1h: number;
  cacheRead: number;
  /** Rates for a request whose prompt (input + cache writes + cache reads) is over `above` tokens. */
  longContext?: Omit<Rates, 'longContext'> & { above: number };
}
export type Pricing = Record<string, Rates>;

export const DEFAULT_PRICING_PATH = fileURLToPath(new URL('../../pricing.json', import.meta.url));
const FIELDS: (keyof Rates)[] = ['input', 'output', 'cacheWrite', 'cacheWrite1h', 'cacheRead'];

/** Loads and validates a pricing file; the error names the bad entry so the user can fix it. */
export function loadPricing(path = DEFAULT_PRICING_PATH): Pricing {
  let data: any;
  try {
    data = JSON.parse(readFileSync(path, 'utf8').replace(/^\uFEFF/, '')); // Notepad may save a byte-order mark
  } catch (err) {
    throw new Error(`Cannot read pricing file ${path}: ${(err as Error).message}`);
  }
  return parsePricing(data, path);
}

export function parsePricing(data: any, where = 'pricing'): Pricing {
  const models = data?.models;
  if (!models || typeof models !== 'object' || Array.isArray(models)) throw new Error(`${where}: expected an object with a "models" map`);
  const out: Pricing = {};
  const rates = (r: any, name: string): Rates => {
    for (const f of FIELDS)
      if (typeof r?.[f] !== 'number' || !(r[f] >= 0)) throw new Error(`${where}: ${name}.${f} must be a non-negative number`);
    return { input: r.input, output: r.output, cacheWrite: r.cacheWrite, cacheWrite1h: r.cacheWrite1h, cacheRead: r.cacheRead };
  };
  for (const [key, r] of Object.entries<any>(models)) {
    out[key] = rates(r, `models["${key}"]`);
    const lc = r.longContext;
    if (lc === undefined) continue;
    const name = `models["${key}"].longContext`;
    if (!Number.isInteger(lc?.above) || lc.above < 1) throw new Error(`${where}: ${name}.above must be a whole number of tokens`);
    out[key].longContext = { above: lc.above, ...rates(lc, name) };
  }
  return out;
}

/** The longest pricing key that appears in the model id as a whole token ("claude-opus-4" prices
 *  "claude-opus-4-20250514" but not "claude-opus-4-1-…", and "gpt-5" prices "gpt-5-codex" but not "gpt-5.2"). */
export function ratesFor(pricing: Pricing, model: string): Rates | undefined {
  // Called once per request in every session; the scan over all keys was most of the insights page's time.
  let memo = matched.get(pricing);
  if (!memo) matched.set(pricing, (memo = new Map()));
  if (!memo.has(model)) memo.set(model, scanRates(pricing, model));
  return memo.get(model);
}
const matched = new WeakMap<Pricing, Map<string, Rates | undefined>>(); // a loaded table is never changed

function scanRates(pricing: Pricing, model: string): Rates | undefined {
  let best: string | undefined;
  for (const key of Object.keys(pricing)) {
    const i = model.indexOf(key);
    if (i < 0 || /^(?:[a-z0-9]|\.\d)/i.test(model.slice(i + key.length))) continue;
    if (!best || key.length > best.length) best = key;
  }
  return best ? pricing[best] : undefined;
}

/** Estimated USD for one request's usage, or undefined when the model has no price. */
export function costOf(pricing: Pricing, model: string, u: Usage, prompt = u.input + u.cacheWrite + u.cacheRead): number | undefined {
  const base = ratesFor(pricing, model);
  if (!base) return undefined;
  // Long-prompt tiers price the whole request at the higher rates; the prompt counts cached tokens too.
  const lc = base.longContext;
  const r = lc && prompt > lc.above ? lc : base;
  const cw5m = u.cacheWrite - u.cacheWrite1h;
  return (u.input * r.input + u.output * r.output + cw5m * r.cacheWrite + u.cacheWrite1h * r.cacheWrite1h + u.cacheRead * r.cacheRead) / 1e6;
}
