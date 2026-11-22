# Changelog

All notable changes to this project are documented here. The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

## [Unreleased]

### Added (round 12, feature: search by several words)

Chosen after using the demo as a newcomer: searching for the words you remember (`refund decimal`, `dark mode chart`) found nothing, because search matched the whole query as one exact string, even though those sessions were in the list. Finding a past session is what search is for, so this hurt most.

- A query is now a set of words: a session is a hit when it contains every word somewhere, in any order and in any message, tool input or output (case is still ignored). `"quoted phrases"` match exactly, across any run of whitespace. Quote marks are syntax, so a literal `"` cannot be searched for. Repeated words count once.
- Snippets mark every word, not just the one that started the snippet. Words that sit within one snippet's text are merged into it instead of repeating the same line once per word, and each word gets at least one snippet even when another word fills the first five. "and N more in this session" now counts only matches not visible in the snippets.
- The search page has a Project select (`/search?q=…&project=…`); editing the query in the header box keeps that scope. The no-results message says what the search needs.
- Tests: query parsing, all-words matching (including a word that only occurs inside a longer one, `refund refunds`), phrases across line breaks, snippet merging and the per-word guarantee, the project scope over HTTP, and an E2E step that searches two words and picks a project in Chromium. Existing tests that relied on an unquoted multi-word query being an exact phrase now quote it.
- Speed on ~5,000 sessions (the 32 demo sessions repeated, in memory, one run on this Mac): 22 to 32 ms per query, against 17 to 25 ms for the old exact-substring search.
- `docs/screenshots/search.png` re-taken from the running demo (`refund decimal`) and shown in the README; `scripts/screenshots.mjs` also checks the search page at 390px.

### Notes for the next person (round 12)

- Reported gaps re-checked: none is a bug. The security-review skill still cannot run (the agent session does not start inside the repo), Safari and Firefox are still untested (only Chromium is installed), axe was not re-run (the only new control is a labelled `<select>` like the one on the session list), and `docs/demo.gif` was not re-recorded (its single-word `timeout` search looks the same).
- Results are still ranked by match count. Ranking by recency or by how close the words are would be the next step if a long session that mentions a word fifty times keeps burying the one you want.

### Security (round 11, security pass)

Reviewed by hand (the security-review skill needs the session to start inside a git repo, and this one does not): server, renderers, both exporters, redaction, CLI paths, CI workflow, git history, dependencies.

