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

/** The first n UTF-16 units of s, without a dangling half of a surrogate pair (an emoji cut in two shows as �). */
export const cut = (s: string, n: number) => {
  const t = s.slice(0, n);
  return /[\uD800-\uDBFF]$/.test(t) ? t.slice(0, -1) : t;
};

export const oneLine = (s: string, max = 120) => {
  const t = s.replace(/\s+/g, ' ').trim();
  return t.length > max ? `${cut(t, max - 1)}…` : t;
};

export const shortModel = (m: string) => m.replace(/^claude-/, '').replace(/-\d{8}$/, '');
export const agentName = (source: string) => (source === 'codex' ? 'Codex' : 'Claude Code');
export const shortPath = (p: string) => p.split(/[\\/]/).filter(Boolean).slice(-2).join('/') || p;

/** Files named in a Codex apply_patch envelope, with what happens to each ("Move" names a renamed file's new path). */
export const patchFiles = (patch: string) =>
  [...patch.matchAll(/^\*\*\* (?:(Add|Update|Delete) File|(Move) to): (.+)$/gm)].map((m) => ({ op: m[1] ?? m[2], path: m[3].trim() }));

const label = (s: string) =>
  oneLine(s.startsWith('*** Begin Patch') ? patchFiles(s).map((f) => `${f.op === 'Move' ? 'to' : f.op} ${f.path}`).join(', ') || s : s);

/** The one argument that best describes a tool call (command, path, pattern, …). */
export function toolLabel(input: unknown): string {
  if (typeof input === 'string') return label(input);
  const i = (input ?? {}) as Record<string, unknown>;
  // Codex shell calls pass argv, usually ["bash", "-lc", "<script>"].
  const argv = i.command;
  if (Array.isArray(argv) && argv.length && argv.every((a) => typeof a === 'string'))
    return label(argv.length === 3 && /^-l?c$/.test(argv[1]) ? argv[2] : argv.join(' '));
  for (const k of ['command', 'cmd', 'file_path', 'notebook_path', 'pattern', 'url', 'query', 'description', 'prompt', 'path'])
    if (typeof i[k] === 'string' && i[k]) return label(i[k] as string);
  const first = Object.values(i).find((v) => typeof v === 'string' && v);
  return typeof first === 'string' ? label(first) : '';
}

export const pretty = (v: unknown) => (typeof v === 'string' ? v : JSON.stringify(v, null, 2) ?? '');
