// Server-side HTML for the web UI and the self-contained HTML export.
// Everything that comes from a log file goes through esc(): transcripts are untrusted input.

import { agentName, esc, fmtDate, fmtDuration, fmtOffset, fmtTokens, fmtUSD, oneLine, pretty, shortModel, shortPath, toolLabel } from './format.js';
import type { Insights, Row, SessionStats } from './insights.js';
import type { Hit } from './search.js';
import { isErrorItem, sessionItems, sessionToolCalls, totalTokens, type Item, type Session, type Subagent, type Usage } from './types.js';

import { mdToHtml } from './mdhtml.js';
import { folderOf } from './store.js';

export { esc };
const href = (s: Session) => `/session/${encodeURIComponent(folderOf(s))}/${encodeURIComponent(s.id)}`;
const qs = (params: Record<string, string | undefined>) => {
  const p = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) if (v) p.set(k, v);
  const s = p.toString();
  return s ? `?${s}` : '';
};

export const CSS = `
:root{--bg:#f3f4f6;--panel:#fff;--ink:#18202a;--muted:#59636f;--faint:#646d79;--rule:#dce0e6;--control:#868e99;--accent:#2b4fc0;--accent-soft:#e9eefc;--tool:#0d6e61;--tool-soft:#e3f2ef;--err:#b3261e;--err-soft:#fcebe9;--mark:#ffe18a;
--mono:ui-monospace,SFMono-Regular,Menlo,Consolas,"Liberation Mono",monospace;--sans:system-ui,-apple-system,"Segoe UI",Roboto,"Helvetica Neue",Arial,sans-serif;color-scheme:light}
@media (prefers-color-scheme:dark){:root:not([data-theme=light]){--bg:#0f1216;--panel:#161a20;--ink:#e3e7ec;--muted:#a0a9b5;--faint:#858e9a;--rule:#2a3039;--control:#646d79;--accent:#93a9ff;--accent-soft:#1b2440;--tool:#62c9b5;--tool-soft:#13292a;--err:#ff9189;--err-soft:#3b1e1d;--mark:#6e5b10;color-scheme:dark}}
:root[data-theme=dark]{--bg:#0f1216;--panel:#161a20;--ink:#e3e7ec;--muted:#a0a9b5;--faint:#858e9a;--rule:#2a3039;--control:#646d79;--accent:#93a9ff;--accent-soft:#1b2440;--tool:#62c9b5;--tool-soft:#13292a;--err:#ff9189;--err-soft:#3b1e1d;--mark:#6e5b10;color-scheme:dark}
*{box-sizing:border-box}
body{margin:0;background:var(--bg);color:var(--ink);font:15px/1.5 var(--sans)}
a{color:var(--accent);text-underline-offset:2px}
.top{border-bottom:1px solid var(--rule);background:var(--panel)}
.top>div{display:flex;gap:1.25rem;align-items:center;padding:.55rem 1rem;flex-wrap:wrap;max-width:1180px;margin:0 auto}
.skip{position:absolute;left:-999px;top:.5rem;z-index:1;background:var(--panel);padding:.3rem .6rem;border-radius:6px}
.skip:focus{left:1rem}
.brand{display:flex;align-items:center;gap:.45rem;font-weight:700;color:var(--ink);text-decoration:none;letter-spacing:-.01em}
.brand svg{color:var(--accent)}
.top nav{display:flex;gap:1rem}
.top nav a{color:var(--muted);text-decoration:none;padding:.2rem 0;border-bottom:2px solid transparent}
.top nav a[aria-current=page]{color:var(--ink);border-color:var(--accent)}
.top form{margin-left:auto;display:flex;gap:.4rem;flex:1 1 16rem;max-width:26rem}
.top input{flex:1;min-width:0}
input,select,button{font:inherit;color:inherit;background:var(--bg);border:1px solid var(--control);border-radius:6px;padding:.3rem .55rem}
input[type=checkbox]{accent-color:var(--accent);width:1rem;height:1rem;margin:0}
button{cursor:pointer;background:var(--panel)}
button:hover,select:hover{border-color:var(--accent)}
:focus-visible{outline:2px solid var(--accent);outline-offset:2px}
main{max-width:1180px;margin:0 auto;padding:1.25rem 1rem 4rem}
h1{font-size:1.4rem;line-height:1.3;margin:.2rem 0 .9rem;letter-spacing:-.01em;overflow-wrap:anywhere}
h2{font-size:1.05rem;margin:2.2rem 0 .3rem}
h2+p.muted{margin:0 0 .7rem;font-size:.88rem}
.muted{color:var(--muted)}
.filters{display:flex;flex-wrap:wrap;gap:.6rem;align-items:center;margin:0 0 1rem}
.filters label{display:flex;gap:.4rem;align-items:center;color:var(--muted);font-size:.9rem;max-width:100%}
.filters select{min-width:0;max-width:100%}
.scroll{overflow-x:auto;background:var(--panel);border:1px solid var(--rule);border-radius:8px}
table{border-collapse:collapse;width:100%}
th,td{padding:.45rem .7rem;border-bottom:1px solid var(--rule);text-align:left;vertical-align:top}
th{font-weight:600;color:var(--muted);font-size:.82rem;white-space:nowrap}
th a{color:inherit}
tr:last-child td{border-bottom:0}
tbody tr:hover{background:var(--accent-soft)}
.num{font-variant-numeric:tabular-nums;text-align:right;white-space:nowrap}
.nowrap{white-space:nowrap}
td.title{min-width:16rem}
td.title a{color:var(--ink);text-decoration:none;font-weight:550}
td.title a:hover{text-decoration:underline}
.sub-line{color:var(--muted);font-size:.83rem;overflow-wrap:anywhere}
.chip{display:inline-block;font-size:.78rem;padding:0 .4rem;border-radius:4px;border:1px solid var(--rule);margin:0 .2rem .15rem 0;white-space:nowrap}
.chip.agent{border-color:var(--tool);color:var(--tool)}
.bad{color:var(--err);font-weight:600}
code,.mono{font-family:var(--mono);font-size:.86em}
.live{margin-left:auto;font-size:.85rem;color:var(--muted)}.live::before{content:'';display:inline-block;width:.5rem;height:.5rem;border-radius:50%;background:var(--tool);margin-right:.4rem}
.meta{display:grid;grid-template-columns:repeat(auto-fit,minmax(8.5rem,1fr));gap:.7rem 1rem;margin:0 0 1rem;background:var(--panel);border:1px solid var(--rule);border-radius:8px;padding:.8rem 1rem}
.meta div{min-width:0}
.meta .wide{grid-column:span 2}
.meta dt{font-size:.78rem;color:var(--muted)}
.meta dd{margin:0;font-variant-numeric:tabular-nums;overflow-wrap:anywhere}
.toolbar{display:flex;flex-wrap:wrap;gap:.5rem;align-items:center;margin:0 0 1.2rem}
.toolbar form{display:flex;flex-wrap:wrap;gap:.5rem;align-items:center;margin-left:auto}
.toolbar label{font-size:.9rem;color:var(--muted);display:flex;gap:.3rem;align-items:center}
.est{font-size:.82rem;color:var(--muted)}
.row{display:grid;grid-template-columns:3.6rem minmax(0,1fr);gap:.8rem;margin:.3rem 0}
.row{scroll-margin:5rem}
@media screen{.tx>.row{content-visibility:auto;contain-intrinsic-size:auto 3rem}}
.row>.t{color:var(--faint);font:12px/1.5 var(--mono);text-align:right;text-decoration:none;padding-top:.5rem}
.row>.t:hover{color:var(--accent)}
.role{font-size:.76rem;font-weight:600;color:var(--muted);margin:0 0 .15rem}
.msg{white-space:pre-wrap;overflow-wrap:anywhere;padding:.5rem .8rem;border-radius:8px}
.k-user .msg{background:var(--accent-soft);border-left:3px solid var(--accent)}
.k-assistant .msg{background:var(--panel);border:1px solid var(--rule)}
.msg.md{white-space:normal}
.md>*{margin:.55rem 0}.md>:first-child{margin-top:0}.md>:last-child{margin-bottom:0}
.md>p,.md>ul,.md>ol,.md>blockquote,.md>.mh{max-width:80ch}
.md ul,.md ol{padding-left:1.4rem}.md li>ul,.md li>ol{margin:.2rem 0}.md li+li{margin-top:.2rem}
.md .mh{font-weight:650;margin-top:.9rem}
.md blockquote{margin-left:0;padding-left:.8rem;border-left:3px solid var(--rule);color:var(--muted)}
.md hr{border:0;border-top:1px solid var(--rule)}
.md :not(pre)>code{background:var(--bg);border:1px solid var(--rule);padding:0 .3rem;border-radius:4px}
.md pre code{font-size:inherit}
.md .scroll{background:none;font-size:.92rem}.md th,.md td{padding:.3rem .6rem}
.error .msg{border:1px solid var(--err);background:var(--err-soft)}
.k-system .msg{color:var(--muted);font-size:.86rem;padding:.15rem .8rem}
.k-system.error .msg{color:var(--err)}
details>summary{cursor:pointer;list-style:none}
details>summary::-webkit-details-marker{display:none}
details>summary::before{content:"▸";display:inline-block;width:.9em;color:var(--faint);font-size:.8rem}
details[open]>summary::before{content:"▾"}
.tool{border:1px solid var(--rule);border-left:3px solid var(--tool);border-radius:8px;background:var(--panel)}
.tool>summary{display:flex;gap:.55rem;align-items:baseline;padding:.4rem .75rem;min-width:0}
.tool>summary:hover{background:var(--tool-soft)}
.tname{font-weight:650;color:var(--tool);white-space:nowrap}
.targ{font:12.5px/1.5 var(--mono);color:var(--muted);overflow:hidden;text-overflow:ellipsis;white-space:nowrap;min-width:0;flex:1}
.dur{margin-left:auto;display:flex;align-items:center;gap:.45rem;font:12px var(--mono);color:var(--faint);white-space:nowrap}
.bar{display:inline-block;height:6px;border-radius:3px;background:var(--tool);min-width:2px}
.tool.error{border-left-color:var(--err)}
.tool.error .tname{color:var(--err)}
.flag{font:600 11px var(--sans);color:var(--err);border:1px solid var(--err);border-radius:4px;padding:0 .3rem}
.io{padding:.1rem .75rem .75rem}
.io .lbl{font-size:.76rem;color:var(--muted);margin:.6rem 0 .25rem;font-weight:600}
pre{margin:0;padding:.55rem .7rem;background:var(--bg);border:1px solid var(--rule);border-radius:6px;overflow:auto;max-height:30rem;font:12.5px/1.5 var(--mono);white-space:pre-wrap;overflow-wrap:anywhere}
.tool.error pre.out{border-color:var(--err)}
.subagent{margin:.7rem 0 .2rem;padding:.3rem 0 .1rem .7rem;border-left:2px dashed var(--tool)}
.subagent>.role{color:var(--tool)}
.subagent .row{grid-template-columns:3.1rem minmax(0,1fr)}
.quiet>summary{color:var(--muted);font-size:.86rem;padding:.25rem 0}
.quiet>pre,.quiet>.msg{margin-top:.2rem}
.k-thinking .msg{color:var(--muted);font-style:italic;border-left:3px solid var(--rule)}
.row:target>.c,.row.flash>.c{outline:2px solid var(--mark);outline-offset:3px;border-radius:8px}
mark{background:var(--mark);color:inherit;border-radius:2px}
.hits{list-style:none;padding:0;margin:0}
.hits>li{background:var(--panel);border:1px solid var(--rule);border-radius:8px;padding:.7rem .9rem;margin:0 0 .7rem}
.hits>li>a{color:var(--ink);text-decoration:none;font-weight:600}
.hits>li>a:hover{text-decoration:underline}
.hits ol{margin:.4rem 0 0;padding:0;list-style:none}
.hits ol li{padding:.25rem 0;border-top:1px solid var(--rule);font-size:.9rem;overflow-wrap:anywhere}
.hits ol a{color:var(--ink);text-decoration:none}
.hits ol a:hover .snip{text-decoration:underline}
.where{font-size:.76rem;color:var(--muted);margin-right:.4rem}
.chart{background:var(--panel);border:1px solid var(--rule);border-radius:8px;padding:.6rem .8rem}
.chart svg{display:block;width:100%;height:auto}
.chart .b{fill:var(--accent)}
.chart .b:hover{fill:var(--tool)}
.chart text{fill:var(--faint);font:12px var(--sans)}
.chart line{stroke:var(--rule)}
.hbar{display:inline-block;height:8px;border-radius:4px;background:var(--tool);vertical-align:middle;margin-right:.4rem}
.cols{display:grid;grid-template-columns:repeat(auto-fit,minmax(min(100%,30rem),1fr));gap:0 1.5rem}
.empty{background:var(--panel);border:1px dashed var(--rule);border-radius:8px;padding:1.2rem}
.empty>p:first-child{margin-top:0}.empty>p:last-child{margin-bottom:0}
footer.export{margin-top:3rem;color:var(--faint);font-size:.82rem}
@media (max-width:820px){
table.list,table.list tbody{display:block}table.list thead{display:none}
table.list tr{display:flex;flex-wrap:wrap;gap:.1rem 1.1rem;padding:.75rem .9rem;border-bottom:1px solid var(--rule)}
table.list tr:last-child{border-bottom:0}
table.list td{display:block;border:0;padding:0;text-align:left}
table.list td.title{order:-1;flex-basis:100%;min-width:0;margin-bottom:.15rem}
table.list td.when{flex-basis:100%;color:var(--muted);font-size:.85rem}
table.list td.num::before{content:attr(data-label) " ";color:var(--muted);font-size:.8rem;font-weight:400}}
@media (max-width:640px){.row{grid-template-columns:minmax(0,1fr);gap:0}.row>.t{text-align:left;padding:3px 0}.subagent .row{grid-template-columns:minmax(0,1fr)}.top form{margin-left:0;max-width:none}}
`;

