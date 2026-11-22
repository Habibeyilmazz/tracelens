# Changelog

All notable changes to this project are documented here. The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

## [Unreleased]

### Added (round 2, design pass)

- Assistant replies render as Markdown in the web UI and the HTML export (`src/mdhtml.ts`): paragraphs, headings, fenced code, nested lists, quotes, rules, pipe tables, inline code, bold, italic and http(s) links. All text is escaped; other link schemes stay as text; images are never loaded (alt text only). User prompts are still shown exactly as typed.
- Session list: a "Sort by" select next to the project filter; under 820px wide each session becomes a stacked card (title, project and models, start time, then labelled duration/tokens/cost/tools/errors) instead of a table cut off at the right edge.
- Skip-to-content link.
- With no sessions at all, the empty-state message is shown without the (useless) project and sort filters.

### Changed (round 2, design pass)

- Faint text (timestamps, durations, chart labels) and form-control borders now meet WCAG AA contrast in light and dark themes (axe-core reported 50 contrast failures on the session page; it now reports none on any page in either theme).
- Header content lines up with the page column instead of the window edges.
- Tool-call "Input"/"Output" labels are no longer `<h4>` headings (they broke the heading outline with hundreds of entries).
- The sorted column header carries `aria-sort`.
- Model names in the insights tables stay on one line (they broke into one word per line on phones); chart labels are 1px larger.
- A server error shows a normal page with the message instead of a plain-text response.
- Demo data: the final assistant message uses Markdown, so the demo shows the rendering.

### Fixed (round 2)

- Two Task calls with the same prompt no longer swap subagents: subagents are matched in start-time order, not file-name order.
- An old-layout `agent-*.jsonl` whose first line is longer than 64 KiB is now attached to its session (the first line is read in full, up to 16 MiB).

### Notes for the next person (round 2, design pass)

- Verified with Playwright screenshots at 1280px and 390px, light and dark (`scripts/screenshots.mjs`, now also `session-reply.png` and `qa/sessions-mobile-dark.png`), and axe-core 4.10 run against every page in both themes: no violations. Keyboard: Tab reaches the skip link, nav, search, filters and every tool call `<summary>`, all with a visible 2px focus ring. The UI has no animations, so there is nothing for `prefers-reduced-motion` to turn off.
- The Markdown renderer is deliberately small; indented (non-fenced) code blocks, setext headings and HTML blocks are shown as plain paragraphs. Nesting deeper than 12 levels falls back to plain text.
- Still open: two projects holding the same session id both link to the first one (ids are used as URLs). Still never run on a real Claude Code log; no Codex adapter; logs are held in memory.

### Fixed

- `file-history-snapshot` records (Claude Code writes one before every prompt) are skipped instead of showing up as "Unrecognized event" rows and as search hits.
- Locally generated `<synthetic>` assistant messages no longer add a `<synthetic>` row to the per-model insights table.
- Post-compaction summaries (`isCompactSummary`) are shown as system notes, not as something the user typed.
- Files that contain only `summary` lines are no longer listed as empty sessions dated "—".
- Usage with no timestamp anywhere no longer creates a 1970-01-01 day (which stretched the daily charts across decades).
- The session header's "first error" link now also points at API errors and error-level system events, matching the error count.
- `tracelens export missing.jsonl` says "file not found" instead of "No session matches".
- `export -o` refuses any `.jsonl` output path, so a log opened by path outside `--dir` (or its subagent files) cannot be overwritten.
- `export -o` compares real paths, so a symlink cannot point the output at a log or into the log folder.
- One unreadable or vanishing `agent-*.jsonl` file no longer makes every page return 500.
- Markdown export no longer crashes (call stack overflow) on output with a very large number of backtick runs.
- `--redact` now also catches Windows home paths inside raw JSON records, where backslashes are doubled.
- Search highlights stay aligned when the text contains characters whose lowercase form has a different length (such as "İ"); search is also 2-5x faster.
- The search page counts matches in every session, not only the 100 it lists, and says when the list is cut.

### Changed

- README and `pricing.json` say that rates are flat per model (Claude Haiku 5.5's higher rate above 100K-token prompts is not modelled).

### Notes for the next person (round 1, first-run review)

- Fresh clone + README quickstart verified: `npm install`, `npm run build`, `serve` (empty-state page when `~/.claude/projects` is missing), `npm run demo`, `list`, `export`, and the Playwright screenshot script all work. `npm run demo -- --no-open` avoids opening a browser.
- Still never run on a real Claude Code log. Record types handled specially above were chosen from the documented/known 2.x layout, not observed; `progress` and `queue-operation` records, if present, still render raw.
- Scale check with synthetic data: 1.4 GB of logs (1,500 sessions) took 1.8 s to parse, ~0.9 s per search and ~1.8 GB of memory. Everything is held in memory, so multi-GB histories will need streaming or an index.
- Pricing table checked against the current list prices; all rows matched.
- Known, not fixed (rare): two Task calls with the identical prompt can get each other's subagent (matching is by prompt only); an old-layout `agent-*.jsonl` whose first line is over 64 KiB is not attached; two projects holding the same session id both link to the first one.
- Assistant text is still plain text, not rendered Markdown (roadmap).

## [0.1.0] - 2026-11-22

### Added

- Claude Code adapter: discovers sessions under `~/.claude/projects` (or `--dir`), parses JSONL defensively, de-duplicates usage per API message, pairs tool calls with results and durations, attaches subagents (inline sidechains, `subagents/` folders, loose `agent-*.jsonl`) to their Task call.
- `tracelens serve`: local web UI on 127.0.0.1 with a session list (filter, sort), full-text search, transcript view (collapsible tool calls, nested subagents, highlighted errors, raw unknown events) and an insights page (tokens and estimated cost per day, project and model; most-used tools; slowest tool calls; most-edited files).
- `tracelens list` and `tracelens export <session>` (Markdown or self-contained HTML, `--redact` for paths, emails and common secret patterns).
- `pricing.json`: editable list prices used for cost estimates.
- Synthetic demo data (`npm run demo`), a Playwright screenshot/QA script, node:test suite, GitHub Actions CI.

### Notes for the next person

- Never tested against a real Claude Code log: everything was built from synthetic fixtures (`test/fixtures`, `scripts/demo-data.ts`). The first thing worth doing with real logs is checking which records show up as "Unrecognized event" and deciding which deserve proper rendering.
- Search is a linear scan over parsed sessions held in memory; fine for thousands of sessions, needs an index beyond that.
- Main-thread items are shown in file order; conversation branches from rewinds are not reconstructed.
- Test servers use port 4187; the demo uses 4180 by default.
