# yt-transcript

Colle une URL YouTube, récupère son transcript (pistes de sous-titres manuelles ou
auto-générées, avec traduction possible), puis analyse-le avec un LLM — soit via un
endpoint **OpenAI-compatible** (Ollama, vLLM, omlx…), soit **100 % localement dans
Chrome** grâce à l'API Prompt embarquée (Gemini Nano).

**Aucune dépendance** : Python stdlib uniquement côté serveur, et le frontend est
servi en statique (HTML / CSS / JS ES modules) — aucun build, aucun bundler, aucun `npm install`.

---

## Démarrage rapide

```bash
python3 app.py
# → http://localhost:8787
```

Ouvre l'URL, colle une vidéo YouTube, choisis la piste, lance la transcription, puis
clique sur un template d'analyse (raccourcis clavier `1`–`9`).

### Mode démo (sans réseau, données fictives)

```
http://localhost:8787/?fixture=1&auto=1&tpl=0
```

Transcription + analyse LLM simulées en SSE — idéal pour tester l'UI sans toucher à YouTube.

## Fonctionnalités

- **Transcript YouTube** via l'API interne Innertube (`youtubei/v1/player` → `captionTracks`
  → `timedtext?fmt=json3`) : pistes manuelles/ASR, traduction (`tlang`), horodatage.
- **Anti-ban** : cache TTL des réponses player, rate-limiter sur les appels sortants,
  rotation de clients Innertube, retry borné sur HTTP 429.
- **Deux moteurs d'analyse** (sélection ⚙) :
  - 🖥 **Serveur** — proxy SSE vers n'importe quel endpoint OpenAI-compatible ;
  - ◉ **Gemini Nano** — 100 % local dans Chrome (Prompt API), avec map-reduce pour
    dépasser la fenêtre de contexte du modèle embarqué, warm-up de santé, watchdog
    anti-silence et détection de boucles.
- **Templates personnalisables** (system prompts) stockés en `localStorage`, éditables
  dans le panneau de réglages.
- **Export** : copier le transcript, télécharger en Markdown, filtrer en direct,
  timestamps cliquables renvoyant vers YouTube.

## Architecture

```
app.py            point d'entrée (bootstrap, ~25 lignes)
config.py         configuration centralisée (env YTT_*)
server/           couche HTTP : routing pur, handler, abstractions Request/Response, SSE
youtube/          client Innertube, parsing captions, cache TTL thread-safe, rate limiter
llm/              proxy SSE vers endpoint OpenAI-compatible + listage des modèles
fixtures.py       données du mode démo (?fixture=1)
web/              frontend statique :
  index.html        page unique
  static/css/       app.css
  static/js/        ES modules : main, dom, orb, api, transcript, markdown, settings,
                    admin, llm, llm-nano (façade)
    nano/           client Gemini Nano en 4 modules testables :
                    config (constantes), guards (fonctions pures), session (streaming),
                    runner (warm-up + map-reduce)
tests/            29 tests Python (unittest, 100 % mocks — zero appel réseau)
tests-js/         33 tests JS (node --test, LanguageModel mocké)
```

Principes : séparation stricte présentation / domaine / infrastructure, fonctions pures
testables isolément, pas d'état global mutable non maîtrisé, erreurs typées.

## API HTTP

| Méthode | Route | Description |
|---------|-------|-------------|
| `GET`  | `/` | page web |
| `GET`  | `/static/…` | fichiers statiques (CSS/JS) |
| `GET`  | `/api/tracks?url=…[&fixture=1]` | pistes de sous-titres + langues de traduction |
| `GET`  | `/api/transcript?url=…[&vss=…][&tlang=…][&fixture=1]` | transcript parsé (segments horodatés) |
| `POST` | `/api/llm/models` | `{endpoint, apiKey}` → `{models: [...]}` |
| `POST` | `/api/llm` | `{endpoint, apiKey, model, system, user}` → stream SSE `chat/completions` |

Toutes les réponses carry `Cache-Control: no-store`. Les erreurs JSON : `{"error": "…"}`.

## Configuration (variables d'environnement)

| Variable | Défaut | Rôle |
|----------|--------|------|
| `YTT_HOST` / `YTT_PORT` | `127.0.0.1` / `8787` | interface et port d'écoute |
| `YTT_PLAYER_TTL` | `300` | TTL du cache des réponses player YouTube (s) |
| `YTT_PLAYER_CACHE_MAX` | `200` | plafond du cache player |
| `YTT_YT_MIN_INTERVAL` | `1.5` | espacement minimum entre deux appels sortants vers YouTube (s, anti-ban) |
| `YTT_HTTP_TIMEOUT` | `30` | timeout des requêtes HTTP génériques (s) |
| `YTT_LLM_TIMEOUT` | `300` | timeout du stream LLM (s) |
| `YTT_LLM_MODELS_TIMEOUT` | `15` | timeout du listage des modèles (s) |
| `YTT_CAPTION_RETRY_DELAY` | `3` | délai entre deux essais sur HTTP 429 (s) |

## Tests

```bash
python3 -m unittest discover -s tests -v   # 29 tests Python, mocks uniquement
node --test tests-js/                       # 33 tests JS (Node ≥ 18)
```

Aucun test ne fait d'appel réseau réel : `http_json` est mocké, `LanguageModel` est injecté.

## Sécurité & vie privée

- Mode **Gemini Nano** : tout reste dans le navigateur, aucune donnée ne sort.
- Mode **serveur** : le transcript transite vers l'endpoint que vous configurez (le vôtre).
- Le backend n'écrit aucun log de requête (`log_message` neutralisé) et ne stocke rien.
- Garde-fou injecté dans chaque system prompt : le contenu de la transcription est traité
  comme une donnée non fiable (pas d'injection d'instructions).

## Licence

MIT © 2026 Wiscale
