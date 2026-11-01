"""Handler HTTP brut — pont entre BaseHTTPRequestHandler et server.app.route()."""
from http.server import BaseHTTPRequestHandler

from server.request import Request
from server import app as router


class Handler(BaseHTTPRequestHandler):
    def _dispatch(self):
        req = Request.from_handler(self)
        resp = router.route(req, raw_handler=self)
        if resp is None:
            return  # stream SSE déjà écrit directement
        self.send_response(resp.status)
        self.send_header("Content-Type", resp.content_type)
        self.send_header("Content-Length", str(len(resp.body)))
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        self.wfile.write(resp.body)

    def do_GET(self):
        self._dispatch()

    def do_POST(self):
        self._dispatch()

    def log_message(self, fmt, *args):
        pass
