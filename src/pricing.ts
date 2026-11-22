import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import type { Usage } from './types.js';

export interface Rates {
  input: number;
  output: number;
  cacheWrite: number;
  cacheWrite1h: number;
  cacheRead: number;
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
  for (const [key, r] of Object.entries<any>(models)) {
    for (const f of FIELDS)
      if (typeof r?.[f] !== 'number' || !(r[f] >= 0)) throw new Error(`${where}: models["${key}"].${f} must be a non-negative number`);
    out[key] = { input: r.input, output: r.output, cacheWrite: r.cacheWrite, cacheWrite1h: r.cacheWrite1h, cacheRead: r.cacheRead };
  }
  return out;
}

/** The longest pricing key that appears in the model id as a whole token ("claude-opus-4" prices
 *  "claude-opus-4-20250514" but not "claude-opus-4-1-…", and "gpt-5" prices "gpt-5-codex" but not "gpt-5.2"). */
export function ratesFor(pricing: Pricing, model: string): Rates | undefined {
  let best: string | undefined;
  for (const key of Object.keys(pricing)) {
    const i = model.indexOf(key);
    if (i < 0 || /^(?:[a-z0-9]|\.\d)/i.test(model.slice(i + key.length))) continue;
    if (!best || key.length > best.length) best = key;
  }
  return best ? pricing[best] : undefined;
}

/** Estimated USD, or undefined when the model has no price. */
export function costOf(pricing: Pricing, model: string, u: Usage): number | undefined {
  const r = ratesFor(pricing, model);
  if (!r) return undefined;
  const cw5m = u.cacheWrite - u.cacheWrite1h;
  return (u.input * r.input + u.output * r.output + cw5m * r.cacheWrite + u.cacheWrite1h * r.cacheWrite1h + u.cacheRead * r.cacheRead) / 1e6;
}
