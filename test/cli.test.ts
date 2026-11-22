import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, symlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';
import { A, B, C, CODEX_FIXTURES, duplicateIdDir, FIXTURES } from './helpers.js';

const CLI = fileURLToPath(new URL('../src/cli.js', import.meta.url));
// CODEX_HOME points at an empty folder: tests must never read a real ~/.codex on the machine running them.
const env = { ...process.env, CODEX_HOME: join(tmpdir(), 'tracelens-no-codex-home') };
const run = (...args: string[]) => spawnSync(process.execPath, [CLI, ...args], { encoding: 'utf8', env });

test('help and version', () => {
  assert.match(run('--help').stdout, /tracelens serve/);
  assert.match(run('--version').stdout, /^\d+\.\d+\.\d+/);
  const bad = run('frobnicate', '--dir', FIXTURES);
  assert.equal(bad.status, 1);
  assert.match(bad.stderr, /unknown command/);
});

test('list prints sessions newest first', () => {
  const r = run('list', '--dir', FIXTURES);
  assert.equal(r.status, 0);
  const lines = r.stdout.trim().split('\n');
  assert.ok(lines[0].startsWith(B));
  assert.ok(lines[1].startsWith(A));
});

test('export by id prefix to stdout, and by file path to a file', () => {
  const r = run('export', '1111', '--dir', FIXTURES, '--redact');
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /^# Add health check endpoint/);
  assert.ok(!r.stdout.includes('/Users/dev'));

  const out = mkdtempSync(join(tmpdir(), 'tracelens-'));
  try {
    const file = join(out, 't.html');
    const w = run('export', join(FIXTURES, '-Users-dev-acme-api', `${A}.jsonl`), '-o', file);
    assert.equal(w.status, 0, w.stderr);
    assert.match(readFileSync(file, 'utf8'), /^<!doctype html>/);
  } finally {
    rmSync(out, { recursive: true });
  }
});

test('export refuses to write into the log folder and leaves logs untouched', () => {
  const log = join(FIXTURES, '-Users-dev-acme-api', `${A}.jsonl`);
  const before = statSync(log).mtimeMs;
  const r = run('export', A, '--dir', FIXTURES, '-o', join(FIXTURES, 'out.md'));
  assert.equal(r.status, 1);
  assert.match(r.stderr, /refusing to write inside a log folder/);
  // a log opened by path, outside --dir, is protected too
  const self = run('export', log, '--dir', tmpdir(), '-o', log);
  assert.equal(self.status, 1);
  assert.match(self.stderr, /refusing to write/);
  // nor through a symlink that points at a log
  const tmp = mkdtempSync(join(tmpdir(), 'tracelens-'));
  try {
    symlinkSync(log, join(tmp, 'export.md'));
    const viaLink = run('export', A, '--dir', FIXTURES, '-o', join(tmp, 'export.md'));
    assert.equal(viaLink.status, 1);
    assert.match(viaLink.stderr, /refusing to write/);
  } finally {
    rmSync(tmp, { recursive: true });
  }
  assert.equal(statSync(log).mtimeMs, before);
});

test('export reports unknown sessions and bad formats', () => {
  assert.match(run('export', 'zzz', '--dir', FIXTURES).stderr, /No session matches "zzz"/);
  assert.match(run('export', '/no/such/file.jsonl', '--dir', FIXTURES).stderr, /file not found: \/no\/such\/file\.jsonl/);
  assert.match(run('export', A, '--dir', FIXTURES, '--format', 'pdf').stderr, /--format must be md or html/);
  assert.match(run('serve', '--dir', FIXTURES, '--port', 'abc').stderr, /--port must be a number/);
});

