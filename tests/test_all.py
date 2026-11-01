"""Tests unitaires — 100% mocks, aucun appel réseau réel vers YouTube.

Lancer : python3 -m unittest discover -s tests -v
"""
import json
import unittest
from unittest.mock import patch, MagicMock

from youtube.cache import TTLCache
from youtube.ratelimit import RateLimiter
from youtube import innertube
from youtube.innertube import video_id, YouTubeError, NoCaptionsError
from youtube.captions import parse_json3_events, track_kind, label_of
from llm import proxy as llm_proxy
from server.request import Request, Response


class TestVideoId(unittest.TestCase):
    def test_watch_url(self):
        self.assertEqual(video_id("https://www.youtube.com/watch?v=dQw4w9WgXcQ"), "dQw4w9WgXcQ")

    def test_short_url(self):
        self.assertEqual(video_id("https://youtu.be/dQw4w9WgXcQ"), "dQw4w9WgXcQ")

    def test_shorts(self):
        self.assertEqual(video_id("https://www.youtube.com/shorts/dQw4w9WgXcQ"), "dQw4w9WgXcQ")

    def test_bare_id(self):
        self.assertEqual(video_id("dQw4w9WgXcQ"), "dQw4w9WgXcQ")

    def test_invalid(self):
        self.assertIsNone(video_id("https://example.com"))
        self.assertIsNone(video_id(""))


class TestTTLCache(unittest.TestCase):
    def test_set_get(self):
        c = TTLCache(ttl=60)
        c.set("k", "v")
        self.assertEqual(c.get("k"), "v")

    def test_miss(self):
        c = TTLCache(ttl=60)
        self.assertIsNone(c.get("nope"))

    def test_expiry(self):
        c = TTLCache(ttl=0)
        c.set("k", "v")
        import time
        time.sleep(0.01)
        self.assertIsNone(c.get("k"))

    def test_max_size_clears(self):
        c = TTLCache(ttl=60, max_size=2)
        c.set("a", 1)
        c.set("b", 2)
        c.set("c", 3)  # dépasse → clear
        self.assertEqual(len(c), 1)


class TestRateLimiter(unittest.TestCase):
    def test_spacing(self):
        import time
        rl = RateLimiter(min_interval=0.1)
        t0 = time.monotonic()
        rl.wait()
        rl.wait()
        self.assertGreaterEqual(time.monotonic() - t0, 0.09)


class TestCaptionsParsing(unittest.TestCase):
    def test_parse_json3(self):
        caps = {"events": [
            {"tStartMs": 1000, "dDurationMs": 500, "segs": [{"utf8": "Hello "}, {"utf8": "world"}]},
            {"tStartMs": 2000, "dDurationMs": 300, "segs": [{"utf8": "\n"}]},  # ignoré
            {"tStartMs": 3000, "dDurationMs": 100},  # sans segs → ignoré
        ]}
        segs = parse_json3_events(caps)
        self.assertEqual(len(segs), 1)
        self.assertEqual(segs[0]["text"], "Hello world")
        self.assertEqual(segs[0]["start"], 1.0)

    def test_track_kind(self):
        self.assertEqual(track_kind({"kind": "asr"}), "asr")
        self.assertEqual(track_kind({"vssId": "a.en"}), "asr")
        self.assertEqual(track_kind({"vssId": ".fr"}), "manual")

    def test_label_of(self):
        self.assertEqual(label_of({"runs": [{"text": "a"}, {"text": "b"}]}), "ab")
        self.assertEqual(label_of({"simpleText": "x"}), "x")
        self.assertEqual(label_of(None), "")


class TestInnertubeMocked(unittest.TestCase):
    """Tous les appels HTTP sont mockés — zero réseau."""

    def setUp(self):
        innertube._player_cache.clear()
        # rate limiter instantané pour les tests
        innertube._yt_limiter._min = 0

    @patch("youtube.innertube.http_json")
    def test_player_ok(self, mock_http):
        mock_http.return_value = {
            "playabilityStatus": {"status": "OK"},
            "videoDetails": {"title": "Test"},
            "captions": {"playerCaptionsTracklistRenderer": {"captionTracks": [
                {"vssId": ".fr", "languageCode": "fr", "name": {"simpleText": "Français"}},
            ]}},
        }
        tracks = innertube.list_tracks("dQw4w9WgXcQ")
        self.assertEqual(tracks["videoId"], "dQw4w9WgXcQ")
        self.assertEqual(len(tracks["tracks"]), 1)
        self.assertEqual(tracks["tracks"][0]["kind"], "manual")

    @patch("youtube.innertube.http_json")
    def test_player_login_required(self, mock_http):
        mock_http.return_value = {"playabilityStatus": {"status": "LOGIN_REQUIRED"}}
        with self.assertRaises(YouTubeError):
            innertube.innertube_player("dQw4w9WgXcQ")

    @patch("youtube.innertube.http_json")
    def test_no_captions(self, mock_http):
        mock_http.return_value = {
            "playabilityStatus": {"status": "OK"},
            "captions": {"playerCaptionsTracklistRenderer": {"captionTracks": []}},
        }
        with self.assertRaises(NoCaptionsError):
            innertube.list_tracks("dQw4w9WgXcQ")