// Opens the collapsed ancestors of a linked item, and wires the expand/collapse buttons.
export const APP_JS = `
function reveal(){var id=location.hash.slice(1);var el=id&&document.getElementById(id);if(!el)return;for(var p=el;p;p=p.parentElement)if(p.tagName==='DETAILS')p.open=true;el.scrollIntoView({block:'center'});}
addEventListener('hashchange',reveal);reveal();
document.querySelectorAll('[data-toggle]').forEach(function(b){b.addEventListener('click',function(){var open=b.dataset.toggle==='open';document.querySelectorAll('details.tool').forEach(function(d){d.open=open;});});});
document.querySelectorAll('select[data-autosubmit]').forEach(function(s){s.addEventListener('change',function(){s.form.submit();});});
function detailsByKey(){var n={},m={};document.querySelectorAll('#main details').forEach(function(d){var sa=d.parentElement.closest('[data-sa]');var k=(sa?sa.dataset.sa:'')+'/'+(d.dataset.ts||'')+'/';n[k]=(n[k]||0)+1;m[k+n[k]]=d;});return m;}
function swap(html,live){var doc=new DOMParser().parseFromString(html,'text/html');var root=document.documentElement;var atEnd=innerHeight+scrollY>=root.scrollHeight-80;
var was={},k,old=detailsByKey();for(k in old)was[k]=old[k].open;
['live-head','live-tx'].forEach(function(id){var a=document.getElementById(id),b=doc.getElementById(id);if(a&&b)a.replaceWith(document.adoptNode(b));});
var now=detailsByKey();for(k in now)if(k in was)now[k].open=was[k];
live.textContent='Live: updated '+new Date().toLocaleTimeString();if(atEnd)scrollTo(0,root.scrollHeight);}
var live=document.querySelector('[data-live]');
if(live){var etag=live.dataset.live,busy=false;setInterval(function(){if(busy||document.hidden)return;busy=true;
fetch(location.pathname,{headers:{'If-None-Match':etag},cache:'no-store'}).then(function(r){if(r.status!==200)return;return r.text().then(function(t){swap(t,live);etag=r.headers.get('ETag')||etag;});}).catch(function(){}).then(function(){busy=false;});},2000);}
`;