test('export refuses an id that is in two project folders and names both files', () => {
  const dir = duplicateIdDir();
  try {
    const r = run('export', A, '--dir', dir);
    assert.equal(r.status, 1);
    assert.match(r.stderr, /is in 2 project folders/);
    assert.ok(r.stderr.includes(join(dir, '-Users-dev-one', `${A}.jsonl`)) && r.stderr.includes(join(dir, '-Users-dev-two', `${A}.jsonl`)));
  } finally {
    rmSync(dir, { recursive: true });
  }
});

test('Codex sessions: listed with --codex-dir, exported by id or by rollout path, log folder protected', () => {
  const l = run('list', '--dir', FIXTURES, '--codex-dir', CODEX_FIXTURES);
  assert.equal(l.status, 0, l.stderr);
  assert.ok(l.stdout.includes(C) && l.stdout.includes(A));
  const byId = run('export', '3333', '--dir', FIXTURES, '--codex-dir', CODEX_FIXTURES);
  assert.equal(byId.status, 0, byId.stderr);
  assert.match(byId.stdout, /^# Invoice totals are off by a cent/);
  const rollout = join(CODEX_FIXTURES, '2026', '11', '19', `rollout-2026-11-19T09-00-00-${C}.jsonl`);
  const byPath = run('export', rollout, '--format', 'html');
  assert.equal(byPath.status, 0, byPath.stderr);
  assert.match(byPath.stdout, /<dt>Agent<\/dt><dd>Codex<\/dd>/);
  const before = statSync(rollout).mtimeMs;
  const w = run('export', C, '--dir', FIXTURES, '--codex-dir', CODEX_FIXTURES, '-o', join(CODEX_FIXTURES, '2026', 'out.md'));
  assert.equal(w.status, 1);
  assert.match(w.stderr, /refusing to write inside a log folder/);
  assert.equal(statSync(rollout).mtimeMs, before);
});

test('the output extension picks the format regardless of case (.HTML, .htm)', () => {
  const out = mkdtempSync(join(tmpdir(), 'tracelens-'));
  try {
    for (const name of ['T.HTML', 't.htm']) {
      const r = run('export', A, '--dir', FIXTURES, '-o', join(out, name));
      assert.equal(r.status, 0, r.stderr);
      assert.match(readFileSync(join(out, name), 'utf8'), /^<!doctype html>/, name);
    }
  } finally {
    rmSync(out, { recursive: true });
  }
});

test('export refuses a .JSONL output path too (the same file as the log on case-insensitive disks)', () => {
  const tmp = mkdtempSync(join(tmpdir(), 'tracelens-'));
  try {
    const log = join(tmp, `${A}.jsonl`);
    copyFileSync(join(FIXTURES, '-Users-dev-acme-api', `${A}.jsonl`), log);
    const before = readFileSync(log, 'utf8');
    const r = run('export', log, '--dir', join(tmp, 'none'), '-o', log.replace(/jsonl$/, 'JSONL'));
    assert.equal(r.status, 1);
    assert.match(r.stderr, /refusing to write/);
    assert.equal(readFileSync(log, 'utf8'), before);
  } finally {
    rmSync(tmp, { recursive: true });
  }
});

test('export refuses the log folder spelled in other letter case (case-insensitive disks)', () => {
  const tmp = mkdtempSync(join(tmpdir(), 'tracelens-'));
  try {
    const logs = join(tmp, 'logs');
    mkdirSync(join(logs, 'p'), { recursive: true });
    copyFileSync(join(FIXTURES, '-Users-dev-acme-api', `${A}.jsonl`), join(logs, 'p', `${A}.jsonl`));
    const shouted = join(tmp, 'LOGS');
    if (!existsSync(shouted)) return; // case-sensitive disk: LOGS is another folder
    const r = run('export', A, '--dir', logs, '-o', join(shouted, 'p', 'out.md'));
    assert.equal(r.status, 1);
    assert.match(r.stderr, /refusing to write inside a log folder/);
    assert.ok(!existsSync(join(logs, 'p', 'out.md')));
  } finally {
    rmSync(tmp, { recursive: true });
  }
});
