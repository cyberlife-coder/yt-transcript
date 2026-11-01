"""Configuration centralisée — constantes et variables d'environnement.

Toute valeur magique du projet vit ici. Surcharger via variables
d'environnement préfixées YTT_ (ex: YTT_PORT=9000).
"""
import os


def _env_int(name: str, default: int) -> int:
    try:
        return int(os.environ.get(name, str(default)))
    except ValueError:
        return default


# --- serveur ---------------------------------------------------------------
HOST = os.environ.get("YTT_HOST", "127.0.0.1")
PORT = _env_int("YTT_PORT", 8787)

# --- cache Innertube -------------------------------------------------------
PLAYER_CACHE_TTL = _env_int("YTT_PLAYER_TTL", 300)   # secondes
PLAYER_CACHE_MAX = _env_int("YTT_PLAYER_CACHE_MAX", 200)

# --- réseau ----------------------------------------------------------------
HTTP_TIMEOUT = _env_int("YTT_HTTP_TIMEOUT", 30)       # secondes
LLM_TIMEOUT = _env_int("YTT_LLM_TIMEOUT", 300)
LLM_MODELS_TIMEOUT = _env_int("YTT_LLM_MODELS_TIMEOUT", 15)
CAPTION_RETRY_DELAY = _env_int("YTT_CAPTION_RETRY_DELAY", 3)
CAPTION_MAX_RETRIES = 3

# --- YouTube Innertube -----------------------------------------------------
INNERTUBE_PLAYER_URL = "https://www.youtube.com/youtubei/v1/player"

# Variantes client Innertube : YouTube flague un couple IP+client de façon
# intermittente (LOGIN_REQUIRED / ERROR) — on enchaîne les variantes.
INNERTUBE_CLIENTS = [
    ({"clientName": "ANDROID", "clientVersion": "20.10.38",
      "androidSdkVersion": 30, "hl": "fr", "gl": "FR"},
     "com.google.android.youtube/20.10.38 (Linux; U; Android 11) gzip"),
    ({"clientName": "ANDROID", "clientVersion": "20.12.46",
      "androidSdkVersion": 34, "hl": "fr", "gl": "FR"},
     "com.google.android.youtube/20.12.46 (Linux; U; Android 14) gzip"),
]

# --- regex -----------------------------------------------------------------
import re

VID_RE = re.compile(
    r"(?:youtube\.com/(?:watch\?[^#]*v=|shorts/|embed/|live/|v/)|youtu\.be/)([\w-]{11})"
)
VID_BARE_RE = re.compile(r"^[\w-]{11}$")
