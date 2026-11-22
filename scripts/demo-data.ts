// Writes a synthetic Claude Code projects folder for demos and screenshots.
// Usage: node dist/scripts/demo-data.js <out-dir>   (everything in it is made up)

import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const out = process.argv[2];
if (!out) throw new Error('usage: demo-data <out-dir>');

let seed = 7;
const rand = () => ((seed = (seed * 1103515245 + 12345) % 2 ** 31) / 2 ** 31);
const pick = <T>(xs: T[]) => xs[Math.floor(rand() * xs.length)];
const int = (a: number, b: number) => a + Math.floor(rand() * (b - a + 1));
const uuid = () => 'xxxxxxxx-xxxx-4xxx-8xxx-xxxxxxxxxxxx'.replace(/x/g, () => int(0, 15).toString(16));

const PROJECTS: Record<string, { files: string[]; prompts: string[]; test: string }> = {
  '/Users/demo/code/payments-api': {
    files: ['src/routes/refunds.ts', 'src/routes/charges.ts', 'src/db/migrations/0042_refund_reason.sql', 'src/lib/money.ts', 'test/refunds.test.ts'],
    prompts: [
      'Add a reason field to refunds and expose it in the API',
      'The refunds endpoint returns 500 when the amount has more than two decimals, fix it',
      'Write tests for partial refunds',
      'Explain how idempotency keys are stored',
    ],
    test: 'npm test',
  },
  '/Users/demo/code/web-dashboard': {
    files: ['src/components/RevenueChart.tsx', 'src/hooks/useMetrics.ts', 'src/pages/Overview.tsx', 'src/styles/tokens.css'],
    prompts: ['Make the revenue chart readable in dark mode', 'The overview page re-renders on every keystroke, find out why', 'Add an empty state to the metrics table'],
    test: 'npm run test -- --run',
  },
  '/Users/demo/code/infra-scripts': {
    files: ['deploy.sh', 'terraform/main.tf', 'scripts/rotate-logs.py'],
    prompts: ['Make deploy.sh fail fast and print which step failed', 'Rotate logs older than 14 days instead of 30'],
    test: 'bash -n deploy.sh && python -m pytest scripts',
  },
  '/Users/demo/code/docs-site': {
    files: ['docs/getting-started.md', 'docs/api/refunds.md', 'astro.config.mjs'],
    prompts: ['Document the new refund reason field', 'Fix the broken links reported by the link checker'],
    test: 'npm run check-links',
  },
};
const MODELS = ['claude-sonnet-4-5-20250929', 'claude-sonnet-4-5-20250929', 'claude-opus-4-5-20251101', 'claude-opus-4-1-20250805'];
const SUB_MODEL = 'claude-haiku-4-5-20251001';

const day0 = new Date();
day0.setHours(9, 0, 0, 0);
day0.setDate(day0.getDate() - 14);

