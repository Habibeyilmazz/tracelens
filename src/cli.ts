#!/usr/bin/env node
import { spawn } from 'node:child_process';
import { existsSync, readFileSync, realpathSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { basename, dirname, join, relative, resolve, isAbsolute, sep } from 'node:path';
import { parseArgs } from 'node:util';
import { filesForPath, parseSession } from './claude.js';
import { codexArchive, isRollout, parseCodex } from './codex.js';
import { fmtDate, fmtDuration, fmtUSD, oneLine, shortPath } from './format.js';
import { sessionStats } from './insights.js';
import { exportMarkdown } from './markdown.js';
import { loadPricing } from './pricing.js';
import { redactSession } from './redact.js';
import { exportHtml } from './render.js';
import { listen } from './server.js';
import { findSession, Store } from './store.js';

const VERSION = JSON.parse(readFileSync(new URL('../../package.json', import.meta.url), 'utf8')).version as string;

const HELP = `tracelens ${VERSION}: local viewer and analytics for Claude Code and Codex CLI session logs

Usage:
  tracelens serve [--port 4180] [--no-open]   Open the web UI on 127.0.0.1
  tracelens list [--limit 20]                 Print recent sessions and their ids
  tracelens export <session> [options]        Write a transcript as Markdown or HTML

Export options:
  <session>             A session id, a unique id prefix, or a path to a .jsonl file
                        (a Claude Code transcript or a Codex rollout-*.jsonl)
  -f, --format md|html  Output format (default: from --output extension, else md)
  -o, --output <file>   Write to a file instead of stdout
  --redact              Replace home/project paths, emails and common secret patterns

Common options:
  --dir <path>          Claude Code projects folder (default: ~/.claude/projects,
                        or $CLAUDE_CONFIG_DIR/projects)
  --codex-dir <path>    Codex CLI sessions folder (default: ~/.codex/sessions,
                        or $CODEX_HOME/sessions); archived_sessions next to a
                        folder named "sessions" is read too
  --pricing <file>      Pricing table for cost estimates (default: bundled pricing.json)
  -h, --help            Show this help
  -v, --version         Show the version

tracelens only reads log files. Nothing leaves your machine.`;

const defaultDir = () => join(process.env.CLAUDE_CONFIG_DIR || join(homedir(), '.claude'), 'projects');
const defaultCodexDir = () => join(process.env.CODEX_HOME || join(homedir(), '.codex'), 'sessions');

async function main(argv: string[]) {
  const { values: o, positionals } = parseArgs({
    args: argv,
    allowPositionals: true,
    options: {
      dir: { type: 'string' },
      'codex-dir': { type: 'string' },
      pricing: { type: 'string' },
      port: { type: 'string', default: '4180' },
      'no-open': { type: 'boolean', default: false },
      limit: { type: 'string', default: '20' },
      format: { type: 'string', short: 'f' },
      output: { type: 'string', short: 'o' },
      redact: { type: 'boolean', default: false },
      help: { type: 'boolean', short: 'h', default: false },
      version: { type: 'boolean', short: 'v', default: false },
    },
  });
  const [cmd, ...rest] = positionals;
  if (o.version) return console.log(VERSION);
  if (o.help || !cmd || cmd === 'help') return console.log(HELP);

  const dir = resolve(o.dir ?? defaultDir());
  const pricing = loadPricing(o.pricing);
  const codexDir = resolve(o['codex-dir'] ?? defaultCodexDir());
  const store = new Store(dir, codexDir);

  if (cmd === 'serve') {
    const port = Number(o.port);
    if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error(`--port must be a number from 1 to 65535, got "${o.port}"`);
    if (!existsSync(dir) && !existsSync(codexDir)) console.warn(`tracelens: neither ${dir} nor ${codexDir} exists yet; the session list will be empty.`);
    const server = await listen(store, pricing, port).catch((err) => {
      throw err.code === 'EADDRINUSE' ? new Error(`port ${port} is in use; pick another with --port`) : err;
    });
    const url = `http://127.0.0.1:${port}/`;
    console.log(`tracelens: reading ${dir} and ${codexDir}\ntracelens: open ${url} (Ctrl+C to stop)`);
    if (!o['no-open']) openBrowser(url);
    const stop = () => server.close(() => process.exit(0));
    process.on('SIGINT', stop);
    process.on('SIGTERM', stop);
    return;
  }

  if (cmd === 'list') {
    const limit = Math.max(1, Number(o.limit) || 20);
    const sessions = store.sessions().slice(0, limit);
    if (!sessions.length) return console.log(`No sessions found in ${dir} or ${codexDir}`);
    for (const s of sessions) {
      const st = sessionStats(s, pricing);
      const line = `${s.id}  ${fmtDate(s.start)}  ${fmtDuration(s.end - s.start).padStart(7)}  ${fmtUSD(st.cost).padStart(7)}  ${shortPath(s.project)}  ${oneLine(s.title, 60)}`;
      // Titles and paths come from the logs: control characters could drive the terminal (escape sequences).
      console.log(line.replace(/[\u0000-\u001f\u007f-\u009f]/g, ''));
    }
    return;
  }

  if (cmd === 'export') {
    const target = rest[0];
    if (!target) throw new Error('export needs a session id or a .jsonl path. Run "tracelens list" to see ids.');
    const format = o.format ?? (/\.html?$/i.test(o.output ?? '') ? 'html' : 'md');
    if (format !== 'md' && format !== 'html') throw new Error(`--format must be md or html, got "${format}"`);
    if (target.endsWith('.jsonl') && !existsSync(target)) throw new Error(`file not found: ${target}`);
    const byPath = (p: string) => (isRollout(p) ? parseCodex({ id: '', main: p, subagents: [] }) : parseSession(filesForPath(p)));
    const session = target.endsWith('.jsonl') ? byPath(resolve(target)) : findSession(store.sessions(), target);
    const st = sessionStats(session, pricing);
    const shown = o.redact ? redactSession(session) : session;
    const text = format === 'html' ? exportHtml(shown, st) : exportMarkdown(shown, st);
    if (!o.output) return void process.stdout.write(text);
    // Read-only guarantee: never write into the log folder or over a log. Compare real paths, so a
    // symlink (to a log, or to a folder inside the log folder) cannot get around the check. The native
    // realpath also returns the on-disk letter case, so ~/.CLAUDE cannot get around it on macOS or Windows.
    const real = (p: string): string => (existsSync(p) ? realpathSync.native(p) : join(real(dirname(p)), basename(p)));
    const out = real(resolve(o.output));
    const inside = (folder: string) => {
      const rel = relative(real(folder), out);
      // '..report.md' is a file inside the folder; only '..' itself or '../…' leaves it.
      return rel && rel !== '..' && !rel.startsWith(`..${sep}`) && !isAbsolute(rel);
    };
    // A .jsonl target may live outside the log folders, so also refuse any .jsonl output (it could be that log or a subagent's).
    const logDirs = [dir, codexDir, codexArchive(codexDir)].filter((d): d is string => !!d);
    if (/\.jsonl$/i.test(out) || logDirs.some(inside))
      throw new Error(`refusing to write inside a log folder (${logDirs.join(', ')}) or to a .jsonl file; choose another --output path`);
    writeFileSync(out, text);
    console.error(`tracelens: wrote ${out}`);
    return;
  }

  throw new Error(`unknown command "${cmd}". Run "tracelens --help".`);
}

function openBrowser(url: string) {
  const [cmd, args] =
    process.platform === 'darwin' ? ['open', [url]] : process.platform === 'win32' ? ['cmd', ['/c', 'start', '', url]] : ['xdg-open', [url]];
  spawn(cmd, args as string[], { stdio: 'ignore', detached: true })
    .on('error', () => {})
    .unref();
}

main(process.argv.slice(2)).catch((err) => {
  console.error(`tracelens: ${err.message}`);
  process.exit(1);
});
