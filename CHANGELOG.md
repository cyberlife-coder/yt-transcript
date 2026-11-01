# Changelog

All notable changes to this project are documented in this file.
The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added
- Public documentation set: English README, MIT `LICENSE`, `CONTRIBUTING.md`,
  `CODE_OF_CONDUCT.md`, `SECURITY.md`, this `CHANGELOG.md`.

## [0.2.0] - 2026-11-01

### Added
- Layered architecture: `config.py`, `server/` (pure routing + handler + SSE),
  `youtube/` (Innertube client, TTL cache, rate limiter, caption parsing),
  `llm/` (SSE proxy), `fixtures.py`, static frontend under `web/`.
- Gemini Nano client split into 4 testable modules (`web/static/js/nano/`):
  `config`, `guards` (pure functions), `session` (streaming + watchdog), `runner`
  (health ping + warm-up + map-reduce).
- Settings panel redesign: template cards with auto-resizing prompts (fully visible),
  character counter, "saved" feedback, reset confirmation, focus trap, ARIA roles,
  mobile single-column layout, effective system prompt preview.
- Anti-ban rate limiter on outgoing YouTube calls (`YTT_YT_MIN_INTERVAL`, default 1.5 s).
- Test suites: 29 Python unit tests (fully mocked, zero network) and 33 JS tests
  (`node --test`, mocked `LanguageModel`).

### Fixed
- Gemini Nano: message-array strategy first (string prompts with a system prompt could
  make the on-device model echo the serialized context instead of answering).
- Gemini Nano: streaming chunks are deltas on some Chrome versions — now detected and
  accumulated correctly.
- Gemini Nano: output language now passed to `availability()` as well as `create()`.
- Gemini Nano: warm-up no longer aborts the whole run on an empty sample unless the
  health ping also fails (clear `nomodel` diagnostic pointing to `chrome://on-device-internals`).
- Post-processing no longer truncates real answers containing `Model:` and never
  returns the serialized context as a fake answer.

### Changed
- Monolithic `app.py` (1262 lines with inline HTML/CSS/JS) replaced by the layered
  structure above; `app.py` is now a ~25-line bootstrap.
- Default LLM config no longer contains personal endpoints or keys.

## [0.1.0] - 2026-10-23

### Added
- Initial single-file server: YouTube transcript fetch + LLM analysis UI with inline
  HTML/CSS/JS, server and on-device (Gemini Nano) providers, demo mode.
