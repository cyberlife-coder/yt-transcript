"""Abstractions Request/Response pour découpler le routing du transport HTTP."""
import json
from urllib.parse import urlparse, parse_qs


class Request:
    """Requête HTTP normalisée (GET ou POST JSON)."""

    def __init__(self, method: str, path: str, query: dict[str, list[str]],
                 body: dict | None = None, raw_body: bytes = b""):
        self.method = method
        self.path = path
        self.query = query
        self.body = body or {}
        self.raw_body = raw_body

    @classmethod
    def from_handler(cls, handler) -> "Request":
        u = urlparse(handler.path)
        n = int(handler.headers.get("Content-Length") or 0)
        raw = handler.rfile.read(n) if n else b""
        try:
            body = json.loads(raw or b"{}")
        except json.JSONDecodeError:
            body = {}
        return cls(handler.command, u.path, parse_qs(u.query), body, raw)

    def q1(self, key: str, default=None):
        """Premier valeur d'un paramètre query."""
        v = self.query.get(key)
        return v[0] if v else default

    def has(self, key: str) -> bool:
        return key in self.query


class Response:
    """Réponse HTTP simple."""

    def __init__(self, status: int, body, content_type: str = "text/html; charset=utf-8"):
        self.status = status
        self.body = body if isinstance(body, bytes) else str(body).encode()
        self.content_type = content_type

    @classmethod
    def json(cls, status: int, obj) -> "Response":
        return cls(status, json.dumps(obj), "application/json")

    @classmethod
    def text(cls, status: int, msg: str) -> "Response":
        return cls(status, msg, "text/plain")

    @classmethod
    def error(cls, status: int, msg: str) -> "Response":
        return cls.json(status, {"error": msg})
