# Changelog

All notable changes to this project are documented here. The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

## [Unreleased]

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
