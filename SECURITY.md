# Security Policy

## Supported Versions

Only the latest commit on `main` is supported.

| Version | Supported |
|---------|-----------|
| latest `main` | ✅ |
| older commits | ❌ |

## Reporting a Vulnerability

**Please do not open a public issue for security vulnerabilities.**

Instead, use GitHub's private reporting:

👉 [Report a vulnerability](https://github.com/cyberlife-coder/yt-transcript/security/advisories/new)

You can expect an acknowledgement within 72 hours.

## What counts as a vulnerability here

- Exposure of secrets (API keys, tokens) in code or history
- Server-side request forgery or path traversal in `server/app.py` static file serving
- Injection into the LLM system prompt beyond the documented guardrail
- XSS in the rendered transcript or LLM output (`web/static/js/markdown.js` escapes input —
  regressions here matter)
- Anything that could leak the content of a private video transcript

## What does *not* count

- The fact that the app queries YouTube's internal Innertube API (unofficial by design;
  the app already rate-limits and rotates clients to respect it)
- Demo mode (`?fixture=1`) behavior
- Denial of service against the local single-user server (it binds to `127.0.0.1` by default)

## Scope notes

- The server binds to `127.0.0.1` by default; exposing it beyond localhost
  (`YTT_HOST=0.0.0.0`) is at your own risk — it has no authentication.
- In **server LLM mode**, transcripts are sent to the endpoint you configure;
  only use endpoints you trust.
- In **Gemini Nano mode**, nothing leaves the browser.
