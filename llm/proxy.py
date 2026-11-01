"""Proxy vers un endpoint LLM OpenAI-compatible (Ollama, omlx, vLLM, …).

Deux opérations : lister les modèles, et streamer une complétion chat
en SSE (relayée telle quelle ou synthétisée si l'upstream ignore stream:true).
"""
import json
import urllib.error
import urllib.request

from config import LLM_TIMEOUT, LLM_MODELS_TIMEOUT


class LLMError(Exception):
    """Erreur de communication avec l'endpoint LLM."""


def normalize_base(endpoint: str) -> str | None:
    """Normalise un endpoint en base /v1, ou None si invalide."""
    import re
    ep = (endpoint or "").strip().rstrip("/")
    if not re.match(r"^https?://", ep):
        return None
    return ep if ep.endswith("/v1") else ep + "/v1"


def _headers(api_key: str) -> dict:
    h = {"Content-Type": "application/json"}
    if api_key:
        h["Authorization"] = "Bearer " + api_key
    return h


def sse_chunk(obj: dict) -> bytes:
    return b"data: " + json.dumps(obj).encode() + b"\n\n"


def list_models(endpoint: str, api_key: str = "") -> list[str]:
    """Retourne la liste des IDs de modèles exposés par l'endpoint."""
    base = normalize_base(endpoint)
    if not base:
        raise LLMError("endpoint invalide (http(s)://… attendu)")
    req = urllib.request.Request(base + "/models", headers=_headers(api_key))
    try:
        with urllib.request.urlopen(req, timeout=LLM_MODELS_TIMEOUT) as r:
            data = json.loads(r.read().decode())
    except urllib.error.HTTPError as e:
        detail = e.read()[:300].decode("utf-8", "replace")
        raise LLMError(f"LLM HTTP {e.code} : {detail}")
    except Exception as e:
        raise LLMError(f"LLM injoignable : {e}")
    return [m.get("id") for m in data.get("data", []) if m.get("id")]


def open_chat_stream(endpoint: str, api_key: str, model: str,
                     system: str, user: str):
    """Ouvre un stream chat/completions upstream.

    Retourne l'objet réponse HTTP (itérable ligne par ligne si SSE).
    Lève LLMError en cas d'erreur d'ouverture.
    """
    base = normalize_base(endpoint)
    if not base:
        raise LLMError("endpoint invalide (http(s)://… attendu)")
    if not model:
        raise LLMError("modèle manquant")
    payload = {
        "model": model,
        "messages": [
            {"role": "system", "content": system or ""},
            {"role": "user", "content": user or ""},
        ],
        "stream": True,
    }
    req = urllib.request.Request(
        base + "/chat/completions",
        data=json.dumps(payload).encode(),
        headers=_headers(api_key))
    try:
        return urllib.request.urlopen(req, timeout=LLM_TIMEOUT)
    except urllib.error.HTTPError as e:
        detail = e.read()[:300].decode("utf-8", "replace")
        raise LLMError(f"LLM HTTP {e.code} : {detail}")
    except Exception as e:
        raise LLMError(f"LLM injoignable : {e}")


def relay_stream(upstream, write) -> None:
    """Relaye un stream upstream vers une fonction write(bytes).

    Si l'upstream n'est pas SSE, synthétise une réponse SSE unique.
    """
    ctype = upstream.headers.get("Content-Type", "")
    if "event-stream" in ctype:
        for line in upstream:
            write(line)
    else:
        j = json.loads(upstream.read().decode())
        txt = (j.get("choices") or [{}])[0].get(
            "message", {}).get("content", "")
        write(sse_chunk({"choices": [{"delta": {"content": txt}}]}))
        write(b"data: [DONE]\n\n")
