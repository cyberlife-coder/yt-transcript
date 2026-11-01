# yt-transcript

Colle une URL YouTube, obtiens le transcript (pistes de sous-titres) et analyse-le
avec un LLM — soit via un endpoint OpenAI-compatible (Ollama, vLLM, …), soit
100 % localement dans Chrome via l'API Prompt (Gemini Nano embarqué).

**Python stdlib uniquement**, zéro dépendance. Le frontend est servi en statique
(HTML/CSS/JS ES modules, aucun build).

## Lancer

```bash
python3 app.py
# → http://localhost:8787
```

Mode démo sans réseau (données fictives) :

```
http://localhost:8787/?fixture=1&auto=1&tpl=0
```

## Fonctionnement

- **Transcript** : chaîne `youtubei/v1/player` → `captionTracks` → `timedtext?fmt=json3`,
  avec cache TTL, rate-limiter anti-ban et rotation de clients Innertube.
- **Analyse** : templates de system prompt personnalisables (⚙), exécutés par le
  moteur choisi — serveur (SSE streamé) ou Gemini Nano local (map-reduce pour
  dépasser la fenêtre de contexte du modèle embarqué).

## Architecture

```
app.py            bootstrap
config.py         configuration (env YTT_*)
server/           couche HTTP (routing, handler, SSE)
youtube/          client Innertube + cache TTL + rate limiter
llm/              proxy SSE OpenAI-compatible
fixtures.py       mode démo
web/              frontend statique (index.html + static/css + static/js)
tests/            tests Python (unittest, 100 % mocks)
tests-js/         tests JS (node --test, LanguageModel mocké)
```

## Tests

```bash
python3 -m unittest discover -s tests   # 29 tests, aucun appel réseau
node --test tests-js/                   # 33 tests, API LanguageModel mockée
```

## Configuration (variables d'environnement)

| Variable | Défaut | Rôle |
|----------|--------|------|
| `YTT_PORT` | `8787` | port d'écoute |
| `YTT_HOST` | `127.0.0.1` | interface |
| `YTT_PLAYER_TTL` | `300` | TTL du cache player (s) |
| `YTT_YT_MIN_INTERVAL` | `1.5` | espacement min entre appels YouTube (s, anti-ban) |
