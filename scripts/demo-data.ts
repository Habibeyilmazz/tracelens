// Writes a synthetic Claude Code projects folder (and optionally a Codex sessions folder) for demos and screenshots.
// Usage: node dist/scripts/demo-data.js <out-dir> [<codex-out-dir>]   (everything in them is made up)

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

// ---------------------------------------------------------------- Codex CLI rollouts (optional second folder)

const codexOut = process.argv[3];
const CODEX_MODELS = ['gpt-5.1-codex', 'gpt-5.3-codex', 'gpt-5.4'];

function codexSession(cwd: string, prompt: string, start: number) {
  const id = uuid();
  const p = PROJECTS[cwd];
  const model = pick(CODEX_MODELS);
  const lines: object[] = [];
  let t = start;
  const rec = (type: string, payload: object) => lines.push({ timestamp: new Date(t).toISOString(), type, payload });
  const item = (payload: object) => rec('response_item', payload);
  let total = { input_tokens: 0, cached_input_tokens: 0, output_tokens: 0 };
  const usage = () => {
    const input = int(6000, 16000);
    const last = { input_tokens: input, cached_input_tokens: Math.floor(input * (0.5 + rand() * 0.4)), output_tokens: int(80, 900) };
    total = { input_tokens: total.input_tokens + last.input_tokens, cached_input_tokens: total.cached_input_tokens + last.cached_input_tokens, output_tokens: total.output_tokens + last.output_tokens };
    rec('event_msg', { type: 'token_count', info: { total_token_usage: total, last_token_usage: last, model_context_window: 272000 } });
  };
  const call = (name: string, args: object | string, output: string, ms: number) => {
    const call_id = `call_${uuid().slice(0, 12)}`;
    if (typeof args === 'string') item({ type: 'custom_tool_call', status: 'completed', call_id, name, input: args });
    else item({ type: 'function_call', name, arguments: JSON.stringify(args), call_id });
    t += ms;
    item({ type: typeof args === 'string' ? 'custom_tool_call_output' : 'function_call_output', call_id, output });
    usage();
    t += int(2000, 9000);
  };
  const shell = (command: string, out: string, code = 0, ms = int(200, 1500)) =>
    call('shell_command', { command, workdir: cwd }, `Exit code: ${code}\nWall time: ${(ms / 1000).toFixed(1)} seconds\nOutput:\n${out}`, ms);

  rec('session_meta', { id, timestamp: new Date(t).toISOString(), cwd, originator: 'codex_cli_rs', cli_version: '0.63.0', source: 'cli', model_provider: 'openai' });
  item({ type: 'message', role: 'user', content: [{ type: 'input_text', text: `<environment_context>\n  <cwd>${cwd}</cwd>\n  <shell>zsh</shell>\n</environment_context>` }] });
  rec('turn_context', { cwd, approval_policy: 'on-request', sandbox_policy: { type: 'workspace-write' }, model, effort: 'medium', summary: 'auto' });
  item({ type: 'message', role: 'user', content: [{ type: 'input_text', text: prompt }] });
  rec('event_msg', { type: 'user_message', message: prompt, images: [] });
  t += int(2000, 5000);
  item({ type: 'reasoning', summary: [{ type: 'summary_text', text: `**Finding the relevant code**\n\nThe request: ${prompt.toLowerCase()}.` }], content: null, encrypted_content: 'demo' });
  const f = pick(p.files);
  shell(`rg -n "timeout" ${p.files.slice(0, 2).join(' ')}`, `${p.files[0]}:12:const timeout = 5000;`);
  shell(`sed -n '1,40p' ${f}`, "import { config } from './config';\n\nexport function handler(req, res) {\n  // ...\n}");
  call('apply_patch', `*** Begin Patch\n*** Update File: ${f}\n@@\n-const timeout = 5000;\n+const timeout = config.timeoutMs ?? 5000;\n*** End Patch\n`, `Success. Updated the following files:\nM ${f}\n`, int(50, 300));
  const fails = rand() < 0.35;
  shell(p.test, fails ? 'FAIL 1 test\n  expected 200, received 500' : 'Tests: 24 passed', fails ? 1 : 0, int(4000, 30000));
  if (fails) shell(p.test, 'Tests: 24 passed', 0, int(4000, 30000));
  item({ type: 'message', role: 'assistant', content: [{ type: 'output_text', text: `Done: ${prompt.replace(/\.$/, '').toLowerCase()}.\n\n- \`${f}\` reads \`config.timeoutMs\` and keeps **5000** as the fallback\n- \`${p.test}\` passes` }] });
  rec('event_msg', { type: 'agent_message', message: 'Done.' });
  return { id, lines, start };
}

if (codexOut) {
  let c = 0;
  for (let d = 0; d < 14; d += 2) {
    const cwd = pick(Object.keys(PROJECTS));
    const start = day0.getTime() + d * 86_400_000 + 9 * 3_600_000 + int(0, 3_000_000);
    const s = codexSession(cwd, pick(PROJECTS[cwd].prompts), start);
    const day = new Date(start);
    const ymd = [String(day.getFullYear()), String(day.getMonth() + 1).padStart(2, '0'), String(day.getDate()).padStart(2, '0')];
    const dir = join(codexOut, ...ymd);
    mkdirSync(dir, { recursive: true });
    const stamp = new Date(start).toISOString().slice(0, 19).replace(/:/g, '-');
    writeFileSync(join(dir, `rollout-${stamp}-${s.id}.jsonl`), s.lines.map((l) => JSON.stringify(l)).join('\n') + '\n');
    c++;
  }
  console.log(`wrote ${c} synthetic Codex sessions to ${codexOut}`);
}