const LOGO = `<svg width="20" height="20" viewBox="0 0 20 20" aria-hidden="true"><circle cx="8.5" cy="8.5" r="6" fill="none" stroke="currentColor" stroke-width="2.2"/><path d="M13 13l5 5" stroke="currentColor" stroke-width="2.6" stroke-linecap="round"/><path d="M5.5 9.5h1.6l1-2.5 1.4 4 1-1.5h1" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linejoin="round" stroke-linecap="round"/></svg>`;

export type Nav = 'sessions' | 'insights' | 'search' | 'session';

export function page(title: string, body: string, nav: Nav, q = ''): string {
  const cur = (n: Nav) => (n === nav ? ' aria-current="page"' : '');
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${esc(title)} · tracelens</title><link rel="icon" href="data:,"><style>${CSS}</style></head><body>
<a class="skip" href="#main">Skip to content</a>
<header class="top"><div><a class="brand" href="/">${LOGO}tracelens</a>
<nav aria-label="Main"><a href="/"${cur('sessions')}>Sessions</a><a href="/insights"${cur('insights')}>Insights</a></nav>
<form action="/search" method="get" role="search"><input type="search" name="q" value="${esc(q)}" placeholder="Search all sessions" aria-label="Search all sessions"><button>Search</button></form></div></header>
<main id="main">${body}</main><script src="/app.js" defer></script></body></html>`;
}

function tokensCell(u: Usage): string {
  const t = `Input ${u.input.toLocaleString('en-US')}\nOutput ${u.output.toLocaleString('en-US')}\nCache write ${u.cacheWrite.toLocaleString('en-US')}\nCache read ${u.cacheRead.toLocaleString('en-US')}`;
  return `<td class="num" title="${esc(t)}" data-label="Tokens">${fmtTokens(totalTokens(u))}</td>`;
}

// Collapses whitespace but keeps it at the edges, so a snippet still reads around its <mark>.
const flat = (s: string) => s.replace(/\s+/g, ' ');

const costText = (st: { cost: number; unpriced: boolean }) => fmtUSD(st.cost) + (st.unpriced ? '*' : '');

// ---------------------------------------------------------------- session list

export interface ListQuery {
  project?: string;
  sort: string;
  dir: string;
  codexDir?: string;
}

export function sessionsPage(rows: { s: Session; st: SessionStats }[], projects: string[], q: ListQuery): string {
  const SORTS: [string, string][] = [['date', 'Started'], ['duration', 'Duration'], ['tokens', 'Tokens'], ['cost', 'Est. cost']];
  const sortTh = (key: string, label: string, cls = '') =>
    q.sort === key
      ? `<th${cls} aria-sort="descending">${label} <span aria-hidden="true">↓</span></th>`
      : `<th${cls}><a href="/${qs({ project: q.project, sort: key })}">${label}</a></th>`;
  const body = rows
    .map(({ s, st }) => {
      const sub = [esc(shortPath(s.project)), ...(s.source === 'codex' ? ['<span class="chip agent">Codex</span>'] : []), ...s.models.map((m) => `<span class="chip">${esc(shortModel(m))}</span>`)].join(' ');
      return `<tr><td class="nowrap when">${fmtDate(s.start)}</td>
<td class="title"><a href="${href(s)}">${esc(s.title)}</a><div class="sub-line" title="${esc(s.project)}">${sub}</div></td>
<td class="num" data-label="Duration">${fmtDuration(s.end - s.start)}</td>${tokensCell(st.usage)}<td class="num" data-label="Cost">${costText(st)}</td>
<td class="num" data-label="Tools">${st.tools}</td><td class="num${st.errors ? ' bad' : ''}" data-label="Errors">${st.errors}</td></tr>`;
    })
    .join('');
  const options = projects.map((p) => `<option value="${esc(p)}"${p === q.project ? ' selected' : ''}>${esc(p)}</option>`).join('');
  const empty = q.project
    ? `<p class="empty">No sessions for this project.</p>`
    : `<div class="empty"><p>No sessions found in <code>${esc(q.dir)}</code> (Claude Code)${q.codexDir ? ` or <code>${esc(q.codexDir)}</code> (Codex CLI)` : ''}.</p><p class="muted">Point tracelens at other folders with <code>tracelens serve --dir &lt;path&gt; --codex-dir &lt;path&gt;</code>, or try the demo data: <code>npm run demo</code>.</p></div>`;
  return page(
    'Sessions',
    `<h1>Sessions <span class="muted">${rows.length}</span></h1>
${rows.length || q.project ? `<form class="filters" method="get" action="/"><label>Project <select name="project" data-autosubmit><option value="">All projects</option>${options}</select></label>
<label>Sort by <select name="sort" data-autosubmit>${SORTS.map(([k, l]) => `<option value="${k}"${k === q.sort ? ' selected' : ''}>${l}</option>`).join('')}</select></label><noscript><button>Apply</button></noscript></form>` : ''}
${
  rows.length
    ? `<div class="scroll"><table class="list"><thead><tr>${sortTh('date', 'Started')}<th>Session</th>${sortTh('duration', 'Duration', ' class="num"')}
${sortTh('tokens', 'Tokens', ' class="num"')}${sortTh('cost', 'Est. cost', ' class="num"')}<th class="num">Tool calls</th><th class="num">Errors</th></tr></thead><tbody>${body}</tbody></table></div>
<p class="est">Costs are estimates from list prices in pricing.json, not a bill.${rows.some((r) => r.st.unpriced) ? ' * Includes tokens from a model with no price in pricing.json.' : ''}</p>`
    : empty
}`,
    'sessions',
  );
}

// ---------------------------------------------------------------- search

const MAX_HITS = 100; // sessions listed per search; the totals still count every hit

export function searchPage(q: string, hits: Hit[]): string {
  const total = hits.reduce((a, h) => a + h.total, 0);
  const list = hits
    .slice(0, MAX_HITS)
    .map((h) => {
      const link = href(h.session);
      const more = h.total > h.matches.length ? `<li class="muted">and ${h.total - h.matches.length} more in this session</li>` : '';
      return `<li><a href="${link}"><strong>${esc(h.session.title)}</strong></a>
<div class="sub-line">${esc(shortPath(h.session.project))} · ${fmtDate(h.session.start)} · ${h.total} ${h.total === 1 ? 'match' : 'matches'}</div>
<ol>${h.matches
        .map(
          (m) =>
            `<li><a href="${link}#i-${m.n}"><span class="where">${esc(m.where)}</span><span class="snip">${esc(flat(m.before))}<mark>${esc(m.match)}</mark>${esc(flat(m.after))}</span></a></li>`,
        )
        .join('')}${more}</ol></li>`;
    })
    .join('');
  const body = !q.trim()
    ? `<h1>Search</h1><p class="muted">Search the text of every prompt, reply, tool input and tool output.</p>`
    : `<h1>Results for “${esc(q)}”</h1><p class="muted">${total} ${total === 1 ? 'match' : 'matches'} in ${hits.length} ${hits.length === 1 ? 'session' : 'sessions'}</p>
${hits.length > MAX_HITS ? `<p class="muted">Showing the ${MAX_HITS} sessions with the most matches.</p>` : ''}
${hits.length ? `<ul class="hits">${list}</ul>` : `<p class="empty">No matches. Search is case-insensitive and matches exact text, so try a shorter phrase.</p>`}`;
  return page(q ? `Search: ${q}` : 'Search', body, 'search', q);
}

// ---------------------------------------------------------------- session + transcript

function sessionHeader(s: Session, st: SessionStats): string {
  const firstError = sessionItems(s).find(isErrorItem);
  const errors = st.errors
    ? `<span class="bad">${st.errors}</span>${firstError ? ` <a href="#i-${firstError.n}">first error</a>` : ''}`
    : '0';
  const u = st.usage;
  const field = (k: string, v: string) => `<div><dt>${k}</dt><dd>${v}</dd></div>`;
  return `<h1>${esc(s.title)}</h1><dl class="meta">
${field('Project', `<span title="${esc(s.project)}">${esc(shortPath(s.project))}</span>`)}${field('Agent', agentName(s.source))}
${field('Started', fmtDate(s.start))}${field('Duration', fmtDuration(s.end - s.start))}
${field('Models', s.models.map((m) => esc(shortModel(m))).join(', ') || '—')}
${field('Tokens in / out', `${fmtTokens(u.input)} / ${fmtTokens(u.output)}`)}
${field('Cache write / read', `${fmtTokens(u.cacheWrite)} / ${fmtTokens(u.cacheRead)}`)}
${field('Estimated cost', costText(st))}${field('Tool calls', String(st.tools))}${field('Errors', errors)}
<div class="wide"><dt>Session id</dt><dd><code>${esc(s.id)}</code></dd></div></dl>`;
}

/** A session active this recently is probably still running: its page follows the log as it grows. */
export const LIVE_MS = 60 * 60_000;

export function sessionPage(s: Session, st: SessionStats, etag?: string): string {
  const live = etag && Date.now() - s.end < LIVE_MS ? `<span class="live" data-live="${esc(etag)}">Live: new activity shows up here</span>` : '';
  const toolbar = `<div class="toolbar"><button type="button" data-toggle="open">Expand all tool calls</button><button type="button" data-toggle="close">Collapse all</button>
<form method="get" action="${href(s)}/export"><label>Export <select name="format"><option value="md">Markdown</option><option value="html">HTML</option></select></label>
<label><input type="checkbox" name="redact" value="1" checked> Redact paths and secrets</label><button>Download</button></form>${live}</div>`;
  // live-head and live-tx are the parts app.js swaps when the log grows; it keeps each <details>
  // open or closed by its subagent and data-ts (the log's timestamp, which stays put when lines are added, unlike item numbers).
  return page(s.title, `<div id="live-head">${sessionHeader(s, st)}</div>${toolbar}<div id="live-tx">${transcript(s, { clip: 40_000 })}</div>`, 'session');
}

export function exportHtml(s: Session, st: SessionStats): string {
  // The file is opened from disk without our server's headers: its own CSP keeps it from running or loading anything.
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; img-src data:; form-action 'none'; base-uri 'none'">
<title>${esc(s.title)}</title><style>${CSS}</style></head><body><main>${sessionHeader(s, st)}${transcript(s, { clip: 0 })}
<footer class="export">Exported with tracelens on ${fmtDate(Date.now())}. Costs are estimates from list prices.</footer></main></body></html>`;
}

