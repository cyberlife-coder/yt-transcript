"""Application HTTP — routing pur, délègue aux modules métier.

Routes :
  GET  /                     → page web (HTML + static)
  GET  /static/…             → fichiers statiques (CSS, JS)
  GET  /api/tracks?url=…     → pistes de sous-titres
  GET  /api/transcript?url=…&vss=…&tlang=…  → transcript json3 parsé
  POST /api/llm/models       → liste des modèles LLM
  POST /api/llm              → proxy SSE chat completions
"""
import json
import time
import urllib.error
from pathlib import Path

from server.request import Request, Response
from server import sse
from youtube import innertube
from youtube.innertube import YouTubeError, NoCaptionsError, video_id
from llm import proxy as llm_proxy
from llm.proxy import LLMError
import fixtures

WEB_DIR = Path(__file__).resolve().parent.parent / "web"

_STATIC_TYPES = {
    ".css": "text/css; charset=utf-8",
    ".js": "text/javascript; charset=utf-8",
    ".html": "text/html; charset=utf-8",
    ".svg": "image/svg+xml",
    ".png": "image/png",
    ".ico": "image/x-icon",
}


def _serve_index() -> Response:
    html = (WEB_DIR / "index.html").read_text(encoding="utf-8")
    return Response(200, html)


def _serve_static(rel: str) -> Response:
    # protection path traversal
    root = (WEB_DIR / "static").resolve()
    target = (root / rel).resolve()
    if not str(target).startswith(str(root)) or not target.is_file():
        return Response.text(404, "not found")
    ctype = _STATIC_TYPES.get(target.suffix, "application/octet-stream")
    return Response(200, target.read_bytes(), ctype)


def _api_tracks(req: Request) -> Response:
    if req.has("fixture"):
        return Response.json(200, fixtures.FIXTURE_TRACKS)
    vid = video_id(req.q1("url", ""))
    if not vid:
        return Response.error(400, "URL YouTube invalide")
    try:
        return Response.json(200, innertube.list_tracks(vid))
    except NoCaptionsError as e:
        return Response.error(404, str(e))
    except urllib.error.HTTPError as e:
        return Response.error(502, f"YouTube a répondu HTTP {e.code}")
    except Exception as e:
        return Response.error(502, str(e))


def _api_transcript(req: Request) -> Response:
    if req.has("fixture"):
        return Response.json(200, fixtures.fixture_transcript())
    vid = video_id(req.q1("url", ""))
    if not vid:
        return Response.error(400, "URL YouTube invalide")
    try:
        return Response.json(200, innertube.fetch_transcript(
            vid, req.q1("vss"), req.q1("tlang")))
    except NoCaptionsError as e:
        return Response.error(404, str(e))
    except urllib.error.HTTPError as e:
        return Response.error(502, f"YouTube a répondu HTTP {e.code}")
    except Exception as e:
        return Response.error(502, str(e))


def _api_llm_models(req: Request) -> Response:
    if req.body.get("fixture"):
        return Response.json(200, {"models": fixtures.FIXTURE_MODELS})
    try:
        ids = llm_proxy.list_models(req.body.get("endpoint", ""),
                                    req.body.get("apiKey", ""))
        return Response.json(200, {"models": ids})
    except LLMError as e:
        return Response.error(502, str(e))


def handle_llm_stream(req: Request, raw_handler) -> None:
    """Stream SSE — écrit directement sur le wfile du handler brut.

    raw_handler est le BaseHTTPRequestHandler (accès à wfile/send_response).
    """
    body = req.body
    if body.get("fixture"):
        _sse_fixture(raw_handler)
        return
    try:
        upstream = llm_proxy.open_chat_stream(
            body.get("endpoint", ""), body.get("apiKey", ""),
            body.get("model", ""), body.get("system", ""), body.get("user", ""))
    except LLMError as e:
        # Erreur avant le début du stream : réponse JSON classique
        raw_handler.send_response(502)
        payload = json.dumps({"error": str(e)}).encode()
        raw_handler.send_header("Content-Type", "application/json")
        raw_handler.send_header("Content-Length", str(len(payload)))
        raw_handler.send_header("Cache-Control", "no-store")
        raw_handler.end_headers()
        raw_handler.wfile.write(payload)
        return

    raw_handler.send_response(200)
    for k, v in sse.SSE_HEADERS.items():
        raw_handler.send_header(k, v)
    raw_handler.end_headers()
    try:
        def _write(b):
            raw_handler.wfile.write(b)
            raw_handler.wfile.flush()
        llm_proxy.relay_stream(upstream, _write)
    except (BrokenPipeError, ConnectionError):
        pass
    except Exception as e:
        try:
            raw_handler.wfile.write(sse.sse_chunk({"choices": [{"delta": {
                "content": f"\n[erreur stream : {e}]"}}]}))
        except Exception:
            pass
    finally:
        upstream.close()
        raw_handler.close_connection = True


def _sse_fixture(raw_handler) -> None:
    raw_handler.send_response(200)
    for k, v in sse.SSE_HEADERS.items():
        raw_handler.send_header(k, v)
    raw_handler.end_headers()
    try:
        for i in range(0, len(fixtures.FIXTURE_THINK), 40):
            raw_handler.wfile.write(sse.sse_chunk({"choices": [{"delta": {
                "reasoning": fixtures.FIXTURE_THINK[i:i + 40]}}]}))
        for i in range(0, len(fixtures.FIXTURE_ANSWER), 24):
            raw_handler.wfile.write(sse.sse_chunk({"choices": [{"delta": {
                "content": fixtures.FIXTURE_ANSWER[i:i + 24]}}]}))
            raw_handler.wfile.flush()
            time.sleep(0.008)
        raw_handler.wfile.write(sse.SSE_DONE)
    except (BrokenPipeError, ConnectionError):
        pass
    finally:
        raw_handler.close_connection = True


def route(req: Request, raw_handler=None) -> Response | None:
    """Route une requête. Retourne une Response, ou None si streamée
    directement via raw_handler (POST /api/llm hors fixture)."""
    if req.method == "GET":
        if req.path == "/":
            return _serve_index()
        if req.path.startswith("/static/"):
            return _serve_static(req.path[len("/static/"):])
        if req.path == "/api/tracks":
            return _api_tracks(req)
        if req.path == "/api/transcript":
            return _api_transcript(req)
        return Response.text(404, "not found")

    if req.method == "POST":
        if req.path == "/api/llm/models":
            return _api_llm_models(req)
        if req.path == "/api/llm":
            if raw_handler is not None:
                handle_llm_stream(req, raw_handler)
                return None
            return Response.error(500, "stream non supporté sans handler brut")
        return Response.text(404, "not found")

    return Response.text(405, "method not allowed")
