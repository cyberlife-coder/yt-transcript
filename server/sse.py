"""Helpers Server-Sent Events (SSE)."""
import json


def sse_chunk(obj: dict) -> bytes:
    return b"data: " + json.dumps(obj).encode() + b"\n\n"


SSE_DONE = b"data: [DONE]\n\n"

SSE_HEADERS = {
    "Content-Type": "text/event-stream; charset=utf-8",
    "Cache-Control": "no-store",
}