interface TxOpts {
  clip: number; // max characters per text block, 0 = no limit
}

function clip(text: string, max: number): string {
  if (!max || text.length <= max) return esc(text);
  return `${esc(text.slice(0, max))}\n<span class="muted">… ${(text.length - max).toLocaleString('en-US')} more characters. Export the session to see all of it.</span>`;
}

function clipMd(text: string, max: number): string {
  if (!max || text.length <= max) return mdToHtml(text);
  return `${mdToHtml(text.slice(0, max))}<p class="muted">… ${(text.length - max).toLocaleString('en-US')} more characters. Export the session to see all of it.</p>`;
}

export function transcript(s: Session, opts: TxOpts): string {
  const maxMs = Math.max(1, ...sessionToolCalls(s).map((c) => c.durationMs ?? 0));
  const ctx = { s, opts, maxMs };
  let out = `<div class="tx">${renderItems(s.items, ctx)}</div>`;
  if (s.orphanSubagents.length)
    out += `<h2>Subagents not linked to a tool call</h2><p class="muted">These subagent logs belong to this session, but no Task call with the same prompt was found.</p>${s.orphanSubagents.map((sa) => subagent(sa, ctx)).join('')}`;
  if (!s.items.length && !s.orphanSubagents.length) out += `<p class="empty">This session has no messages.</p>`;
  return out;
}

