import time
import threading
from typing import Dict, List

from app.logger import logger
from app.notion_client import NotionOpusAPI

class AccountPool:
    def __init__(self, accounts: List[dict]):
        """
        Initialize from a list of dicts; each dict is one set of credentials.
        Also create client instances and their state.
        """
        if not accounts:
            raise ValueError("Account pool init failed: no account configuration provided.")
            
        self.clients = [NotionOpusAPI(acc) for acc in accounts]
        # Cooldown-until timestamp per client (0 = available)
        self.cooldown_until = [0.0 for _ in self.clients]
        
        # Round-robin index
        self._current_index = 0
        self._lock = threading.Lock()
        
    def get_client(self, wait_if_cooling: bool = True) -> NotionOpusAPI:
        """
        Return the next available client (round-robin).
        Skip clients that are still cooling down.

        If wait_if_cooling=True (default), when every account is cooling,
        wait for the nearest cooldown to end instead of raising.
        """
        now = time.time()
        with self._lock:
            start_index = self._current_index
            
            while True:
                idx = self._current_index
                # Past cooldown → available
                if self.cooldown_until[idx] <= now:
                    # Advance round-robin
                    self._current_index = (self._current_index + 1) % len(self.clients)
                    return self.clients[idx]
                    
                # Skip unavailable
                self._current_index = (self._current_index + 1) % len(self.clients)
                
                # If a full cycle found no available client
                if self._current_index == start_index:
                    next_available = min(self.cooldown_until)
                    wait_seconds = max(0.5, next_available - now)

                    if wait_if_cooling and wait_seconds <= 15:
                        # Wait for cooldown then retry
                        logger.info(
                            f"All accounts cooling, waiting {wait_seconds:.1f}s",
                            extra={
                                "request_info": {
                                    "event": "account_pool_wait_cooling",
                                    "wait_seconds": round(wait_seconds, 1),
                                }
                            },
                        )
                        # Release the lock before sleep so other threads can proceed
                        self._lock.release()
                        try:
                            time.sleep(wait_seconds)
                        finally:
                            self._lock.acquire()
                        # Refresh time and rescan
                        now = time.time()
                        continue

                    raise RuntimeError(
                        f"All accounts are cooling down. Retry in {max(1, int(wait_seconds))} seconds."
                    )

    def get_status_summary(self) -> Dict[str, int]:
        """Return a short account-pool status for health checks and logs."""
        now = time.time()
        with self._lock:
            active = sum(1 for ts in self.cooldown_until if ts <= now)
            cooling = len(self.cooldown_until) - active
            return {
                "total": len(self.clients),
                "active": active,
                "cooling": cooling,
            }
                    
    def mark_failed(self, client: NotionOpusAPI, cooldown_seconds: int = 3):
        """
        Mark a client as temporarily unavailable (default 3s cooldown).
        """
        with self._lock:
            try:
                idx = self.clients.index(client)
                # Record when the cooldown ends
                self.cooldown_until[idx] = time.time() + cooldown_seconds
                logger.warning(
                    "Account marked as failed",
                    extra={
                        "request_info": {
                            "event": "account_failed",
                            "account": client.account_key,
                            "space_id": client.space_id,
                            "cooldown_seconds": cooldown_seconds,
                        }
                    },
                )
            except ValueError:
                logger.warning(
                    "Attempted to mark unknown account as failed",
                    extra={"request_info": {"event": "account_failed_unknown"}},
                )
