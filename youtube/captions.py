"""YouTube — extraction et parsing des pistes de sous-titres.

Séparé du client Innertube pour isoler la logique de parsing JSON
qui pourrait évoluer (nouveaux formats, normalisation, etc.).
"""
from typing import Optional


def label_of(node) -> str:
    """Extrait le texte d'un nœud {runs:[…]} ou {simpleText:…}."""
    runs = (node or {}).get("runs") or []
    if runs:
        return "".join(r.get("text", "") for r in runs)
    return (node or {}).get("simpleText", "")


def track_kind(track: dict) -> str:
    """'asr' pour les pistes auto-générées, 'manual' sinon."""
    return "asr" if (track.get("kind") == "asr"
                     or track.get("vssId", "").startswith("a.")) else "manual"


def parse_json3_events(caps: dict) -> list[dict]:
    """Parse les events timedtext fmt=json3 en segments {start, duration, text}."""
    segs = []
    for e in caps.get("events", []):
        if not e.get("segs"):
            continue
        text = "".join(s.get("utf8", "") for s in e["segs"]).strip()
        if text and text != "\n":
            segs.append({
                "start": e.get("tStartMs", 0) / 1000,
                "duration": e.get("dDurationMs", 0) / 1000,
                "text": text,
            })
    return segs


def build_track_payload(vid: str, player: dict, tracks: list,
                        translations: list) -> dict:
    return {
        "videoId": vid,
        "title": player.get("videoDetails", {}).get("title"),
        "tracks": [{
            "vssId": t.get("vssId"),
            "code": t.get("languageCode"),
            "label": label_of(t.get("name")) or t.get("languageCode"),
            "kind": track_kind(t),
        } for t in tracks],
        "translations": [{
            "code": t.get("languageCode"),
            "label": label_of(t.get("languageName")) or t.get("languageCode"),
        } for t in translations],
    }


def build_transcript_payload(vid: str, player: dict, track: dict,
                             tlang: Optional[str], segs: list) -> dict:
    return {
        "videoId": vid,
        "title": player.get("videoDetails", {}).get("title"),
        "language": track.get("languageCode"),
        "translated": tlang or None,
        "kind": track_kind(track),
        "segments": segs,
    }