type Ctx = { s: Session; opts: TxOpts; maxMs: number };

function renderItems(items: Item[], ctx: Ctx): string {
  return items.map((it) => row(it, ctx)).join('');
}

function subagent(sa: Subagent, ctx: Ctx): string {
  return `<div class="subagent" data-sa="${esc(sa.id)}"><div class="role">Subagent <code>${esc(sa.id)}</code> · ${sa.items.length} ${sa.items.length === 1 ? 'step' : 'steps'}</div>${renderItems(sa.items, ctx)}</div>`;
}

function row(it: Item, ctx: Ctx): string {
  const offset = ctx.s.start && it.ts ? fmtOffset(it.ts - ctx.s.start) : '';
  const time = `<a class="t" href="#i-${it.n}" title="${esc(fmtDate(it.ts))}">${offset}</a>`;
  const err = isErrorItem(it);
  return `<div class="row k-${it.kind}${err ? ' error' : ''}" id="i-${it.n}">${time}<div class="c">${body(it, ctx)}</div></div>`;
}

function body(it: Item, ctx: Ctx): string {
  const max = ctx.opts.clip;
  switch (it.kind) {
    case 'user':
      return `<div class="role">User</div><div class="msg">${clip(it.text, max)}</div>`;
    case 'assistant':
      return `<div class="role">Assistant${it.error ? ' · API error' : ''}</div><div class="msg md">${clipMd(it.text, max)}</div>`;
    case 'thinking':
      return `<details class="quiet" data-ts="${it.ts}"><summary>Thinking</summary><div class="msg">${clip(it.text, max)}</div></details>`;
    case 'system':
      return `<div class="msg">${clip(it.text, max)}</div>`;
    case 'raw':
      return `<details class="quiet" data-ts="${it.ts}"><summary>${esc(it.label)}</summary><pre tabindex="0">${clip(it.json, max)}</pre></details>`;
    case 'tool': {
      const w = it.durationMs === undefined ? 0 : Math.max(2, Math.round(56 * Math.sqrt(it.durationMs / ctx.maxMs)));
      const dur = it.durationMs === undefined ? '' : `<span class="dur"><span class="bar" style="width:${w}px"></span>${fmtDuration(it.durationMs)}</span>`;
      const output =
        it.output === undefined ? `<div class="lbl">Output</div><p class="muted">No result was recorded.</p>` : `<div class="lbl">Output${it.isError ? ' (error)' : ''}</div><pre class="out" tabindex="0">${clip(it.output, max)}</pre>`;
      return `<details class="tool${it.isError ? ' error' : ''}" data-ts="${it.ts}"><summary><span class="tname">${esc(it.name)}</span><span class="targ">${esc(toolLabel(it.input))}</span>${it.isError ? '<span class="flag">error</span>' : ''}${dur}</summary>
<div class="io"><div class="lbl">Input</div><pre tabindex="0">${clip(pretty(it.input), max)}</pre>${output}${it.subagent ? subagent(it.subagent, ctx) : ''}</div></details>`;
    }
  }
}

