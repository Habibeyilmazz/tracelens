<img src="assets/logo.png" alt="" width="96" align="right">

# tracelens

A local viewer and analytics page for Claude Code and Codex CLI session logs: browse every session, search them all, read a transcript with its tool calls, and see where your tokens went.
It runs on your machine, binds to 127.0.0.1, only reads the log files, and sends nothing anywhere.

![A Claude Code session in tracelens: session metadata, then the transcript with timed tool calls and a nested subagent](docs/screenshots/session.png)

## Quickstart

Needs Node.js 22 or newer.

```sh
git clone https://github.com/Habibeyilmazz/tracelens.git
cd tracelens
npm install
npm run build
node dist/src/cli.js serve
```

This reads Claude Code transcripts from `~/.claude/projects` (or `$CLAUDE_CONFIG_DIR/projects`) and Codex CLI sessions from `~/.codex/sessions` and `~/.codex/archived_sessions` (or the same under `$CODEX_HOME`), and opens <http://127.0.0.1:4180/>. A folder that does not exist is skipped.

No logs on this machine, or want to look first? `npm run demo` generates 25 made-up Claude Code sessions and 7 made-up Codex sessions into `.demo/` and serves those instead.

## Features

- **Claude Code and Codex CLI** sessions side by side in one list, one search and one set of insights. Codex sessions carry a "Codex" tag.
- **Session list**: project, start time, duration, models, token totals, estimated cost, tool calls and errors. Filter by project, sort by date, duration, tokens or cost.
- **Full-text search** across every prompt, reply, tool input and tool output, including subagents. Each hit links to the exact spot in the transcript.
- **Transcript view**: user turns, assistant replies rendered as Markdown (headings, lists, tables, code blocks; links only for http(s), images never loaded), collapsible thinking, tool calls collapsed to one line (tool, main argument, duration bar) that expand to full input and output. Subagent runs are nested under the Task call that started them. Failed tool calls and API errors are marked in red, and the header links to the first error.
- **Insights**: tokens and estimated cost per day, per project and per model; most-used tools with error counts and timings; the slowest tool calls; the files edited most often. Filter by time range and project.
- **Export** a session as Markdown or as a single self-contained HTML file, from the CLI or the session page, optionally with paths and secrets redacted.
- **Codex transcripts**: prompts, replies (Markdown), reasoning summaries, and tool calls (`shell`, `apply_patch`, MCP tools, …) paired with their output, timed, and marked red when a command exits non-zero. The environment and `AGENTS.md` text Codex adds to each session is collapsed under "Context added by Codex".
- **Defensive parsing**: records it does not recognise, and lines that are not valid JSON, are shown raw in the transcript instead of breaking the page.
- Light and dark themes (follows your system), keyboard-friendly, AA text contrast, and a card layout for the session list on phone-sized screens. No JavaScript frameworks and no runtime dependencies.

![A Codex session: the injected context collapsed, timed shell calls, an apply_patch call opened to show the patch, and a failed test run marked in red](docs/screenshots/session-codex.png)

![The end of a transcript: tool calls with timing bars, a failed Bash call marked in red, and the final reply rendered as Markdown](docs/screenshots/session-reply.png)

![Insights page: tokens and estimated cost per day, and usage by project](docs/screenshots/insights.png)

## Command line

```text
tracelens serve [--port 4180] [--no-open]   Open the web UI on 127.0.0.1
tracelens list [--limit 20]                 Print recent sessions and their ids
tracelens export <session> [options]        Write a transcript as Markdown or HTML

  <session>             A session id, a unique id prefix, or a path to a .jsonl file
                        (a Claude Code transcript or a Codex rollout-*.jsonl)
  -f, --format md|html  Output format (default: from --output extension, else md)
  -o, --output <file>   Write to a file instead of stdout
  --redact              Replace home/project paths, emails and common secret patterns
  --dir <path>          Claude Code projects folder (default ~/.claude/projects)
  --codex-dir <path>    Codex CLI sessions folder (default ~/.codex/sessions);
                        archived_sessions next to a folder named "sessions" is read too
  --pricing <file>      Pricing table for cost estimates
```

Examples:

