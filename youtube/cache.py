"""Cache TTL thread-safe pour les réponses Innertube player."""
import threading
import time
from typing import Any, Optional


class TTLCache:
    """Cache en mémoire avec expiration par entrée et plafond de taille.

    Thread-safe (lock interne) — le serveur HTTP est multithread.
    """

    def __init__(self, ttl: int = 300, max_size: int = 200):
        self._ttl = ttl
        self._max = max_size
        self._data: dict[str, tuple[float, Any]] = {}
        self._lock = threading.Lock()

    def get(self, key: str) -> Optional[Any]:
        with self._lock:
            entry = self._data.get(key)
            if entry is None:
                return None
            ts, value = entry
            if time.time() - ts > self._ttl:
                del self._data[key]
                return None
            return value

    def set(self, key: str, value: Any) -> None:
        with self._lock:
            if len(self._data) >= self._max and key not in self._data:
                self._data.clear()
            self._data[key] = (time.time(), value)

    def clear(self) -> None:
        with self._lock:
            self._data.clear()

    def __len__(self) -> int:
        with self._lock:
            return len(self._data)
