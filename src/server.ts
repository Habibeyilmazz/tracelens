import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import { computeInsights, sessionStats, type SessionStats } from './insights.js';
import { exportMarkdown } from './markdown.js';
import type { Pricing } from './pricing.js';
import { redactSession } from './redact.js';
import { APP_JS, esc, exportHtml, insightsPage, page, searchPage, sessionPage, sessionsPage } from './render.js';
import { search } from './search.js';
import type { Store } from './store.js';
import { totalTokens, type Session } from './types.js';

const SECURITY_HEADERS = {
  'Content-Security-Policy': "default-src 'none'; style-src 'unsafe-inline'; script-src 'self'; img-src 'self' data:; form-action 'self'; base-uri 'none'; frame-ancestors 'none'",
  'X-Content-Type-Options': 'nosniff',
  'Referrer-Policy': 'no-referrer',
  'Cache-Control': 'no-store',
};

export function createHandler(store: Store, pricing: Pricing) {
  const statsCache = new WeakMap<Session, SessionStats>();
  const stats = (s: Session) => {
    let st = statsCache.get(s);
    if (!st) statsCache.set(s, (st = sessionStats(s, pricing)));
    return st;
  };

  return (req: IncomingMessage, res: ServerResponse) => {
    const send = (status: number, body: string, type = 'text/html; charset=utf-8', extra: Record<string, string> = {}) => {
      res.writeHead(status, { 'Content-Type': type, ...SECURITY_HEADERS, ...extra });
      res.end(req.method === 'HEAD' ? undefined : body);
    };
    try {
      // Only answer to our own loopback name: blocks DNS-rebinding pages from reading transcripts.
      const port = req.socket.localPort;
      if (!['127.0.0.1', 'localhost', '[::1]'].some((h) => req.headers.host === `${h}:${port}`)) return send(403, 'Forbidden host', 'text/plain');
      if (req.method !== 'GET' && req.method !== 'HEAD') return send(405, 'Method not allowed', 'text/plain', { Allow: 'GET, HEAD' });

      const url = new URL(req.url ?? '/', 'http://localhost');
      const p = url.searchParams;
      const path = url.pathname;

      if (path === '/app.js') return send(200, APP_JS, 'text/javascript; charset=utf-8');

      const sessions = store.sessions();
      const projects = [...new Set(sessions.map((s) => s.project))].sort();

      if (path === '/') {
        const project = p.get('project') || undefined;
        const sort = ['date', 'duration', 'tokens', 'cost'].includes(p.get('sort') ?? '') ? p.get('sort')! : 'date';
        const key: Record<string, (s: Session) => number> = {
          date: (s) => s.start,
          duration: (s) => s.end - s.start,
          tokens: (s) => totalTokens(stats(s).usage),
          cost: (s) => stats(s).cost,
        };
        const rows = sessions
          .filter((s) => !project || s.project === project)
          .sort((a, b) => key[sort](b) - key[sort](a))
          .map((s) => ({ s, st: stats(s) }));
        return send(200, sessionsPage(rows, projects, { project, sort, dir: store.dir }));
      }

      if (path === '/search') {
        const q = (p.get('q') ?? '').slice(0, 500);
        return send(200, searchPage(q, search(sessions, q).slice(0, 100)));
      }

      if (path === '/insights') {
        const days = Number(p.get('days'));
        const project = p.get('project') || undefined;
        const opts = { days: Number.isInteger(days) && days > 0 ? days : undefined, project };
        return send(200, insightsPage(computeInsights(sessions, pricing, opts), projects, opts));
      }

      const m = /^\/session\/([^/]+)(\/export)?$/.exec(path);
      if (m) {
        const id = decodeURIComponent(m[1]);
        const s = sessions.find((x) => x.id === id);
        if (!s) return send(404, page('Not found', `<h1>Session not found</h1><p>No session with id <code>${esc(id)}</code>. It may have been deleted. <a href="/">Back to sessions</a></p>`, 'session'));
        if (!m[2]) return send(200, sessionPage(s, stats(s)));
        const format = p.get('format') === 'html' ? 'html' : 'md';
        const out = p.get('redact') === '1' ? redactSession(s) : s;
        const name = `tracelens-${s.id.replace(/[^A-Za-z0-9_-]/g, '').slice(0, 12)}.${format}`;
        const body = format === 'html' ? exportHtml(out, stats(s)) : exportMarkdown(out, stats(s));
        return send(200, body, format === 'html' ? 'text/html; charset=utf-8' : 'text/markdown; charset=utf-8', {
          'Content-Disposition': `attachment; filename="${name}"`,
        });
      }

      return send(404, page('Not found', `<h1>Page not found</h1><p><a href="/">Back to sessions</a></p>`, 'sessions'));
    } catch (err) {
      console.error(err);
      if (!res.headersSent) send(500, `Internal error: ${(err as Error).message}`, 'text/plain; charset=utf-8');
      else res.end();
    }
  };
}

export function listen(store: Store, pricing: Pricing, port: number, host = '127.0.0.1'): Promise<Server> {
  const server = createServer(createHandler(store, pricing));
  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, host, () => resolve(server));
  });
}
