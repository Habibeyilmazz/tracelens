// Small display helpers shared by the web UI and the exporters.

const ENT: Record<string, string> = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
export const esc = (v: unknown) => String(v).replace(/[&<>"']/g, (c) => ENT[c]);

const pad = (n: number) => String(n).padStart(2, '0');

export function fmtDate(ts: number): string {
  if (!ts) return '—';
  const d = new Date(ts);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export function fmtDuration(ms: number | undefined): string {
  if (ms === undefined || !Number.isFinite(ms) || ms < 0) return '—';
  if (ms < 1000) return `${Math.round(ms)}ms`;
  const s = ms / 1000;
  if (s < 60) return `${s.toFixed(s < 10 ? 1 : 0)}s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ${pad(Math.floor(s % 60))}s`;
  return `${Math.floor(m / 60)}h ${pad(m % 60)}m`;
}

/** Position in the session as m:ss or h:mm:ss. */
export function fmtOffset(ms: number): string {
  const t = Math.max(0, Math.floor(ms / 1000));
  const h = Math.floor(t / 3600);
  const m = Math.floor((t % 3600) / 60);
  return h ? `${h}:${pad(m)}:${pad(t % 60)}` : `${m}:${pad(t % 60)}`;
}

export function fmtTokens(n: number): string {
  if (n < 1000) return String(n);
  if (n < 1e6) return `${(n / 1e3).toFixed(n < 1e4 ? 1 : 0)}k`;
  if (n < 1e9) return `${(n / 1e6).toFixed(n < 1e7 ? 2 : 1)}M`;
  return `${(n / 1e9).toFixed(2)}B`;
}

export function fmtUSD(n: number): string {
  if (n === 0) return '$0';
  if (n < 0.01) return '<$0.01';
  return `$${n.toFixed(n < 100 ? 2 : 0)}`;
}

export const oneLine = (s: string, max = 120) => {
  const t = s.replace(/\s+/g, ' ').trim();
  return t.length > max ? `${t.slice(0, max - 1)}…` : t;
};

export const shortModel = (m: string) => m.replace(/^claude-/, '').replace(/-\d{8}$/, '');
export const shortPath = (p: string) => p.split(/[\\/]/).filter(Boolean).slice(-2).join('/') || p;

/** The one argument that best describes a tool call (command, path, pattern, …). */
export function toolLabel(input: unknown): string {
  if (typeof input === 'string') return oneLine(input);
  const i = (input ?? {}) as Record<string, unknown>;
  for (const k of ['command', 'file_path', 'notebook_path', 'pattern', 'url', 'query', 'description', 'prompt', 'path'])
    if (typeof i[k] === 'string' && i[k]) return oneLine(i[k] as string);
  const first = Object.values(i).find((v) => typeof v === 'string' && v);
  return typeof first === 'string' ? oneLine(first) : '';
}

export const pretty = (v: unknown) => (typeof v === 'string' ? v : JSON.stringify(v, null, 2) ?? '');
