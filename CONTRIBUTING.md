# Contributing to yt-transcript

Thanks for your interest in contributing! This project is a small, dependency-free
tool: Python standard library on the server, vanilla ES modules on the frontend.

## How to contribute

1. **Fork** the repo and create a branch from `main`:
   ```bash
   git checkout -b feat/my-feature
   ```
2. **Make your changes.** Keep the architecture clean:
   - server: pure routing in `server/app.py`, no I/O in route handlers beyond delegation;
   - domain logic (`youtube/`, `llm/`) stays free of HTTP concerns;
   - frontend: one ES module per responsibility under `web/static/js/`;
   - pure logic (guards, parsers) must stay importable and testable without a DOM.
3. **Add or update tests.** No test may perform a real network call — mock
   `http_json` (Python) and inject a fake `LanguageModel` (JS).
   ```bash
   python3 -m unittest discover -s tests -v
   node --test tests-js/
   ```
4. **Commit** with a clear message (imperative mood, English or French):
   `feat: …`, `fix: …`, `refactor: …`, `docs: …`, `test: …`
5. **Push** your branch and open a **Pull Request** against `main`.

## Pull request checklist

- [ ] `python3 -m unittest discover -s tests` passes (29 tests)
- [ ] `node --test tests-js/` passes (33 tests)
- [ ] `node --check` passes on every file in `web/static/js/`
- [ ] No secrets, no private IPs, no personal endpoints committed
- [ ] README updated if you changed the API, config or architecture
- [ ] No new runtime dependency (stdlib / vanilla JS only)

## Reporting bugs

Open an issue with:
- what you did (URL used — use the demo mode `?fixture=1` when possible),
- what you expected vs. what happened,
- browser/Chrome version if it involves the on-device Nano mode,
- server logs from the terminal running `python3 app.py`.

## Security vulnerabilities

Do **not** open a public issue. See [SECURITY.md](SECURITY.md).

## Code of conduct

By participating you agree to abide by the [Code of Conduct](CODE_OF_CONDUCT.md).
