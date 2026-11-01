"""Données de démonstration — mode sans réseau (?fixture=1)."""

FIXTURE_TRACKS = {
    "videoId": "dQw4w9WgXcQ",
    "title": "Fixture — Comment YouTube expose ses sous-titres",
    "tracks": [
        {"vssId": ".fr", "code": "fr", "label": "Français", "kind": "manual"},
        {"vssId": "a.en", "code": "en", "label": "Anglais (générés automatiquement)", "kind": "asr"},
        {"vssId": ".en", "code": "en", "label": "Anglais", "kind": "manual"},
    ],
    "translations": [
        {"code": "en", "label": "Anglais"}, {"code": "es", "label": "Espagnol"},
        {"code": "de", "label": "Allemand"}, {"code": "pt", "label": "Portugais"},
    ],
}

_FIX_SEG_TEXT = (
    "Bienvenue dans cette démo. Aujourd'hui on regarde comment YouTube expose "
    "ses pistes de sous-titres via l'API interne Innertube. D'abord on appelle "
    "youtubei/v1/player avec un contexte client, ce qui retourne la liste des "
    "captionTracks disponibles. Chaque piste a un vssId unique : les pistes "
    "manuelles commencent par un point, les automatiques par 'a'. Ensuite on "
    "télécharge le contenu via timedtext au format json3, qui donne des events "
    "horodatés. Pour traduire, il suffit d'ajouter le paramètre tlang. Attention "
    "au rate limiting : YouTube renvoie 429 si on insiste. Et voilà, c'est "
    "tout pour cette démo, merci d'avoir regardé."
).split(". ")


def fixture_transcript():
    segs, t = [], 0.0
    for s in _FIX_SEG_TEXT:
        d = 2.0 + len(s) / 40.0
        segs.append({"start": t, "duration": d,
                     "text": s.strip() + ("." if not s.endswith(".") else "")})
        t += d + 0.3
    return {"videoId": "dQw4w9WgXcQ",
            "title": "Fixture — Comment YouTube expose ses sous-titres",
            "language": "fr", "translated": None, "kind": "manual",
            "segments": segs}


FIXTURE_THINK = (
    "La transcription parle de l'API Innertube, des captionTracks, du format "
    "json3 et du paramètre tlang. Je vais structurer un résumé avec les points "
    "techniques principaux et une note sur les limites."
)

FIXTURE_ANSWER = """\
## Résumé

La vidéo explique comment YouTube expose ses **sous-titres** via l'API interne
*Innertube*, et comment les récupérer localement.

### Étapes clés

1. Appeler `youtubei/v1/player` avec un contexte client.
2. Lire `captions.playerCaptionsTracklistRenderer.captionTracks`.
3. Télécharger la piste via `timedtext?fmt=json3` — events horodatés.

### Bon à savoir

- pistes manuelles : `vssId` commençant par `.`
- pistes automatiques : `kind="asr"` (préfixe `a.`)
- traduction possible avec le paramètre `tlang`

> Attention : ces endpoints sont privés et YouTube applique un
> rate limiting agressif (HTTP 429).

---

```python
tracks = player["captions"]["playerCaptionsTracklistRenderer"]["captionTracks"]
```

Conclusion : pas de speech-to-text, juste du parsing de métadonnées.
"""

FIXTURE_MODELS = ["fixture-7b", "fixture-70b"]