// ---------------------------------------------------------------- insights

export interface InsightsQuery {
  days?: number;
  project?: string;
}

function barChart(rows: Row[], value: (r: Row) => number, fmt: (n: number) => string, label: string): string {
  const W = 480, H = 190, L = 50, B = 22, T = 8;
  const max = Math.max(...rows.map(value), 0);
  const step = (W - L) / Math.max(rows.length, 1);
  const bw = Math.max(1, Math.min(28, step * 0.72));
  const y = (v: number) => T + (H - T - B) * (1 - (max ? v / max : 0));
  const bars = rows
    .map((r, i) => {
      const v = value(r);
      const top = y(v);
      return `<rect class="b" x="${(L + i * step + (step - bw) / 2).toFixed(1)}" y="${top.toFixed(1)}" width="${bw.toFixed(1)}" height="${(H - B - top).toFixed(1)}"><title>${esc(r.key)}: ${esc(fmt(v))}</title></rect>`;
    })
    .join('');
  const ticks = [0, Math.floor((rows.length - 1) / 2), rows.length - 1]
    .filter((v, i, a) => a.indexOf(v) === i && rows[v])
    .map((i) => `<text x="${(L + i * step + step / 2).toFixed(1)}" y="${H - 6}" text-anchor="middle">${esc(rows[i].key.slice(5))}</text>`)
    .join('');
  return `<figure class="chart" style="margin:0"><svg viewBox="0 0 ${W} ${H}" role="img" aria-label="${esc(label)}, ${rows.length} days, peak ${esc(fmt(max))}">
<line x1="${L}" x2="${W}" y1="${y(max)}" y2="${y(max)}"/><line x1="${L}" x2="${W}" y1="${H - B}" y2="${H - B}"/>
<text x="${L - 6}" y="${y(max) + 4}" text-anchor="end">${esc(fmt(max))}</text><text x="${L - 6}" y="${H - B + 4}" text-anchor="end">0</text>${bars}${ticks}</svg></figure>`;
}

