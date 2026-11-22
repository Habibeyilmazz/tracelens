# Security

tracelens reads agent logs that can hold source code, file paths and secrets, so security reports are taken seriously.

## What tracelens promises

- It only reads log files; it never writes to them. `export -o` refuses to write into a log folder or to any `.jsonl` file.
- The web UI listens on 127.0.0.1 only, accepts only GET, answers only requests addressed to `127.0.0.1`, `localhost` or `[::1]` on its own port, refuses cross-site subresource requests (Fetch Metadata), and sends a strict Content-Security-Policy.
- It makes no network requests of its own and loads nothing from the internet.
- `--redact` is pattern matching. It catches common secret shapes, not every secret: read an export before you share it.

Not promised: there is no login, so any program running on the same machine can read the web UI while `tracelens serve` runs.

## Reporting a problem

Please do not put exploit details or real log content in a public issue.

1. If the repository's **Security** tab shows **Report a vulnerability**, use it.
2. Otherwise, open an issue titled "Security contact request" with no details, and the maintainer will arrange a private channel.

Include the tracelens commit, your OS and Node version, and a synthetic log that reproduces the problem. Only the latest commit on `main` is supported.
