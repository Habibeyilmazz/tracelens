import { homedir } from 'node:os';
import type { Session } from './types.js';

const R = '[REDACTED]';

// Common credential shapes. Over-redacting is acceptable here; leaking is not.
const SECRETS: [RegExp, string][] = [
  [/-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?(-----END [A-Z ]*PRIVATE KEY-----|$)/g, '[REDACTED PRIVATE KEY]'],
  [/\bsk-ant-[A-Za-z0-9_-]{10,}/g, R],
  [/\bsk-(?:proj-)?[A-Za-z0-9_-]{20,}/g, R],
  [/\b(?:ghp|gho|ghu|ghs|ghr)_[A-Za-z0-9]{20,}/g, R],
  [/\bgithub_pat_[A-Za-z0-9_]{20,}/g, R],
  [/\bxox[abprs]-[A-Za-z0-9-]{10,}/g, R],
  [/\b(?:AKIA|ASIA)[0-9A-Z]{16}\b/g, R],
  [/\bAIza[0-9A-Za-z_-]{35}\b/g, R],
  [/\bnpm_[A-Za-z0-9]{36}\b/g, R],
  [/\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}/g, R],
  [/\b(Bearer|Basic)\s+[A-Za-z0-9._~+/=-]{16,}/gi, `$1 ${R}`],
  [/(\b[A-Za-z0-9_]*(?:api[_-]?key|secret|token|passw(?:or)?d)[A-Za-z0-9_]*["']?\s*[:=]\s*["']?)(?=[^\s"',;}]*[A-Za-z])[^\s"',;}]{6,}/gi, `$1${R}`],
  [/\b([a-z][a-z0-9+.-]*:\/\/)[^\s:/@]+:[^\s@/]+@/gi, `$1${R}@`],
  [/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g, '[email]'],
];

export function redactSecrets(s: string): string {
  return SECRETS.reduce((acc, [re, rep]) => acc.replace(re, rep), s);
}

/** Replaces the project directory with <project> and home directories with ~ (removes user names). */
export function redactPaths(s: string, project?: string, home = homedir()): string {
  if (project && project.length > 1) s = s.split(project).join('<project>');
  if (home.length > 1) s = s.split(home).join('~');
  return s.replace(/\/(?:Users|home)\/[^/\s"'`<>]+/g, '~').replace(/\b[A-Za-z]:\\(?:Users|Documents and Settings)\\[^\\\s"'`<>]+/gi, '~');
}

export function redact(s: string, project?: string): string {
  return redactSecrets(redactPaths(s, project));
}

/** A deep copy of the session with every string redacted. */
export function redactSession(s: Session): Session {
  const project = s.project;
  return JSON.parse(JSON.stringify(s), (_k, v) => (typeof v === 'string' ? redact(v, project) : v));
}
