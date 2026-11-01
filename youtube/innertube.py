"""Client YouTube Innertube — player API et extraction des pistes de sous-titres.

Chaîne : youtubei/v1/player → captionTracks → timedtext?fmt=json3
"""
import json
import re
import time
import urllib.error
import urllib.request
from typing import Optional
from urllib.parse import quote

from config import (
    INNERTUBE_PLAYER_URL,
    INNERTUBE_CLIENTS,
    HTTP_TIMEOUT,
    CAPTION_MAX_RETRIES,
    CAPTION_RETRY_DELAY,
    VID_RE,
    VID_BARE_RE,
)
from youtube.cache import TTLCache
from youtube.ratelimit import RateLimiter

# Rate limiter global : espacement des appels sortants vers YouTube
# (anti-ban IP — configurable via YTT_YT_MIN_INTERVAL en secondes).
import os as _os
_yt_limiter = RateLimiter(float(_os.environ.get("YTT_YT_MIN_INTERVAL", "1.5")))


class YouTubeError(Exception):
    """Erreur métier YouTube (vidéo illisible, anti-bot, etc.)."""


class NoCaptionsError(LookupError):
    """La vidéo n'a aucune piste de sous-titres."""


def video_id(url: str) -> Optional[str]:
    """Extrait l'ID vidéo (11 car.) d'une URL YouTube ou d'un ID nu."""
    m = VID_RE.search(url.strip())
    if m:
        return m.group(1)
    s = url.strip()
    return s if VID_BARE_RE.fullmatch(s) else None


def http_json(url: str, data: bytes = None, headers=None,
              timeout: int = HTTP_TIMEOUT):
    req = urllib.request.Request(url, data=data, headers=headers or {})
    with urllib.request.urlopen(req, timeout=timeout) as r:
        return json.loads(r.read().decode())


# Cache partagé pour toutes les requêtes player
_player_cache = TTLCache()


def innertube_player(vid: str) -> dict:
    """Récupère la réponse player pour une vidéo, avec cache TTL et
    repli sur plusieurs variantes client Innertube."""
    cached = _player_cache.get(vid)
    if cached is not None:
        return cached

    last: Exception = RuntimeError("aucune variante client n'a répondu")
    for ctx, ua in INNERTUBE_CLIENTS:
        _yt_limiter.wait()  # anti-ban : espacer chaque appel sortant
        body = json.dumps({"context": {"client": ctx},
                           "videoId": vid}).encode()
        try:
            player = http_json(
                INNERTUBE_PLAYER_URL, body,
                {"Content-Type": "application/json", "User-Agent": ua})
        except Exception as e:
            last = e
            continue
        ps = player.get("playabilityStatus", {})
        status, reason = ps.get("status"), ps.get("reason", "")
        if status == "OK":
            _player_cache.set(vid, player)
            return player
        last = YouTubeError(
            "YouTube demande une vérification anti-bot "
            "(LOGIN_REQUIRED) — réessaie dans quelques minutes"
            if status == "LOGIN_REQUIRED"
            else f"vidéo non lisible : {status} {reason}")
    raise last


def caption_info(player: dict) -> dict:
    return (player.get("captions", {})
                 .get("playerCaptionsTracklistRenderer", {}))


def label_of(node) -> str:
    runs = (node or {}).get("runs") or []
    if runs:
        return "".join(r.get("text", "") for r in runs)
    return (node or {}).get("simpleText", "")


def _track_kind(track: dict) -> str:
    return "asr" if (track.get("kind") == "asr"
                     or track.get("vssId", "").startswith("a.")) else "manual"


def list_tracks(vid: str) -> dict:
    """Liste les pistes de sous-titres disponibles pour une vidéo."""
    player = innertube_player(vid)
    info = caption_info(player)
    tracks = info.get("captionTracks") or []
    if not tracks:
        raise NoCaptionsError("aucune piste de sous-titres pour cette vidéo")
    return {
        "videoId": vid,
        "title": player.get("videoDetails", {}).get("title"),
        "tracks": [{
            "vssId": t.get("vssId"),
            "code": t.get("languageCode"),
            "label": label_of(t.get("name")) or t.get("languageCode"),
            "kind": _track_kind(t),
        } for t in tracks],
        "translations": [{
            "code": t.get("languageCode"),
            "label": label_of(t.get("languageName")) or t.get("languageCode"),
        } for t in info.get("translationLanguages", [])],
    }


def fetch_transcript(vid: str, vss_id: str = None,
                     tlang: str = None) -> dict:
    """Télécharge le transcript d'une piste (format json3) et le parse."""
    player = innertube_player(vid)
    tracks = caption_info(player).get("captionTracks") or []
    if not tracks:
        raise NoCaptionsError("aucune piste de sous-titres pour cette vidéo")
    track = next((t for t in tracks if t.get("vssId") == vss_id), tracks[0])

    base = re.sub(r"[&?]fmt=[^&]*", "", track["baseUrl"])
    url = base + ("&" if "?" in base else "?") + "fmt=json3"
    if tlang:
        url += "&tlang=" + quote(tlang)

    caps = None
    last_err: Exception = None
    for attempt in range(CAPTION_MAX_RETRIES):
        _yt_limiter.wait()  # anti-ban : espacer aussi les appels timedtext
        try:
            caps = http_json(url)
            break
        except urllib.error.HTTPError as e:
            last_err = e
            if e.code != 429 or attempt == CAPTION_MAX_RETRIES - 1:
                if e.code == 429:
                    raise YouTubeError(
                        "YouTube bloque temporairement cette IP (HTTP 429, "
                        "anti-abuse). Attends quelques minutes — la "
                        "traduction (tlang) est encore plus throttlée")
                raise
            time.sleep(CAPTION_RETRY_DELAY)
    if caps is None:
        raise last_err

    segs = []
    for e in caps.get("events", []):
        if not e.get("segs"):
            continue
        text = "".join(s.get("utf8", "") for s in e["segs"]).strip()
        if text and text != "\n":
            segs.append({
                "start": e.get("tStartMs", 0) / 1000,
                "duration": e.get("dDurationMs", 0) / 1000,
                "text": text})
    return {
        "videoId": vid,
        "title": player.get("videoDetails", {}).get("title"),
        "language": track.get("languageCode"),
        "translated": tlang or None,
        "kind": _track_kind(track),
        "segments": segs,
    }
