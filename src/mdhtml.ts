// A small Markdown-to-HTML renderer for assistant messages. The text is untrusted: every piece of it is
// escaped, links are kept only for http(s) URLs, raw HTML is shown as text, and images are never loaded
// (only their alt text is shown). Covers what models actually write: paragraphs, headings, fenced code,
// lists (nested by indentation), quotes, rules, pipe tables, `code`, **bold**, *italic* and [links](url).
// shortcut: indented (non-fenced) code blocks and setext headings render as paragraphs; add them if real logs need it.

import { esc } from './format.js';

const FENCE = /^ {0,3}(`{3,}|~{3,})\s*([^`\s]*)/;
const LIST = /^( *)([-*+]|\d{1,9}[.)])\s+(.*)$/;
const RULE = /^ {0,3}([-*_])( *\1){2,} *$/;
const TABLE_SEP = /^ *\|? *:?-+:? *(\| *:?-+:? *)*\|? *$/;

export function mdToHtml(text: string, depth = 0): string {
  // Quotes and lists recurse; past a sane depth the rest is shown as plain text, never a stack overflow.
  if (depth > 12) return `<pre tabindex="0">${esc(text)}</pre>`;
  const lines = text.replace(/\r\n?/g, '\n').replace(/\t/g, '    ').split('\n');
  const out: string[] = [];
  let para: string[] = [];
  const flush = () => {
    if (para.length) out.push(`<p>${para.map(inline).join('<br>')}</p>`);
    para = [];
  };

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const fence = FENCE.exec(line);
    if (fence) {
      flush();
      const close = new RegExp(`^ {0,3}${fence[1][0] === '`' ? '`' : '~'}{${fence[1].length},}\\s*$`);
      const code: string[] = [];
      while (++i < lines.length && !close.test(lines[i])) code.push(lines[i]);
      out.push(`<pre tabindex="0"><code>${esc(code.join('\n'))}</code></pre>`);
    } else if (!line.trim()) {
      flush();
    } else if (/^ {0,3}#{1,6}\s/.test(line)) {
      flush();
      // Not real <h*> elements: hundreds of them would swamp the page's heading outline.
      out.push(`<p class="mh">${inline(line.replace(/^ *#+\s+/, '').replace(/\s+#+\s*$/, ''))}</p>`);
    } else if (RULE.test(line)) {
      flush();
      out.push('<hr>');
    } else if (/^ {0,3}>/.test(line)) {
      flush();
      const quote: string[] = [];
      for (; i < lines.length && /^ {0,3}>/.test(lines[i]); i++) quote.push(lines[i].replace(/^ *> ?/, ''));
      i--;
      out.push(`<blockquote>${mdToHtml(quote.join('\n'), depth + 1)}</blockquote>`);
    } else if (LIST.test(line) && (!para.length || !/^\s/.test(line))) {
      flush();
      const block: string[] = [];
      const base = LIST.exec(line)![1].length;
      // A list runs until a blank line followed by something that is neither indented nor another item.
      for (; i < lines.length; i++) {
        const l = lines[i];
        if (!l.trim()) {
          const next = lines[i + 1] ?? '';
          if (!next.trim() || (indent(next) <= base && !LIST.test(next))) break;
        }
        block.push(l);
      }
      i--;
      out.push(list(block, base, depth));
    } else if (line.includes('|') && lines[i + 1]?.includes('|') && TABLE_SEP.test(lines[i + 1])) {
      flush();
      const head = cells(line);
      const rows: string[][] = [];
      for (i += 2; i < lines.length && lines[i].includes('|') && lines[i].trim(); i++) rows.push(cells(lines[i]));
      i--;
      const tr = (cs: string[], tag: string) => `<tr>${head.map((_, k) => `<${tag}>${inline(cs[k] ?? '')}</${tag}>`).join('')}</tr>`;
      out.push(`<div class="scroll" tabindex="0"><table><thead>${tr(head, 'th')}</thead><tbody>${rows.map((r) => tr(r, 'td')).join('')}</tbody></table></div>`);
    } else {
      para.push(line.trim());
    }
  }
  flush();
  return out.join('');
}

const indent = (l: string) => l.length - l.trimStart().length;

function list(block: string[], base: number, depth: number): string {
  const items: string[][] = [];
  let col = 0; // where the current item's text starts; continuation lines are dedented to it
  for (const l of block) {
    const m = LIST.exec(l);
    if (m && m[1].length <= base + 1) {
      items.push([m[3]]);
      col = m[0].length - m[3].length;
    } else items[items.length - 1].push(l.slice(Math.min(indent(l), col)));
  }
  const tag = /^\d/.test(LIST.exec(block[0])![2]) ? 'ol' : 'ul';
  const start = tag === 'ol' ? parseInt(LIST.exec(block[0])![2], 10) : 1;
  const lis = items.map((it) => {
    const body = mdToHtml(it.join('\n'), depth + 1);
    // Items without blank lines ("tight") lose their first <p>, as in most Markdown renderers.
    return `<li>${it.some((l) => !l.trim()) ? body : body.replace(/^<p>((?:(?!<\/?p>).)*)<\/p>/s, '$1')}</li>`;
  });
  return `<${tag}${start !== 1 ? ` start="${start}"` : ''}>${lis.join('')}</${tag}>`;
}

function cells(row: string): string[] {
  return row
    .trim()
    .replace(/^\|/, '')
    .replace(/(?<!\\)\|$/, '')
    .split(/(?<!\\)\|/)
    .map((c) => c.trim().replace(/\\\|/g, '|'));
}

/** Inline spans. Code spans are cut out first so nothing inside them is formatted. */
export function inline(s: string): string {
  return s
    .split(/(`+[^`]*?`+)/)
    .map((part, k) => {
      if (k % 2) return `<code>${esc(part.replace(/^`+ ?| ?`+$/g, ''))}</code>`;
      // Brackets are excluded inside the label and the URL, so long runs of '[' or of unclosed links stay linear
      // (an IPv6 literal URL such as http://[::1]/ stays text). Links are cut out before emphasis so a '*' in a
      // URL never puts <em> inside the href; split() gives [text, label, url, text, label, url, …, text].
      const bits = esc(part)
        .replace(/!\[([^[\]]*)\]\([^)\s[\]]*\)/g, '$1')
        .split(/\[([^[\]]+)\]\((https?:\/\/[^)\s[\]]+)\)/);
      let out = '';
      for (let i = 0; i < bits.length; i += 3)
        out += emphasis(bits[i]) + (i + 2 < bits.length ? `<a href="${bits[i + 2]}" rel="noreferrer">${emphasis(bits[i + 1])}</a>` : '');
      return out;
    })
    .join('');
}

// No '*' inside a span: keeps these linear on long runs of unmatched asterisks.
const emphasis = (s: string) =>
  s.replace(/\*\*([^\s*](?:[^*]*[^\s*])?)\*\*/g, '<strong>$1</strong>').replace(/(^|[^\w*])\*([^\s*](?:[^*]*[^\s*])?)\*(?![\w*])/g, '$1<em>$2</em>');
