# yt-transcript

Paste a YouTube URL, get its transcript (manual or auto-generated caption tracks,
with optional translation), then analyze it with an LLM — either through an
**OpenAI-compatible endpoint** (Ollama, vLLM, omlx…) or **100 % locally in Chrome**
via the built-in Prompt API (on-device Gemini Nano).

**Zero dependencies**: Python standard library only on the server side, and the
frontend is served as static files (HTML / CSS / JS ES modules) — no build step,
no bundler, no `npm install`.

---

## Quick start

```bash
python3 app.py
# → http://localhost:8787
```

Open the URL, paste a YouTube video, pick a caption track, run the transcription,
then click an analysis template (keyboard shortcuts `1`–`9`).

### Demo mode (no network, fixture data)

```
http://localhost:8787/?fixture=1&auto=1&tpl=0
```

Transcription + LLM analysis simulated over SSE — ideal for trying the UI without
touching YouTube.

## Features

- **YouTube transcripts** via the internal Innertube API (`youtubei/v1/player` →
  `captionTracks` → `timedtext?fmt=json3`): manual/ASR tracks, translation (`tlang`),
  timestamps.
- **Anti-ban safeguards**: TTL cache for player responses, rate limiter on outgoing
  calls, Innertube client rotation, bounded retry on HTTP 429.
- **Two analysis engines** (switch in ⚙):
  - 🖥 **Server** — SSE proxy to any OpenAI-compatible endpoint;
  - ◉ **Gemini Nano** — fully local in Chrome (Prompt API), with map-reduce to exceed
    the on-device model's context window, health warm-up, anti-silence watchdog and
    loop detection.
- **Customizable templates** (system prompts) persisted in `localStorage`, editable
  in the settings panel.
- **Export**: copy the transcript, download as Markdown, live filtering, clickable
  timestamps linking back to YouTube.

## Architecture

```
app.py            entry point (bootstrap, ~25 lines)
config.py         centralized configuration (YTT_* env vars)
server/           HTTP layer: pure routing, handler, Request/Response abstractions, SSE
youtube/          Innertube client, caption parsing, thread-safe TTL cache, rate limiter
llm/              SSE proxy to an OpenAI-compatible endpoint + model listing
fixtures.py       demo-mode data (?fixture=1)
web/              static frontend:
  index.html        single page
  static/css/       app.css
  static/js/        ES modules: main, dom, orb, api, transcript, markdown, settings,
                    admin, llm, llm-nano (facade)
    nano/           Gemini Nano client in 4 testable modules:
                    config (constants), guards (pure functions), session (streaming),
                    runner (warm-up + map-reduce)
tests/            29 Python tests (unittest, 100 % mocked — zero network calls)
tests-js/         33 JS tests (node --test, LanguageModel injected/mocked)
```

Design principles: strict presentation / domain / infrastructure separation, pure
functions tested in isolation, no uncontrolled mutable global state, typed errors.

## HTTP API

| Method | Route | Description |
|--------|-------|-------------|
| `GET`  | `/` | web page |
| `GET`  | `/static/…` | static assets (CSS/JS) |
| `GET`  | `/api/tracks?url=…[&fixture=1]` | caption tracks + translation languages |
| `GET`  | `/api/transcript?url=…[&vss=…][&tlang=…][&fixture=1]` | parsed transcript (timed segments) |
| `POST` | `/api/llm/models` | `{endpoint, apiKey}` → `{models: [...]}` |
| `POST` | `/api/llm` | `{endpoint, apiKey, model, system, user}` → SSE stream of `chat/completions` |

All responses carry `Cache-Control: no-store`. JSON errors: `{"error": "…"}`.

## Configuration (environment variables)

| Variable | Default | Purpose |
|----------|---------|---------|
| `YTT_HOST` / `YTT_PORT` | `127.0.0.1` / `8787` | bind interface and port |
| `YTT_PLAYER_TTL` | `300` | TTL of cached YouTube player responses (s) |
| `YTT_PLAYER_CACHE_MAX` | `200` | player cache size cap |
| `YTT_YT_MIN_INTERVAL` | `1.5` | minimum spacing between outgoing calls to YouTube (s, anti-ban) |
| `YTT_HTTP_TIMEOUT` | `30` | generic HTTP timeout (s) |
| `YTT_LLM_TIMEOUT` | `300` | LLM stream timeout (s) |
| `YTT_LLM_MODELS_TIMEOUT` | `15` | model listing timeout (s) |
| `YTT_CAPTION_RETRY_DELAY` | `3` | delay between retries on HTTP 429 (s) |

## Tests

```bash
python3 -m unittest discover -s tests -v   # 29 Python tests, mocks only
node --test tests-js/                       # 33 JS tests (Node ≥ 18)
```

No test performs a real network call: `http_json` is mocked, `LanguageModel` is injected.

## Security & privacy

- **Gemini Nano mode**: everything stays in the browser, nothing leaves the device.
- **Server mode**: the transcript is sent to the endpoint you configure (your own).
- The backend writes no request logs (`log_message` is neutralized) and stores nothing.
- A guardrail is appended to every system prompt: the transcript content is treated as
  untrusted data (no instruction injection).

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md). By participating, you agree to the
[Code of Conduct](CODE_OF_CONDUCT.md).

## Security reports

See [SECURITY.md](SECURITY.md) — please do not open public issues for vulnerabilities.

## Changelog

See [CHANGELOG.md](CHANGELOG.md).

## License

[MIT](LICENSE) © 2026 Wiscale
