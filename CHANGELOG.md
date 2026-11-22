# Changelog

All notable changes to this project are documented here. The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

## [Unreleased]

### Fixed

- `file-history-snapshot` records (Claude Code writes one before every prompt) are skipped instead of showing up as "Unrecognized event" rows and as search hits.
- Locally generated `<synthetic>` assistant messages no longer add a `<synthetic>` row to the per-model insights table.
- Post-compaction summaries (`isCompactSummary`) are shown as system notes, not as something the user typed.
- Files that contain only `summary` lines are no longer listed as empty sessions dated "—".
- Usage with no timestamp anywhere no longer creates a 1970-01-01 day (which stretched the daily charts across decades).
- The session header's "first error" link now also points at API errors and error-level system events, matching the error count.
- `tracelens export missing.jsonl` says "file not found" instead of "No session matches".
- `export -o` refuses any `.jsonl` output path, so a log opened by path outside `--dir` (or its subagent files) cannot be overwritten.

### Changed

- README and `pricing.json` say that rates are flat per model (Claude Haiku 5.5's higher rate above 100K-token prompts is not modelled).

### Notes for the next person (round 1, first-run review)

- Fresh clone + README quickstart verified: `npm install`, `npm run build`, `serve` (empty-state page when `~/.claude/projects` is missing), `npm run demo`, `list`, `export`, and the Playwright screenshot script all work. `npm run demo -- --no-open` avoids opening a browser.
- Still never run on a real Claude Code log. Record types handled specially above were chosen from the documented/known 2.x layout, not observed; `progress` and `queue-operation` records, if present, still render raw.
- Scale check with synthetic data: 1.4 GB of logs (1,500 sessions) took 1.8 s to parse, ~0.9 s per search and ~1.8 GB of memory. Everything is held in memory, so multi-GB histories will need streaming or an index.
- Pricing table checked against the current list prices; all rows matched.

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