- Fixed: a Markdown export could load images and run HTML from the log when viewed. User, assistant and system text went into the `.md` verbatim, so `![x](https://host/?data)`, `<img src=…>` or a `<details>`/`<iframe>` in a log (for example one written by a prompt-injected model) became live on GitHub or in an editor preview (VS Code's preview loads https images). The HTML export and the web UI were not affected. Now, outside code, `<` that could open a tag or autolink is written `&lt;` and `![` becomes `!\[` (it reads the same). Code blocks are written out again at column 0 with a fence their content cannot close, so a renderer cannot disagree about where they end (an indented one is dedented; one left open is closed before the next message). Inline code holding `<` or `![` is written as `<code>` with entities, because markdown-it and commonmark.js do not always pair backticks the way the spec reads (link labels, table cells, strikethrough); a viewer without HTML support shows that tag as text. Tool names and record labels in `<summary>` lose their line breaks: a blank line there ended the HTML block, and the rest was read as Markdown. Regression tests in `test/export.test.ts` (checked: both fail without the fix). Also checked with a throwaway fuzzer, not in the repo: 560,000 random exports through markdown-it 14.1.0 (`html: true`) and commonmark.js 0.31.2 gave no raw tag, image or stray `<details>` (the old code: 2,680 leaks in 2,000 cases). The fuzzer also caught a quadratic case (3.5 s for a 1 MB line of backtick runs that never close), now linear, with a test.
- Visible change in exports of normal sessions (checked on all 36 demo and fixture sessions): only Claude Code's `<command-name>` tags, which a Markdown viewer used to hide, now show as text.
- Redaction now also catches Stripe (`sk_live_`, `rk_test_`, …), GitLab (`glpat-`), Hugging Face (`hf_`) and SendGrid (`SG.…`) keys and Slack/Discord webhook URLs outside `key=value` assignments. Added to the linear-time test.
- Checked, no change needed: the web UI's Markdown renderer (fuzzed the same way, 200,000 cases: only its own tags, links only http(s)); Host/Fetch-Metadata checks and CSP; `export -o` path guard; `npm audit` (0 vulnerabilities); git history (no keys, real names or home paths; all commits use the noreply identity); CI has `contents: read`, actions pinned to SHAs that match their tags (checked with the GitHub API), `persist-credentials: false`.

### Notes for the next person (round 11)

- The Codex second-opinion review hit its usage limit again ("try again at 9:32 AM"). The previous gaps are unchanged and none is a bug fixable here: Safari/Firefox untested (only Chromium is installed), axe not re-run (no UI change this round), the `progress` record shape is from memory (no real logs may be read), `docs/demo.gif` not re-recorded.
- Not changed on purpose: GitHub renders some fence languages itself (`mermaid`, `geojson`, `stl`); a code block in a message keeps its language, so a `geojson` block in an export viewed on GitHub shows a map with tiles from GitHub's map provider. No log data is sent.

### Changed (round 10, design pass)

Looked at every page in Chromium (Playwright 1.65.1) at 1280px and 390px, light and dark, plus the empty, no-results and not-found states, and tabbed through a session page with the keyboard. Fixed what was broken or cramped; the overall look was kept.

- Fixed: keyboard focus on a transcript control (time link, tool call, thinking block) showed only a 2px sliver at its left edge. Round 8's `content-visibility:auto` on transcript rows clips painting to the row, and the focus ring was drawn outside the control. Inside the transcript the ring is now drawn just inside the control. New E2E test measures the ring against its row (checked: it fails without the fix).
- Claude Code `progress` records (hook, shell and subagent progress ticks) are skipped like `file-history-snapshot`, instead of each becoming a collapsed "Unrecognized event" row. Their end result is already in the tool result, system record or subagent file. The shape (`type: "progress"` with a `data.type` such as `bash_progress` or `hook_progress`) comes from Claude Code's public behaviour as remembered, not from a real log, which agents here may not open. Other unknown types are still shown raw.
- Phones (640px and narrower): the step time sits in a narrow column next to each step, as on desktop. Before, it took a line of its own above every message and tool call.
- Charts on phones: the axis labels were about 8px tall; they are now about 11px, and the first and last dates are anchored inside the plot so the last one is no longer cut off.
- Tables that scroll sideways (insights on phones) show a soft shadow at the edge that has more columns. File paths in "Files edited most often" wrap at `/`, so that table now fits a phone. Table cells line up on the text baseline (numbers used to sit lower than the monospace names next to them).
- Failed tool calls hover in red, not the teal used for successful ones. The "Session not found" and "Page not found" pages use the same panel as the other empty states.
- README screenshots re-taken from the running demo. `docs/demo.gif` was not re-recorded: on desktop only the chart date labels and the error hover look different.

### Notes for the next person (round 10)

- Reduced motion: nothing to do. The UI has no animations or transitions, and its scrolling (search hit, live update) is instant.
- The Codex second-opinion review hit its usage limit again ("try again at 9:32 AM"); `codex exec` also waits on stdin unless given `< /dev/null`. Safari and Firefox are still untested (only Chromium is installed). Axe was not re-run this round; the changes are CSS layout and one SVG attribute, checked by screenshots and the E2E suite (5 tests, including the 320px no-sideways-scroll test).

### Fixed (round 9, first-run review)

Done from a fresh clone of the GitHub repo, following the README quickstart word for word (with `CLAUDE_CONFIG_DIR` and `CODEX_HOME` pointed at empty folders, since agents here may not read real logs): `npm install`, `npm run build`, `serve` (empty state), `npm run demo`, `npm test` (103 pass), `npm run test:e2e` (4 pass), `scripts/screenshots.mjs` (no console errors or sideways scroll), and every CLI command and error path on the fixtures. Everything in the quickstart worked; these were wrong:

- Cost: a Claude model newer than its pricing row was billed at an older version's rates. `claude-opus-4-9` (no row) was priced as `claude-opus-4` at $15/$75, three times the current Opus rate, and the code comment claimed the opposite. A `-N` or `-NN` right after a key now means another version ("not priced", add a row), while a date (`-20250514`) still matches. Test added (fails without the fix); the old test that expected `claude-opus-4-10` to get `claude-opus-4` prices was changed.
- `npm run demo` on a later day kept the previous run's 7 Codex sessions next to the new ones (39 sessions, not 32), because Codex files go in day folders. The script now empties `.demo` first (only that folder).
- README: the "Command line" section showed `tracelens …` before saying how to get that command (after the quickstart it is `node dist/src/cli.js …`, or `npm link`). It now says so first, and warns that `npx tracelens` would run an unrelated npm package that owns the name. The roadmap's npm item says publishing needs another name.

### Notes for the next person (round 9)

- Previous gaps re-checked: the Codex second-opinion review was tried again and hit the usage limit again ("try again at 9:32 AM"). The live page re-sending the whole transcript is a documented design limit, not a bug. Only Chromium is installed for Playwright here, so Safari and Firefox remain untested.
- Unverified suspicion, not acted on: newer Claude Code versions may write record types such as `progress` (hook, tool and subagent progress) often enough to fill a transcript with collapsed "Unrecognized event" rows. tracelens shows them raw by design; if a real user reports it, skip or summarise that type like `file-history-snapshot`. Not changed because no documented or captured shape was available.
- `tracelens list --limit 0` lists 20 (0 counts as "not given"); left as is.

### Changed (round 8, performance and accessibility pass)

Measured first on synthetic data only: the 32 demo sessions, and a 118 MB set of 5,000 copies of them in 80 project folders plus one session with 20,000 tool calls (26 MB page). Chromium via Playwright 1.65.1 on this Mac, axe-core 4.10.3 (WCAG 2.0/2.1/2.2 A and AA plus best practices) on every page at 1280px and 390px in both themes, with every `<details>` closed and again with all open.

- Accessibility (axe at 390px found two rules; now none on any page, width or theme):
  - Tables that scroll sideways on phones (insights) and code/tool-output blocks (scroll past 30rem) take keyboard focus (`tabindex="0"`; insights tables are also named regions), so they can be scrolled without a mouse in browsers that do not focus scrollers by themselves (Safari).
  - The transcript's time links were 18px tall on phones; now 24px (WCAG 2.2 target size).
- Reflow: at 320px (400% zoom) a long project path made the Project select wider than the window, so the session list and insights scrolled sideways by about 200px. The select now shrinks. New E2E test opens every fixture page at 320px with all tool calls open and a long project option added (checked: it fails without the fix).
- Faster long transcripts: top-level transcript rows use `content-visibility:auto` (screen only, so printing is unchanged: same page count and PDF bytes as before). The 20,000-call session loads in 2.3 s instead of 3.9 s (Chromium DOMContentLoaded, 3 runs each). Hash links deep into the page and the live view's jump to the new end were checked to still land in view.
- Insights page: which pricing row a model uses is remembered per loaded table; the scan over all 41 keys was about two thirds of the page's time. 5,000 sessions: 180 ms to about 95 ms per load.
- Removed: `assets/logo.png` (referenced nowhere) and the transcript renderer's unused `link` option.

Baseline numbers kept for the next round (5,000-session set, local server, warm unless noted): server listens after ~50 ms; first session list 0.8 s (parses all files), then ~60 ms (3.2 MB HTML, 58k DOM nodes, Chromium load 0.5 s); search ~80 ms; a 304 poll of a live page ~35 ms; 20,000-call session page ~180 ms on the server; redacted HTML export of it ~750 ms; parsed sessions take ~70 MB of heap for 118 MB of logs. A live page with 2,000 tool calls updates without a long task over 60 ms; "Expand all" there takes ~100 ms (10,000 calls: ~380 ms).

### Notes for the next person (round 8)

- Reported gaps re-checked; none is a bug fixable here: list and insights pages are not live (a feature); the Codex multi-request tier is a limit of what the log records; the Codex parser has still not seen a real rollout; files over 2 GiB are still skipped (no real session is near that); private vulnerability reporting is a repo setting for the owner.
- Not changed on purpose: pages are not gzip-compressed (the server is on 127.0.0.1, so transfer is not the cost; parsing is); the CSS is inlined in every page (~10 KB). A live page re-downloads and swaps the whole transcript when the log grows, which stays cheap up to a few thousand tool calls; an incremental update would be the next step for huge running sessions. SEO does not apply: the UI only runs on 127.0.0.1.
- The Codex second-opinion review could not run this round (usage limit reached); the checks above were run by hand in Chromium instead.

### Added (round 7, feature: live session pages)

- A session page follows a running session. Any session with activity in the last hour shows "Live" next to the export form and re-checks its log every 2 seconds while the tab is visible. When the log grows, the header (duration, tokens, cost, errors) and the transcript are swapped in place: tool calls and thinking blocks you opened stay open (matched by the log's timestamp, since item numbers shift when subagent steps arrive), new ones arrive collapsed, and if you were at the bottom the page scrolls to the new end. Chosen after using the demo: the one thing you could not do was keep a session open next to a running agent.
- Session pages send an `ETag` and answer `If-None-Match` with `304 Not Modified` while the session's files keep their size and modification time, so polling costs a directory scan and a stat, not a render. The ETag carries a per-process random salt, so a restarted server (perhaps with another pricing file) never answers an old ETag with 304.
- The Content-Security-Policy now allows `connect-src 'self'` (the page fetching itself); everything else is unchanged.
- Fixed before release, from a Codex review of the change: the new ETag was kept before the new page was read, so a body cut off mid-transfer left the page stale until the log changed again; and open/closed state was matched by timestamp alone, so a subagent step with the same timestamp as an open tool call could take over its state (keys are now per subagent).
- Tests: a server test for the ETag/304/live marker, and an E2E test that appends to a session file while Chromium has it open and checks the new step appears, an opened tool call stays open, and a subagent step with the same timestamp does not take over its state (checked: with the open-state restore or the per-subagent key removed, it fails).

### Added (round 7, long-prompt price tiers)

- Cost estimates now apply long-prompt price tiers, a gap listed since round 4. A `pricing.json` row may have a `longContext` block (`above` plus the five rates); a request whose prompt (input + cache writes + cache reads) is over `above` tokens is priced entirely at those rates. Filled in: `claude-haiku-5-5` above 100,000 tokens (Anthropic's pricing page, checked 2026-11-22; other current Claude models bill the whole 1M window at base rates), and gpt-5.4, gpt-5.5, gpt-5.6-*, gpt-6-*, gpt-6.1-*, gpt-6.2-* above 272,000 tokens (OpenAI's pricing page, checked 2026-11-22; the page says ">272K" without defining K or what counts, so 272,000 input tokens including cached ones is an assumption). Invalid `longContext` blocks are rejected with the field name.
- Codex: each usage step remembers the prompt size of its last request (`last_token_usage.input_tokens`), and the tier is decided from that, because one step's delta can cover several requests (two 200K requests are not one 400K prompt). Known limit, from a Codex review: such a step gets its last request's tier for all its tokens; the log holds nothing finer.

### Notes for the next person (round 7)

- Not done: the session list and insights pages do not update by themselves (reload them). A line still being written shows as "Unreadable line" until the next poll completes it, which can now flash for 2 seconds on a live page. A session idle for over an hour is not live; reload once it becomes active again.
- Each poll still calls `Store.sessions()`, which rescans every log folder (as every page load does). Fine for thousands of files; a store that stats only the session's own files would be the next step if it is ever slow.
- Previous round's gaps, re-checked: none of them is a bug that can be fixed here. The Codex parser still has not seen a real rollout (agents here may not open real logs); streaming of files over 2 GiB and the initial-load `reveal()` in Chromium are unchanged (long-context price tiers are now done, see above); private vulnerability reporting is a repo setting left to the owner.

### Added (round 6, launch pass)

- README: one-line pitch, a hero image (`assets/hero.png`, generated with Codex), a 14-second demo GIF (`docs/demo.gif`) recorded from the running demo, a comparison with ccusage, claude-code-log, Claude Code's own `--resume` and OpenTelemetry export, and LLM tracing platforms, a "Known limits" section, and an updated roadmap.
- `scripts/demo-gif.mjs`: re-records the demo GIF with Playwright and ffmpeg from a running server.
- `CONTRIBUTING.md`, `SECURITY.md`, and issue forms for bugs, unrecognized log records (asks for the record's shape with made-up values, never a real log) and feature ideas. New repo label `log-format`.
- Tests for two gaps the last round left open: a session file over 2 GiB (a sparse file, so no disk is used) is skipped with a warning while the other sessions load; and the E2E test now catches a broken `app.js` `reveal()` in Chromium by closing the `<details>` and firing `hashchange` without a navigation (checked: with `reveal()` disabled the test fails).

### Fixed (round 6, from a Codex review of the README's claims against the code)

- `export -o` wrote into a log folder when the file name started with `..` (`~/.claude/projects/..report.md`): the read-only guard took any relative path starting with `..` as outside the folder.
- Assistant `content` that is an object instead of a list was silently dropped; it is now shown raw, like any unknown block.
- Search missed tool input as shown on the page when it held backslashes or quotes (`C:\work\x`, `say "hi"`): it searched the JSON-escaped text.
- Codex: `Exit code: -1` and JSON-text output with `"success": false` were counted as successful calls.
- README and SECURITY said the server accepts only GET; it accepts GET and HEAD. README now says text blocks over 40,000 characters are cut on the page (with a note), not in exports.

### Notes for the next person (round 6)

- The Codex review also noted that the E2E test cannot catch the removal of the initial `reveal()` call on page load, because Chromium opens the `<details>` itself on a fresh load with a hash. Only the `hashchange` path is covered; Firefox/WebKit are not installed here.

- Repo description now mentions Codex; topics `codex`, `codex-cli`, `anthropic`, `llm` added. Private vulnerability reporting is off on the repo, so `SECURITY.md` falls back to "open an issue asking for a contact". Turning it on (repo Settings, Security) is the owner's call. The hero image would also work as the repo's social preview, which can only be set in the web UI.
- Still open: the Codex parser has never seen a real rollout log (agents here may not open real logs; the new issue form is how real shapes should arrive). Long-context price tiers are not modelled. Files over 2 GiB are skipped, not streamed.
- The scratchpad folder is shared with other agents: keep PID files and temp output in a subfolder of your own.

### Fixed (round 5, reliability pass: each bug reproduced, then a failing test, then the fix)

- A single record nested 100,000 levels deep made its whole session disappear ("Maximum call stack size exceeded"). Records nested more than 200 levels deep are now shown as an "Unreadable line"; the same check covers Codex `function_call` arguments, which are a JSON string parsed later.
- A timestamp in the year 9999 made the insights page loop until the server ran out of memory ("10000-01-01" sorts before "9999-12-31"). Timestamps outside 2000-2099 are ignored, which also keeps junk dates from stretching durations and charts.
- Session files over 512 MB were skipped ("Cannot create a string longer than…"). Lines are now split from the bytes, so files up to 2 GB load; the raw text of a line is only kept when it cannot be parsed.
- Redacted exports failed with a 500 when one string held an unbroken run of several million characters (a base64url blob): the secret patterns overflowed the regex backtrack stack. Such a string is now replaced whole by a "too long to check for secrets" note: over-redacted, never leaked.
- A byte-order mark at the start of a log made line 1 unreadable (no title, no project), and one at the start of `pricing.json` (Windows Notepad) stopped tracelens from starting.
- Titles and one-line labels could cut an emoji in half and show "�".
- A Codex `session_meta` id holding a lone surrogate made the whole session list return 500; ids taken from inside a rollout must now be plain ids (letters, digits, `_`, `.`, `-`, not starting with `.`), else the file-name id is kept. "." and ".." are refused because browsers fold them out of the URL.
- Token counts of a trillion or more (e.g. `1e308`) are ignored instead of making every cost `$Infinity`.
- `export -o` on a case-insensitive disk (macOS, Windows): `-o log.JSONL` overwrote `log.jsonl` when the log was opened by path, and `-o ~/.CLAUDE/projects/x.md` wrote into the log folder. The `.jsonl` check ignores case and paths are compared with the native realpath. `-o x.HTML` / `x.htm` now export HTML.
- `tracelens list` printed escape sequences from prompts straight to the terminal (window title, colours, OSC 52 clipboard writes); control characters are dropped.

### Added (round 5)

- Codex archived sessions: `archived_sessions/` next to the sessions folder is read too (only when `--codex-dir` is named `sessions`, as the default is), and `export -o` refuses to write into it.
- `npm run test:e2e`: a Playwright test that starts `tracelens serve` from the CLI on the fixtures and walks the main journey in Chromium (list, sort, session, failing tool call, search into a subagent step, insights, redacted Markdown download). CI runs it in its own job. `npm test` stays browser-free (~2 s).
- `test/robustness.test.ts` collects this round's odd-input cases. `TRACELENS_SLOW_TESTS=1 npm test` adds the 600 MB file case.

### Notes for the next person (round 5)

- How the bugs were found: a hand-made set of nasty files (empty, whitespace-only, BOM, CRLF, scalars, deep nesting, junk values, emoji titles, odd ids and folder names, DST-spanning and far-future dates, 20 MB tool output) pushed through `list`, every server page and both exports; a throwaway mutation fuzzer (1,500 mutated copies of the fixtures per seed, 5 seeds, through parse, every renderer, redaction, search and insights; not kept); the suite run under other time zones; and a Codex review (`codex exec -s read-only`) of the round's diff, which found the "."/".." ids and the nested Codex arguments.
- Checked and fine: daily buckets across DST changes (Santiago, Lord Howe, Havana, Tehran) and the skipped day in Apia 2011; CRLF line endings; symlinked log roots; an empty or missing log folder on every page; port in use; a 20,000-call session (server renders in 45 ms, Chromium loads the 20 MB page in about 2 s). The suite pins `TZ=UTC` on purpose: under UTC+14 two insights tests fail because the fixture days shift, which is the intended local-day behaviour, not a bug.
- Codex format: every event and item type name tracelens handles was checked to be present in the strings of the installed Codex CLI binary (0.171.0-alpha), including `archived_sessions`. Still never run on a real rollout log. Codex `history.jsonl` (the prompt history) is deliberately not read: it holds no transcripts. The long-context price tier is still not modelled (documented in `pricing.json`).
- Known, not fixed: in Chromium the hash link from a search hit opens the surrounding `<details>` by itself, so the E2E test cannot tell whether `app.js` `reveal()` still works; other browsers rely on it. Files over 2 GB should still be skipped with a warning (Node's `readFileSync` refuses them; not tried); streaming would fix it. A session whose last line is being written while you look shows it as "Unreadable line" until the next reload.

### Added (round 4, feature: Codex CLI adapter)

- Codex CLI sessions are read next to Claude Code ones: `~/.codex/sessions/YYYY/MM/DD/rollout-*.jsonl` (or `$CODEX_HOME/sessions`, or `--codex-dir <path>`). They appear in the same session list (tagged "Codex"), search, insights and exports, and `tracelens export` takes a rollout file path. New module `src/codex.ts`.
- What a Codex transcript shows: prompts, replies as Markdown, reasoning summaries, tool calls paired with their output by `call_id` and timed, failures from non-zero exit codes (plain-text `Exit code: N` / `Process exited with code N`, or the older JSON-wrapped `metadata.exit_code`, or `success: false`), `error` events in red, `turn_aborted` / compaction notes. The environment, permissions and `AGENTS.md` text Codex injects is collapsed under "Context added by Codex". `event_msg` copies of prompts, replies and commands are skipped; unknown event types are shown raw.
- Codex token usage: `token_count` totals are cumulative and often repeated, so each one counts only its growth over the previous one (falling back to `last_token_usage` if the total shrinks). Cached input is counted as cache reads.
- `apply_patch` calls count toward "Files edited most often" (relative patch paths are resolved against the session's folder), and their one-line label lists the patched files. Shell argv (`["bash","-lc","…"]`) and `cmd` arguments get readable labels.
- `pricing.json`: OpenAI list prices (gpt-5 through gpt-6.2, short-context tier), checked against OpenAI's pricing page on 2026-11-22.
- Session header and Markdown export name the agent (Claude Code or Codex).
- `npm run demo` also writes 7 synthetic Codex sessions to `.demo/codex`; `scripts/screenshots.mjs` adds `session-codex.png`.

### Changed (round 4)

- A pricing key no longer matches a model id that continues with `.<digit>`: `gpt-5` prices `gpt-5-codex` but not `gpt-5.2` (an unknown version is now "not priced" instead of silently priced as an older one).
- The `export -o` guard refuses both log folders; its message now says "a log folder".

### Notes for the next person (round 4)

- Codex second-opinion review (`codex exec -s read-only`) found six issues, all fixed and tested: JSON tool output with an `output` key but no `metadata.exit_code` was cut down to that key; an `apply_patch` that failed was counted as a success (failures now also come from `exec_command_end`/`patch_apply_end` events by `call_id`); `gpt-5.1-codex-mini` was priced as `gpt-5.1` (5x too high); a prompt written as `<task>…</task>` was hidden as injected context (only known Codex tags count now); patch paths ignored the call's `workdir`; `*** Move to:` destinations were not counted as edited files.

- Chosen because it was the top roadmap item, part of the original brief, and the one thing a Codex user could not work around. The Codex format was built from published third-party schema notes and synthetic fixtures (`test/fixtures/codex`), never from a real `~/.codex` log. First thing to do with real logs: look for "Unrecognized" rows and tool calls with no result.
- Tests never read the real Codex folder: CLI tests set `CODEX_HOME` to an empty temp path; the store only reads Codex when given a folder. Anyone running `serve`/`list` by hand without `--codex-dir` reads the real default folder, which is the point for a user but worth knowing on a shared build machine.
- Not handled: Codex `history.jsonl`, archived sessions (`~/.codex/archived_sessions`), Codex subagents/collaboration tools (shown as ordinary tool calls), the long-context price tier. `web_search_call` items show as a `web_search` tool call with no recorded result. Variants without a row of their own (`gpt-5.1-codex-max`, `gpt-5.2-codex`) are priced as their base model; `gpt-5.1-codex-mini` has its own row ($0.25/$2).
- Codex session URLs use the day folder (`/session/20/<id>`): ids are UUIDs, so they do not collide.

### Security (round 3, security pass)

- Redaction no longer takes quadratic time on long runs of characters. The email, URL-password, `key=value` and JWT patterns rescanned a run from every position, so 200 KB of crafted tool output took about 5 minutes to export with `--redact`. The web UI's export redacts by default, and the server is single-threaded, so this froze every page. The same 3.2 MB test input now takes milliseconds. Assignments nested in other values (`url: https://x?token=…`) are still found.
- Markdown links in assistant text no longer backtrack quadratically on long runs of unclosed `[a](http://` (6 s for 330 KB in the HTML export). Side effect: a URL containing `[` or `]`, such as an IPv6 literal, stays plain text.
- The server refuses cross-site and same-site requests that are not top-level navigations (Fetch Metadata: `Sec-Fetch-Site`/`-Mode`/`-Dest`). Before, any website could make `<img>`/`fetch(no-cors)` requests to `127.0.0.1:4180/search?q=…` and time the replies. Responses now also send `Cross-Origin-Opener-Policy` and `Cross-Origin-Resource-Policy: same-origin`.
- Exported HTML files carry a `Content-Security-Policy` meta tag (no scripts, no external loads), since they are opened from disk without the server's headers.

### Fixed (round 3)

- Two project folders holding the same session id each get their own page: session URLs are now `/session/<project folder>/<id>`. `tracelens export <id>` refuses an id that is in more than one folder and prints both file paths, instead of silently exporting one.
- A Markdown link whose URL contains `*` (`[x](https://host/*a*)`) keeps its URL; `<em>` used to be inserted into the href, which broke the link (it was not an injection, since quotes stay escaped).

### Notes for the next person (round 3, security pass)

- Checked and found fine: every log-controlled string (folder name, session id, summary, cwd, model, prompts, tool names/inputs/outputs, subagent id, block and event types, raw lines) stays text on every page and in the HTML export. Verified in Chromium with a hostile synthetic session (no dialogs, no injected elements) and kept as a server test. Also fine: `export -o` path guard, Content-Disposition filename, search query escaping, `npm audit` (0 vulnerabilities), CI (`contents: read`, actions pinned to SHAs that match their tags, `persist-credentials: false`), and git history (no secrets; one obviously fake private key block in a test).
- Not done: login/token for the web UI (documented in the README under "No login"). The Markdown export copies prompts and replies verbatim, so raw HTML in them is rendered by Markdown viewers that allow HTML. Tool output is fenced.
- A throwaway fuzz run (400 random malformed sessions through the parser, every renderer, redaction and search) found no crashes; it is not kept in the repo. Session URLs changed shape, so old bookmarks to `/session/<id>` now return 404.
- Codex second-opinion review (run as a plain code review; a prompt worded as a security review was refused by its content filter) found two cases the first version of the linear redaction missed: a JWT or a `scheme://user:password@` URL glued to a leading `-`. Both are fixed and tested. It found nothing else in redaction, Markdown, routing or Fetch Metadata.

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