class TestLLMProxy(unittest.TestCase):
    def test_normalize_base(self):
        self.assertEqual(llm_proxy.normalize_base("http://x:8000"), "http://x:8000/v1")
        self.assertEqual(llm_proxy.normalize_base("http://x:8000/v1"), "http://x:8000/v1")
        self.assertEqual(llm_proxy.normalize_base("http://x:8000/v1/"), "http://x:8000/v1")
        self.assertIsNone(llm_proxy.normalize_base("pas-une-url"))
        self.assertIsNone(llm_proxy.normalize_base(""))

    def test_sse_chunk(self):
        chunk = llm_proxy.sse_chunk({"a": 1})
        self.assertTrue(chunk.startswith(b"data: "))
        self.assertTrue(chunk.endswith(b"\n\n"))
        self.assertIn(b'"a": 1', chunk)


class TestRequestResponse(unittest.TestCase):
    def test_request_q1(self):
        req = Request("GET", "/api/tracks", {"url": ["abc"], "fixture": ["1"]})
        self.assertEqual(req.q1("url"), "abc")
        self.assertIsNone(req.q1("missing"))
        self.assertTrue(req.has("fixture"))
        self.assertFalse(req.has("nope"))

    def test_response_json(self):
        r = Response.json(200, {"ok": True})
        self.assertEqual(r.status, 200)
        self.assertIn("application/json", r.content_type)
        self.assertEqual(json.loads(r.body), {"ok": True})

    def test_response_error(self):
        r = Response.error(404, "nope")
        self.assertEqual(r.status, 404)
        self.assertEqual(json.loads(r.body), {"error": "nope"})


class TestServerRouting(unittest.TestCase):
    """Routing testé sans handler brut — routes GET uniquement + fixture."""

    def test_index(self):
        from server import app as router
        req = Request("GET", "/", {})
        resp = router.route(req)
        self.assertEqual(resp.status, 200)
        self.assertIn(b"<html", resp.body)

    def test_static_css(self):
        from server import app as router
        req = Request("GET", "/static/css/app.css", {})
        resp = router.route(req)
        self.assertEqual(resp.status, 200)
        self.assertIn("text/css", resp.content_type)

    def test_static_traversal_blocked(self):
        from server import app as router
        req = Request("GET", "/static/../../etc/passwd", {})
        resp = router.route(req)
        self.assertEqual(resp.status, 404)

    def test_api_tracks_fixture(self):
        from server import app as router
        req = Request("GET", "/api/tracks", {"fixture": ["1"], "url": ["x"]})
        resp = router.route(req)
        self.assertEqual(resp.status, 200)
        data = json.loads(resp.body)
        self.assertEqual(data["videoId"], "dQw4w9WgXcQ")

    def test_api_transcript_fixture(self):
        from server import app as router
        req = Request("GET", "/api/transcript", {"fixture": ["1"], "url": ["x"]})
        resp = router.route(req)
        self.assertEqual(resp.status, 200)
        data = json.loads(resp.body)
        self.assertGreater(len(data["segments"]), 0)

    def test_api_llm_models_fixture(self):
        from server import app as router
        req = Request("POST", "/api/llm/models", {}, {"fixture": True})
        resp = router.route(req)
        self.assertEqual(resp.status, 200)
        self.assertIn("fixture-7b", json.loads(resp.body)["models"])

    def test_404(self):
        from server import app as router
        req = Request("GET", "/nope", {})
        resp = router.route(req)
        self.assertEqual(resp.status, 404)

    def test_invalid_url(self):
        from server import app as router
        req = Request("GET", "/api/tracks", {"url": ["pas-une-url-valide-123"]})
        resp = router.route(req)
        self.assertEqual(resp.status, 400)


if __name__ == "__main__":
    unittest.main()
