import { createHash, randomUUID } from 'node:crypto';
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import { computeInsights, CSV_TABLES, insightsCsv, sessionStats, type CsvTable, type SessionStats } from './insights.js';
import { exportMarkdown } from './markdown.js';
import type { Pricing } from './pricing.js';
import { redactSession } from './redact.js';
import { APP_JS, esc, exportHtml, insightsPage, page, searchPage, sessionPage, sessionsPage } from './render.js';
import { cut } from './format.js';
import { search } from './search.js';
import { folderOf, type Store } from './store.js';
import { totalTokens, type Session } from './types.js';

const SECURITY_HEADERS = {
  'Content-Security-Policy': "default-src 'none'; style-src 'unsafe-inline'; script-src 'self'; connect-src 'self'; img-src 'self' data:; form-action 'self'; base-uri 'none'; frame-ancestors 'none'",
  'X-Content-Type-Options': 'nosniff',
  'Referrer-Policy': 'no-referrer',
  'Cross-Origin-Opener-Policy': 'same-origin',
  'Cross-Origin-Resource-Policy': 'same-origin',
  'Cache-Control': 'no-store',
};

export function createHandler(store: Store, pricing: Pricing) {
  const statsCache = new WeakMap<Session, SessionStats>();
  const salt = randomUUID(); // a restart (maybe with another pricing file) must not answer an old ETag with 304
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
      // Fetch Metadata: other sites (other ports on 127.0.0.1 count as same-site) may link here, but may not load
      // pages as images, scripts, frames or fetches, which would let them time searches over the transcripts.
      const site = req.headers['sec-fetch-site'];
      if (site && site !== 'same-origin' && site !== 'none' && !(req.headers['sec-fetch-mode'] === 'navigate' && req.headers['sec-fetch-dest'] === 'document'))
        return send(403, 'Cross-site request refused', 'text/plain');

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
        return send(200, sessionsPage(rows, projects, { project, sort, dir: store.dir, codexDir: store.codexDir }));
      }

      if (path === '/search') {
        const q = cut(p.get('q') ?? '', 500);
        const project = p.get('project') || undefined;
        return send(200, searchPage(q, search(sessions.filter((s) => !project || s.project === project), q), projects, project));
      }

      if (path === '/insights' || path === '/insights.csv') {
        const days = Number(p.get('days'));
        const project = p.get('project') || undefined;
        const opts = { days: Number.isInteger(days) && days > 0 ? days : undefined, project };
        if (path === '/insights') return send(200, insightsPage(computeInsights(sessions, pricing, opts), projects, opts));
        const table = p.get('table') as CsvTable;
        if (!CSV_TABLES.includes(table)) return send(400, `table must be one of: ${CSV_TABLES.join(', ')}`, 'text/plain');
        return send(200, insightsCsv(computeInsights(sessions, pricing, opts), table), 'text/csv; charset=utf-8', {
          'Content-Disposition': `attachment; filename="tracelens-${table}${opts.days ? `-${opts.days}d` : ''}.csv"`,
        });
      }

      // /session/<project folder>/<id>: ids alone can repeat across project folders.
      const m = /^\/session\/([^/]+)\/([^/]+)(\/export)?$/.exec(path);
      if (m) {
        let folder: string, id: string;
        try {
          [folder, id] = [decodeURIComponent(m[1]), decodeURIComponent(m[2])];
        } catch {
          return send(400, 'Bad session id', 'text/plain');
        }
        const s = sessions.find((x) => x.id === id && folderOf(x) === folder);
        if (!s) return send(404, page('Not found', `<h1>Session not found</h1><p class="empty">No session with id <code>${esc(id)}</code> in <code>${esc(folder)}</code>. It may have been deleted. <a href="/">Back to sessions</a></p>`, 'session'));
        if (!m[3]) {
          // The live view polls with If-None-Match: a 304 costs a stat of the session's files, not a render.
          const etag = `"${createHash('sha1').update(salt + store.signatureOf(s)).digest('base64url')}"`;
          if (req.headers['if-none-match'] === etag) return send(304, '', undefined, { ETag: etag });
          return send(200, sessionPage(s, stats(s), etag), undefined, { ETag: etag });
        }
        const format = p.get('format') === 'html' ? 'html' : 'md';
        const out = p.get('redact') === '1' ? redactSession(s) : s;
        const name = `tracelens-${s.id.replace(/[^A-Za-z0-9_-]/g, '').slice(0, 12)}.${format}`;
        const body = format === 'html' ? exportHtml(out, stats(s)) : exportMarkdown(out, stats(s));
        return send(200, body, format === 'html' ? 'text/html; charset=utf-8' : 'text/markdown; charset=utf-8', {
          'Content-Disposition': `attachment; filename="${name}"`,
        });
      }

      return send(404, page('Not found', `<h1>Page not found</h1><p class="empty">There is no tracelens page at this address. <a href="/">Back to sessions</a></p>`, 'sessions'));
    } catch (err) {
      console.error(err);
      if (!res.headersSent)
        send(500, page('Error', `<h1>This page could not be shown</h1><p class="empty">tracelens hit an error: <code>${esc((err as Error).message)}</code>. The details are in the terminal running <code>tracelens serve</code>.</p>`, 'sessions'));
      else res.end();
    }
  };
}

export function listen(store: Store, pricing: Pricing, port: number): Promise<Server> {
  const server = createServer(createHandler(store, pricing));
  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, '127.0.0.1', () => resolve(server));
  });
}