function usageTable(rows: Row[], keyLabel: string, keyCell: (r: Row) => string): string {
  if (!rows.length) return `<p class="empty">No token usage in this range.</p>`;
  return `<div class="scroll" tabindex="0" role="region" aria-label="Usage by ${keyLabel.toLowerCase()}"><table><thead><tr><th>${keyLabel}</th><th class="num">Sessions</th><th class="num">Input</th><th class="num">Output</th><th class="num">Cache write</th><th class="num">Cache read</th><th class="num">Est. cost</th></tr></thead><tbody>
${rows
  .map(
    (r) =>
      `<tr><td class="nowrap">${keyCell(r)}</td><td class="num">${r.sessions}</td><td class="num">${fmtTokens(r.usage.input)}</td><td class="num">${fmtTokens(r.usage.output)}</td><td class="num">${fmtTokens(r.usage.cacheWrite)}</td><td class="num">${fmtTokens(r.usage.cacheRead)}</td><td class="num">${fmtUSD(r.cost)}</td></tr>`,
  )
  .join('')}</tbody></table></div>`;
}

export function insightsPage(ins: Insights, projects: string[], q: InsightsQuery): string {
  const dayOpts = [
    ['7', 'Last 7 days'],
    ['30', 'Last 30 days'],
    ['90', 'Last 90 days'],
    ['', 'All time'],
  ]
    .map(([v, l]) => `<option value="${v}"${String(q.days ?? '') === v ? ' selected' : ''}>${l}</option>`)
    .join('');
  const projOpts = projects.map((p) => `<option value="${esc(p)}"${p === q.project ? ' selected' : ''}>${esc(p)}</option>`).join('');
  const maxCalls = Math.max(1, ...ins.tools.map((t) => t.calls));
  const field = (k: string, v: string) => `<div><dt>${k}</dt><dd>${v}</dd></div>`;
  const u = ins.usage;

  const toolsTable = ins.tools.length
    ? `<div class="scroll" tabindex="0" role="region" aria-label="Most-used tools"><table><thead><tr><th>Tool</th><th>Calls</th><th class="num">Errors</th><th class="num">Avg time</th><th class="num">Slowest</th></tr></thead><tbody>
${ins.tools
  .slice(0, 20)
  .map(
    (t) =>
      `<tr><td><code>${esc(t.name)}</code></td><td class="nowrap"><span class="hbar" style="width:${Math.max(2, Math.round((90 * t.calls) / maxCalls))}px"></span>${t.calls}</td><td class="num${t.errors ? ' bad' : ''}">${t.errors}</td><td class="num">${fmtDuration(t.avgMs)}</td><td class="num">${fmtDuration(t.maxMs)}</td></tr>`,
  )
  .join('')}</tbody></table></div>`
    : `<p class="empty">No tool calls in this range.</p>`;

  const slowTable = ins.slowest.length
    ? `<div class="scroll" tabindex="0" role="region" aria-label="Slowest tool calls"><table><thead><tr><th class="num">Time</th><th>Tool</th><th>Session</th></tr></thead><tbody>
${ins.slowest
  .map(
    ({ session, call }) =>
      `<tr><td class="num">${fmtDuration(call.durationMs)}</td><td><code>${esc(call.name)}</code><div class="sub-line mono">${esc(oneLine(toolLabel(call.input), 70))}</div></td><td><a href="${href(session)}#i-${call.n}">${esc(oneLine(session.title, 60))}</a></td></tr>`,
  )
  .join('')}</tbody></table></div>`
    : `<p class="empty">No timed tool calls in this range.</p>`;

  const filesTable = ins.files.length
    ? `<div class="scroll" tabindex="0" role="region" aria-label="Files edited most often"><table><thead><tr><th>File</th><th class="num">Edits</th><th class="num">Sessions</th></tr></thead><tbody>
${ins.files.map((f) => `<tr><td class="mono" title="${esc(f.path)}">${esc(shortPath(f.path))}</td><td class="num">${f.edits}</td><td class="num">${f.sessions}</td></tr>`).join('')}</tbody></table></div>`
    : `<p class="empty">No file edits in this range.</p>`;

  const body = `<h1>Insights</h1>
<form class="filters" method="get" action="/insights"><label>Range <select name="days" data-autosubmit>${dayOpts}</select></label>
<label>Project <select name="project" data-autosubmit><option value="">All projects</option>${projOpts}</select></label><noscript><button>Apply</button></noscript></form>
<dl class="meta">${field('Sessions', String(ins.sessions))}${field('Tokens', fmtTokens(totalTokens(u)))}${field('Input / output', `${fmtTokens(u.input)} / ${fmtTokens(u.output)}`)}
${field('Cache write / read', `${fmtTokens(u.cacheWrite)} / ${fmtTokens(u.cacheRead)}`)}${field('Estimated cost', fmtUSD(ins.cost))}${field('Tool calls', String(ins.toolCalls))}</dl>
<p class="est">Cost is an estimate from the list prices in <code>pricing.json</code> (edit it to match your rates). Subscription plans are not billed per token.${
    ins.unpricedModels.length ? ` Not priced: ${ins.unpricedModels.map((m) => `<code>${esc(m)}</code>`).join(', ')}.` : ''
  }</p>
${
  ins.byDay.length
    ? `<div class="cols"><section><h2>Tokens per day</h2><p class="muted">Input, output and cache tokens</p>${barChart(ins.byDay, (r) => totalTokens(r.usage), fmtTokens, 'Tokens per day')}</section>
<section><h2>Estimated cost per day</h2><p class="muted">USD, from pricing.json</p>${barChart(ins.byDay, (r) => r.cost, fmtUSD, 'Estimated cost per day')}</section></div>`
    : ''
}
<h2>By project</h2><p class="muted">Sorted by estimated cost</p>${usageTable(ins.byProject, 'Project', (r) => `<span title="${esc(r.key)}">${esc(shortPath(r.key))}</span>`)}
<h2>By model</h2><p class="muted">Sorted by estimated cost</p>${usageTable(ins.byModel, 'Model', (r) => `<code>${esc(r.key)}</code>`)}
<div class="cols"><section><h2>Most-used tools</h2><p class="muted">Including tool calls made by subagents</p>${toolsTable}</section>
<section><h2>Slowest tool calls</h2><p class="muted">Time from the call to its result</p>${slowTable}</section></div>
<h2>Files edited most often</h2><p class="muted">Successful Edit, MultiEdit, Write and NotebookEdit calls, and Codex apply_patch</p>${filesTable}`;
  return page('Insights', body, 'insights');
}