function session(cwd: string, prompt: string, start: number) {
  const id = uuid();
  const p = PROJECTS[cwd];
  const model = pick(MODELS);
  const lines: object[] = [];
  let t = start;
  let parent: string | null = null;
  let sideParent: string | null = null; // subagent records form their own parentUuid chain
  const base = (side = false) => {
    const u = uuid();
    const rec = { parentUuid: side ? sideParent : parent, isSidechain: side, userType: 'external', cwd, sessionId: id, version: '2.0.0', gitBranch: 'main', uuid: u, timestamp: new Date(t).toISOString() };
    if (side) sideParent = u;
    else parent = u;
    return rec;
  };
  let ctx = int(8000, 20000);
  const assistant = (content: object[], m = model, side = false) => {
    ctx += int(300, 3000);
    const usage = { input_tokens: int(3, 40), output_tokens: int(60, 900), cache_creation_input_tokens: int(0, 3) ? int(200, 2500) : 0, cache_read_input_tokens: ctx };
    lines.push({ ...base(side), type: 'assistant', requestId: `req_${uuid()}`, message: { id: `msg_${uuid()}`, type: 'message', role: 'assistant', model: m, content, stop_reason: null, usage } });
  };
  const user = (content: unknown, side = false) => lines.push({ ...base(side), type: 'user', message: { role: 'user', content } });
  const tool = (name: string, input: object, output: string, ms: number, isError = false, side = false, m = model) => {
    const tid = `toolu_${uuid().slice(0, 12)}`;
    assistant([{ type: 'tool_use', id: tid, name, input }], m, side);
    t += ms;
    user([{ tool_use_id: tid, type: 'tool_result', content: output, ...(isError ? { is_error: true } : {}) }], side);
    t += int(3000, 20000);
  };

  user(prompt);
  t += int(2000, 5000);
  assistant([{ type: 'thinking', thinking: `The user wants: ${prompt.toLowerCase()}. Start by reading the relevant code.`, signature: 'demo' }]);
  assistant([{ type: 'text', text: "I'll look at the relevant files first." }]);
  const files = p.files;
  tool('Grep', { pattern: prompt.split(' ').slice(-1)[0].replace(/\W/g, '') || 'TODO', path: cwd }, files.slice(0, 3).map((f) => `${cwd}/${f}`).join('\n'), int(300, 1200));
  for (let i = 0, n = int(1, 3); i < n; i++) tool('Read', { file_path: `${cwd}/${pick(files)}` }, `     1\timport { config } from './config';\n     2\t\n     3\texport function handler(req, res) {\n     4\t  // ...\n     5\t}`, int(80, 400));
  if (rand() < 0.45) {
    const task = 'Find every place that reads this value and list the files with line numbers.';
    const tid = 'toolu_task_' + uuid().slice(0, 8);
    assistant([{ type: 'tool_use', id: tid, name: 'Task', input: { description: 'Find usages', prompt: task, subagent_type: 'Explore' } }]);
    const taskStart = t;
    t += 800;
    user(task, true);
    t += 1500;
    tool('Grep', { pattern: 'config\\.', path: cwd, output_mode: 'content' }, `${files[0]}:12: config.timeoutMs\n${files[1] ?? files[0]}:40: config.retries`, int(200, 900), false, true, SUB_MODEL);
    tool('Read', { file_path: `${cwd}/${files[0]}` }, '    12\tconst timeout = config.timeoutMs ?? 5000;', int(60, 200), false, true, SUB_MODEL);
    assistant([{ type: 'text', text: `Two readers: ${files[0]}:12 and ${files[1] ?? files[0]}:40.` }], SUB_MODEL, true);
    t += 1200;
    user([{ tool_use_id: tid, type: 'tool_result', content: [{ type: 'text', text: `Two readers: ${files[0]}:12 and ${files[1] ?? files[0]}:40.` }] }]);
    void taskStart;
  }
  for (let i = 0, n = int(1, 4); i < n; i++) {
    const f = pick(files);
    tool(pick(['Edit', 'Edit', 'Write', 'MultiEdit']), { file_path: `${cwd}/${f}`, old_string: 'timeout = 5000', new_string: 'timeout = config.timeoutMs' }, `The file ${cwd}/${f} has been updated.`, int(40, 300));
  }
  const fails = rand() < 0.4;
  tool('Bash', { command: p.test, description: 'Run the checks' }, fails ? `FAIL test/${pick(files).split('/').pop()}\n  expected 200, received 500\n\nTests: 1 failed, 23 passed` : 'Tests: 24 passed\nTime: 6.1s', int(4000, 48000), fails);
  if (fails) {
    assistant([{ type: 'text', text: 'One check fails. The handler rounds before validating; fixing the order.' }]);
    tool('Edit', { file_path: `${cwd}/${files[0]}`, old_string: 'round(amount)', new_string: 'validate(amount)' }, 'The file has been updated.', int(40, 200));
    tool('Bash', { command: p.test, description: 'Run the checks again' }, 'Tests: 24 passed\nTime: 6.3s', int(4000, 30000));
  }
  if (rand() < 0.2) tool('WebFetch', { url: 'https://example.com/docs/changelog', prompt: 'What changed in the latest release?' }, 'Request failed with status 503', int(2000, 9000), true);
  const changed = [...new Set(files.slice(0, 2))].map((f) => `- \`${f}\`: reads \`config.timeoutMs\` instead of a hard-coded **5000**`).join('\n');
  assistant([{ type: 'text', text: `Done. ${prompt.replace(/\.$/, '')}.\n\n## Changes\n${changed}\n\n## Checks\n\`\`\`\n$ ${p.test}\nTests: 24 passed\n\`\`\`\n\nThe old value stays as the *fallback*, so nothing changes for callers that do not set it.` }]);
  lines.push({ type: 'summary', summary: prompt, leafUuid: parent });
  return { id, lines };
}

let n = 0;
for (let d = 0; d < 14; d++) {
  for (let k = 0, perDay = d % 6 === 5 ? 0 : int(1, 3); k < perDay; k++) {
    const cwd = pick(Object.keys(PROJECTS));
    const s = session(cwd, pick(PROJECTS[cwd].prompts), day0.getTime() + d * 86_400_000 + k * 7_200_000 + int(0, 3_000_000));
    const dir = join(out, cwd.replace(/[/.]/g, '-'));
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, `${s.id}.jsonl`), s.lines.map((l) => JSON.stringify(l)).join('\n') + '\n');
    n++;
  }
}
console.log(`wrote ${n} synthetic sessions to ${out}`);
