# Contributing to tracelens

Thanks for helping. Bug reports, unrecognized log records and small, focused pull requests are the most useful contributions.

## Setup

Needs Node.js 22 or newer.

```sh
npm install
npm test            # build, then the node:test suite (~2 s, no browser)
npm run typecheck
npm run demo        # synthetic data on http://127.0.0.1:4180
```

The end-to-end test drives Chromium through Playwright:

```sh
npx playwright install chromium   # once
npm run test:e2e
```

CI runs `npm test` on Node 22 and 24, a CLI smoke test, and the end-to-end test. A pull request should pass all of them.

## Rules

- **Never commit a real log.** Fixtures in `test/fixtures` and the demo data in `scripts/demo-data.ts` are made up by hand. If a real record broke tracelens, write a synthetic one with the same shape: same field names and types, invented values, no real paths, prompts, names, emails or keys.
- **Parser changes come with a test.** Add the odd record to a fixture or to `test/robustness.test.ts`, show it failing, then fix it. Unknown input must be shown raw, never crash or drop a session.
- **Read-only stays read-only.** Nothing may write to, move or lock a log file, and the server stays bound to 127.0.0.1 with no outbound requests.
- **No runtime dependencies.** tracelens uses Node's standard library only. A new dependency needs a strong reason in the pull request.
- **Keep the README honest.** Document only what works, and add a line to `CHANGELOG.md` under `[Unreleased]`.

## Adding a log format

See "Adding another log format" in the README. `src/codex.ts` is a complete example: a `discover(dir)` that lists session files and a `parse(files)` that returns the `Session` type from `src/types.ts`.

## Screenshots and the demo GIF

They come from the running demo, never from real logs:

```sh
npm run demo -- --no-open
node scripts/screenshots.mjs http://127.0.0.1:4180
node scripts/demo-gif.mjs http://127.0.0.1:4180   # needs ffmpeg
```