```sh
node dist/src/cli.js list
node dist/src/cli.js export 3f2a --redact -o session.md
node dist/src/cli.js export ~/.claude/projects/-Users-me-app/3f2a….jsonl -o session.html
node dist/src/cli.js export ~/.codex/sessions/2026/11/20/rollout-2026-11-20T09-12-03-7c1e….jsonl -o codex.md
```

To get a `tracelens` command on your PATH, run `npm link` in the repo (it creates a global symlink; `npm unlink -g tracelens` removes it).

## Cost estimates

Token counts come straight from the logs. Cost is an **estimate**: tokens multiplied by the list prices in [`pricing.json`](pricing.json), in USD per million tokens, with separate rates for input, output, 5-minute and 1-hour cache writes and cache reads. A model id is priced by the longest key it contains, so `claude-sonnet-4-5` also prices `claude-sonnet-4-5-20250929`. Models without a price are counted in tokens and listed as "not priced". Rates are flat per model, so a model with a higher price for very long prompts (Claude Haiku 5.5 above 100K tokens, OpenAI's gpt-5.4 and later above 272K) is estimated at its base rate.

OpenAI models (used by Codex) are in the same file: `input` is the uncached input rate, `cacheRead` the cached-input rate, and the cache-write rates are 0 because OpenAI does not charge for them. Codex logs count cached tokens inside the input total and reasoning tokens inside the output total; tracelens splits the cached part out and prices reasoning as output, as OpenAI bills it. A version suffix never borrows another version's price: `gpt-5` prices `gpt-5-codex` but not `gpt-5.2`, and a variant without its own row (such as `gpt-5.1-codex-max`) is priced as its base model (`gpt-5.1`), so add a row if its price differs.

Edit `pricing.json` to match your rates, or pass your own file with `--pricing`. If you use a subscription plan you are not billed per token, so treat the number as a measure of usage, not a bill.

## Redaction

`--redact` (on by default in the web UI's export form) rewrites every string in the exported session:

- the session's project folder becomes `<project>`, and home folders (`/Users/<name>`, `/home/<name>`, `C:\Users\<name>`) become `~`;
- emails become `[email]`;
- common secret shapes become `[REDACTED]`: Anthropic, OpenAI, GitHub, Slack, AWS, Google and npm keys, JWTs, bearer tokens, private key blocks, passwords in URLs, and `api_key=` / `token:` / `password=` style assignments;
- a string too long to check (an unbroken run of several million characters, such as a base64url blob) is replaced whole by a `[REDACTED: … characters too long to check for secrets]` note.

It is pattern matching, so read an export before you share it.

## How it works

- **Discovery.** Claude Code keeps one JSONL file per session in `~/.claude/projects/<encoded-folder>/<session-id>.jsonl`. Subagent logs live either inline (records with `isSidechain: true`), in `<session-id>/subagents/*.jsonl`, or in `agent-*.jsonl` files next to the sessions. tracelens handles all three. Codex CLI writes one `rollout-<time>-<session-id>.jsonl` per session under `~/.codex/sessions/YYYY/MM/DD/`, and moves archived ones to `~/.codex/archived_sessions/`; tracelens reads both.
- **Parsing** ([`src/claude.ts`](src/claude.ts)) turns records into a small normalized model ([`src/types.ts`](src/types.ts)): user and assistant messages, thinking, tool calls paired with their results, system events, and raw items for anything else. Claude Code writes one line per content block and repeats the message's usage on each, so usage is counted once per API message id. Claude Code's own bookkeeping is kept out of the way: `file-history-snapshot` records (checkpoint backups) are skipped, `<synthetic>` messages it writes locally add no usage, post-compaction summaries are shown as system notes rather than user turns, and files that hold nothing but summary lines are not listed as sessions. A tool call's duration is the time between the call and its result. A subagent is attached to the Task call whose `prompt` matches the subagent's first message (in start order, so repeated identical prompts pair up correctly); subagents that match nothing are listed at the end of the transcript. Odd input is shown, not fatal: a line that is not JSON, or is nested more than 200 levels deep, appears as an "Unreadable line"; a timestamp outside 2000-2099 is ignored; a byte-order mark is skipped; session files over 512 MB (up to 2 GB, the most Node reads at once) are split into lines from the bytes.
- **Codex parsing** ([`src/codex.ts`](src/codex.ts)) reads `{timestamp, type, payload}` lines into the same model. The transcript comes from `response_item` lines (messages, reasoning summaries, `function_call`/`custom_tool_call` paired with their `*_call_output` by `call_id`); the `event_msg` copies of the same prompts, replies and commands are skipped. A tool call failed when its output starts with a non-zero `Exit code:` / `Process exited with code`, when older JSON-wrapped output has a non-zero `metadata.exit_code`, or when the output says `success: false`. Token usage comes from `token_count` events: their `total_token_usage` is cumulative and often repeated, so each event counts only the growth since the previous one. The model is the one from the latest `turn_context`. Files from before the envelope format (a bare metadata line, then bare response items) are read too. Codex has no subagent logs to nest.
- **Serving** ([`src/server.ts`](src/server.ts)) uses Node's `http` module and renders HTML on the server. Parsed sessions are cached and a file is re-read only when its size or modification time changes, so new sessions show up on reload.
- **Read-only.** Log files are opened for reading only. `export -o` refuses to write inside either log folder or to any `.jsonl` file.
- **Local only.** The server listens on 127.0.0.1, answers only requests addressed to `127.0.0.1`, `localhost` or `[::1]` on its own port (which blocks DNS-rebinding pages), only accepts GET, and sends a strict Content-Security-Policy. Other websites (and other servers on 127.0.0.1) can link to a tracelens page, but the browser's Fetch Metadata headers let tracelens refuse their attempts to load pages as images, scripts, frames or fetches, so they cannot time searches over your transcripts. All transcript text is HTML-escaped. The page loads no fonts, scripts or images from the internet, and an exported HTML file carries its own Content-Security-Policy.
- **No login.** There is no password or token: any program running on your machine, under any user account, can read the web UI while `tracelens serve` runs. On a shared machine, stop it when you are done.
- **Session URLs** are `/session/<folder>/<session id>`, because the same session id can appear in more than one Claude Code project folder. For a Codex session the folder is the day folder (`/session/20/<id>`), or `archived_sessions` for an archived one.

Both log formats are internal to their tools and change between versions. tracelens was written against synthetic fixtures modelled on the documented layout and field names (Claude Code: `type`, `message`, `usage`, `isSidechain`, `toolUseResult`, …; Codex: `session_meta`, `turn_context`, `response_item`, `event_msg`, `token_count`, …, taken from published schema notes), not against captured real logs, so expect to see some events shown raw; they are never dropped.

### Adding another log format

The UI, search, insights and exporters only read the `Session` type in [`src/types.ts`](src/types.ts). An adapter is a module with a `discover(dir)` that lists session files and a `parse(files)` that returns a `Session`, plus one line in [`src/store.ts`](src/store.ts). [`src/codex.ts`](src/codex.ts) is a small example.

## Development

```sh
npm install
npm test               # build, then run the node:test suite against synthetic fixtures (~2 s)
npm run test:e2e       # Playwright: the main journey in Chromium against `tracelens serve` (needs `npx playwright install chromium` once)
TRACELENS_SLOW_TESTS=1 npm test   # also reads a 600 MB session file (writes it to the temp folder)
npm run typecheck
npm run demo           # synthetic data on http://127.0.0.1:4180
node scripts/screenshots.mjs http://127.0.0.1:4180   # Playwright check + screenshots (needs `npx playwright install chromium` once)
```

The test fixtures are hand-made. `test/fixtures/projects` (Claude Code) covers split assistant messages, inline and file-based subagents, an orphan subagent, tool errors, API errors, meta messages, unknown event types and a truncated line. `test/fixtures/codex` covers injected context, duplicate events, plain-text and JSON-wrapped shell output, an `apply_patch` call, a call with no result, repeated `token_count` totals, an error event, unknown event types, a truncated line, and the older pre-envelope layout. [`test/robustness.test.ts`](test/robustness.test.ts) holds the odd-input cases (deep nesting, byte-order marks, out-of-range timestamps, emoji, multi-megabyte runs, junk ids and token counts).

## Roadmap

- Show rewound or edited conversation branches as a tree instead of file order.
- A search index for very large histories (search is a linear scan today).
- CSV export of the insights tables.
- Publish as an npm package so `npx tracelens serve` works without cloning.

## License

[MIT](LICENSE)
