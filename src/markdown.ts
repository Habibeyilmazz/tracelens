import { agentName, fmtDate, fmtDuration, fmtOffset, fmtTokens, fmtUSD, oneLine, pretty, shortModel, toolLabel } from './format.js';
import type { SessionStats } from './insights.js';
import type { Item, Session, Subagent } from './types.js';

// A run of backticks longer than any inside the text. reduce, not Math.max(...spread): a long output can hold
// more backtick runs than the call stack allows.
const ticks = (text: string, min: number) => '`'.repeat((text.match(/`+/g) ?? []).reduce((n, m) => Math.max(n, m.length), min) + 1);

/** A code fence longer than any backtick run inside the text, so content can never close it. */
export function fence(text: string, lang = ''): string {
  const f = ticks(text, 2);
  return `${f}${lang}\n${text}\n${f}`;
}

/** Inline code. Text holding '<' or '![' is written as <code> with entities: renderers do not always agree on
 *  which backticks pair up (link labels, table cells, strikethrough), and read as prose it would be live HTML or an
 *  image. As <code> it is safe however it is read; a viewer without HTML shows the tag as text. */
const code = (s: string) => {
  const t = s.replace(/[\r\n]+/g, ' ');
  if (/<|!\[/.test(t)) return `<code>${[...t].map((c) => (/[A-Za-z0-9 ]/.test(c) ? c : `&#${c.codePointAt(0)};`)).join('')}</code>`;
  const f = ticks(t, 0);
  const pad = /^`|`$/.test(t) ? ' ' : '';
  return `${f}${pad}${t}${pad}${f}`;
};

/** Prose from a log stays Markdown, but viewing the export (GitHub, an editor preview) must not load anything or
 *  run HTML: outside code '<' that could open a tag or autolink is escaped and image syntax becomes text. */
export function inert(text: string): string {
  const lines = text.split(/\r\n?|\n/);
  const out: string[] = [];
  for (let i = 0; i < lines.length; i++) {
    // Tabs as spaces: after a '> ' a tab can be as little as 2 columns of indent, short enough to open a fence.
    const line = lines[i].replace(/^[ \t]+/, (w) => w.replaceAll('\t', '    '));
    const f = /^( *)(`{3,}|~{3,})(.*)$/.exec(line);
    if (f && !(f[2][0] === '`' && f[3].includes('`'))) {
      // A code block is written out again at column 0 with a fence its content cannot close. Where a renderer
      // would end it (an indented fence ends with its list item, an open one runs to the end of the file) then
      // no longer matters: it ends where we say, and the next message starts outside it.
      const [, pad, mark, info] = f;
      const close = new RegExp(`^ *${mark[0]}{${mark.length},}\\s*$`);
      const body: string[] = [];
      while (++i < lines.length && !close.test(lines[i])) body.push(lines[i].replace(new RegExp(`^ {0,${pad.length}}`), ''));
      out.push(fence(body.join('\n'), /^[\w+#.-]*$/.test(info.trim()) ? info.trim() : ''));
    } else if (f) {
      // ```x`y` is no fence (a backtick in its info), but would become one once the `y` span is rewritten.
      out.push(`${f[1]}\\\`${inertLine(line.slice(f[1].length + 1))}`);
    } else out.push(inertLine(line));
  }
  return out.join('\n');
}

/** One line of prose. A code span (a backtick run closed by one of the same length) goes through code(). */
function inertLine(l: string): string {
  // Where each length of backtick run starts, so looking for a closing run never rescans the line.
  const runs = new Map<number, number[]>();
  const seen = new Map<number, number>();
  for (const m of l.matchAll(/`+/g)) {
    const at = runs.get(m[0].length);
    if (at) at.push(m.index);
    else runs.set(m[0].length, [m.index]);
  }
  let out = '';
  for (let i = 0; i < l.length; ) {
    const c = l[i];
    if (c === '\\') {
      out += l.slice(i, i + 2); // an escape: the next character is literal, a backtick too
      i += 2;
    } else if (c === '`') {
      let j = i;
      while (l[j] === '`') j++;
      const n = j - i;
      const at = runs.get(n) ?? [];
      let k = seen.get(n) ?? 0;
      while (k < at.length && at[k] < j) k++;
      seen.set(n, k);
      if (k === at.length) {
        out += l.slice(i, j); // never closed: literal backticks
        i = j;
        continue;
      }
      const t = l.slice(j, at[k]);
      // Spans without '<' or '![' are copied as they are; only those can do harm if a renderer pairs differently.
      // As in CommonMark, one space is dropped from each end when both ends have one.
      out += /<|!\[/.test(t) ? code(/^ .*[^ ].* $/.test(t) ? t.slice(1, -1) : t) : l.slice(i, at[k] + n);
      i = at[k] + n;
    } else if (c === '<' && /[A-Za-z/!?]/.test(l[i + 1] ?? '')) {
      out += '&lt;';
      i++;
    } else if (c === '!' && l[i + 1] === '[') {
      out += '!\\[';
      i += 2;
    } else {
      out += c;
      i++;
    }
  }
  return out;
}

// Text that goes inside an HTML <summary> in Markdown must not open tags, nor hold a line break: a blank line
// would end the HTML block and the rest would be read as Markdown (an image, say).
const inline = (s: string) => s.replace(/\s+/g, ' ').replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' })[c]!);

export function exportMarkdown(s: Session, st: SessionStats): string {
  const u = st.usage;
  const head = [
    `# ${inertLine(oneLine(s.title, 200))}`,
    '',
    `- Project: ${code(s.project)}`,
    `- Agent: ${agentName(s.source)}`,
    `- Session: ${code(s.id)}`,
    `- Started: ${fmtDate(s.start)} (duration ${fmtDuration(s.end - s.start)})`,
    `- Models: ${inertLine(oneLine(s.models.map(shortModel).join(', '), 1000)) || 'none recorded'}`,
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
  return `**Subagent ${code(sa.id)}** (${sa.items.length} steps)\n\n${items(sa.items, s, depth + 1)}\n\n**End of subagent ${code(sa.id)}**\n`;
}

function item(it: Item, s: Session, depth: number): string {
  const at = s.start && it.ts ? ` [${fmtOffset(it.ts - s.start)}]` : '';
  const h = depth ? '####' : '###';
  switch (it.kind) {
    case 'user':
      return `${h} User${at}\n\n${inert(it.text)}\n`;
    case 'assistant':
      return `${h} Assistant${it.error ? ' (API error)' : ''}${at}\n\n${inert(it.text)}\n`;
    case 'thinking':
      return `<details><summary>Thinking</summary>\n\n${fence(it.text)}\n\n</details>\n`;
    case 'system': {
      const text = inert(it.text);
      // In front of a code block's fence the error mark would stop it being a fence, so it gets its own line there.
      const mark = !it.error ? '' : text.startsWith('```') ? '**Error:**\n' : '**Error:** ';
      return `> ${`${mark}${text}`.split('\n').join('\n> ')}\n`;
    }
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
