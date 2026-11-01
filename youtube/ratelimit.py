"""Rate limiter simple pour les appels sortants vers YouTube.

Un token par appel : garantit un espacement minimum entre deux requêtes
vers youtube.com / youtubei, indépendamment du nombre de threads.
"""
import threading
import time


class RateLimiter:
    def __init__(self, min_interval: float = 1.0):
        self._min = min_interval
        self._last = 0.0
        self._lock = threading.Lock()

    def wait(self) -> None:
        with self._lock:
            now = time.monotonic()
            delta = now - self._last
            if delta < self._min:
                time.sleep(self._min - delta)
            self._last = time.monotonic()
