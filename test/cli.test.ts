import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, statSync, symlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';
import { A, B, duplicateIdDir, FIXTURES } from './helpers.js';

const CLI = fileURLToPath(new URL('../src/cli.js', import.meta.url));
const run = (...args: string[]) => spawnSync(process.execPath, [CLI, ...args], { encoding: 'utf8' });

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
  assert.match(r.stderr, /refusing to write inside the log folder/);
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
