import { fmtDate, fmtDuration, fmtOffset, fmtTokens, fmtUSD, oneLine, pretty, shortModel, toolLabel } from './format.js';
import type { SessionStats } from './insights.js';
import type { Item, Session, Subagent } from './types.js';

/** A code fence longer than any backtick run inside the text, so content can never close it. */
export function fence(text: string, lang = ''): string {
  // reduce, not Math.max(...spread): a long output can hold more backtick runs than the call stack allows.
  const longest = (text.match(/`+/g) ?? []).reduce((n, m) => Math.max(n, m.length), 2);
  const f = '`'.repeat(longest + 1);
  return `${f}${lang}\n${text}\n${f}`;
}

// Text that goes inside an HTML <summary> in Markdown must not open tags.
const inline = (s: string) => s.replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' })[c]!);

export function exportMarkdown(s: Session, st: SessionStats): string {
  const u = st.usage;
  const head = [
    `# ${oneLine(s.title, 200)}`,
    '',
    `- Project: \`${s.project}\``,
    `- Session: \`${s.id}\``,
    `- Started: ${fmtDate(s.start)} (duration ${fmtDuration(s.end - s.start)})`,
    `- Models: ${s.models.map(shortModel).join(', ') || 'none recorded'}`,
    `- Tokens: ${fmtTokens(u.input)} in, ${fmtTokens(u.output)} out, ${fmtTokens(u.cacheWrite)} cache write, ${fmtTokens(u.cacheRead)} cache read`,
    `- Estimated cost: ${fmtUSD(st.cost)}${st.unpriced ? ' (some models have no price)' : ''}, from list prices`,
    `- Tool calls: ${st.tools}, errors: ${st.errors}`,
    '',
  ];
  const body = items(s.items, s, 0);
  const orphans = s.orphanSubagents.map((sa) => subagent(sa, s, 0)).join('\n');
  return [...head, body, orphans ? `\n## Subagents not linked to a tool call\n\n${orphans}` : '', '', '_Exported with tracelens._', ''].join('\n');
}

function items(list: Item[], s: Session, depth: number): string {
  return list.map((it) => item(it, s, depth)).join('\n');
}

function subagent(sa: Subagent, s: Session, depth: number): string {
  return `**Subagent \`${sa.id}\`** (${sa.items.length} steps)\n\n${items(sa.items, s, depth + 1)}\n\n**End of subagent \`${sa.id}\`**\n`;
}

function item(it: Item, s: Session, depth: number): string {
  const at = s.start && it.ts ? ` [${fmtOffset(it.ts - s.start)}]` : '';
  const h = depth ? '####' : '###';
  switch (it.kind) {
    case 'user':
      return `${h} User${at}\n\n${it.text}\n`;
    case 'assistant':
      return `${h} Assistant${it.error ? ' (API error)' : ''}${at}\n\n${it.text}\n`;
    case 'thinking':
      return `<details><summary>Thinking</summary>\n\n${fence(it.text)}\n\n</details>\n`;
    case 'system':
      return `> ${it.error ? '**Error:** ' : ''}${it.text.split('\n').join('\n> ')}\n`;
    case 'raw':
      return `<details><summary>${inline(it.label)}</summary>\n\n${fence(it.json, 'json')}\n\n</details>\n`;
    case 'tool': {
      const label = toolLabel(it.input);
      const title = `Tool: ${it.name}${label ? ` ${oneLine(label, 90)}` : ''}${it.isError ? ' (error)' : ''}${it.durationMs !== undefined ? `, ${fmtDuration(it.durationMs)}` : ''}`;
      const out = it.output === undefined ? '_No result recorded._' : `${it.isError ? 'Error output' : 'Output'}:\n\n${fence(it.output)}`;
      return `<details><summary>${inline(title)}</summary>\n\nInput:\n\n${fence(pretty(it.input), typeof it.input === 'string' ? '' : 'json')}\n\n${out}\n\n</details>\n${it.subagent ? `\n${subagent(it.subagent, s, depth)}` : ''}`;
    }
  }
}
