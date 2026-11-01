#!/usr/bin/env python3
"""Mini serveur : colle une URL YouTube, obtiens le transcript (pistes de sous-titres).

Usage : python3 app.py  →  http://localhost:8787
Stdlib uniquement.

Architecture :
  config.py          — configuration centralisée (env YTT_*)
  server/            — couche HTTP (routing, handler, SSE)
  youtube/           — client Innertube + cache TTL + rate limiter
  llm/               — proxy SSE vers endpoint OpenAI-compatible
  fixtures.py        — mode démo sans réseau (?fixture=1)
  web/               — frontend statique (HTML/CSS/JS ES modules)

Mode démo : http://localhost:8787/?fixture=1&auto=1&tpl=0
"""
from http.server import ThreadingHTTPServer

from config import HOST, PORT
from server.handler import Handler


def main():
    print(f"→ http://localhost:{PORT}")
    ThreadingHTTPServer((HOST, PORT), Handler).serve_forever()


if __name__ == "__main__":
    main()
