import os
import threading
import time
import uuid
from typing import Any, Generator, Optional

import cloudscraper
import requests
import urllib3

from app.logger import logger
from app.model_registry import get_notion_model
from app.stream_parser import parse_stream

# Disable SSL warnings
urllib3.disable_warnings(urllib3.exceptions.InsecureRequestWarning)

# Override Notion client version via env (may need updates after Notion changes)
NOTION_CLIENT_VERSION = os.getenv("NOTION_CLIENT_VERSION", "23.13.20260228.0625")

# Notion site base URL (override for mirror/proxy); default official site if unset
NOTION_URL = os.getenv("NOTION_URL", "https://www.notion.so").rstrip("/")


class NotionUpstreamError(RuntimeError):
    """Notion upstream request failed or returned invalid content."""

    def __init__(
        self,
        message: str,
        *,
        status_code: Optional[int] = None,
        retriable: bool = True,
        response_excerpt: str = "",
    ):
        super().__init__(message)
        self.status_code = status_code
        self.retriable = retriable
        self.response_excerpt = response_excerpt


class NotionOpusAPI:
    def __init__(self, account_config: dict):
        """
        Initialize the Notion client from one account config dict.
        account_config Must include token_v2, space_id, user_id, space_view_id, user_name, user_email
        """
        self.token_v2 = account_config.get("token_v2", "")
        self.space_id = account_config.get("space_id", "")
        self.user_id = account_config.get("user_id", "")
        self.space_view_id = account_config.get("space_view_id", "")
        self.user_name = account_config.get("user_name", "user")
        self.user_email = account_config.get("user_email", "")
        self.cookies = account_config.get("cookies", {})
        if not isinstance(self.cookies, dict):
            self.cookies = {}
        self.cookies["token_v2"] = self.token_v2

        self.url = f"{NOTION_URL}/api/v3/runInferenceTranscript"
        self.delete_url = f"{NOTION_URL}/api/v3/saveTransactions"
        self.account_key = self.user_email or self.user_id or "unknown-account"

        # Reuse cloudscraper instance: keep Cloudflare challenge cookies to avoid re-solving every request
        self._scraper = cloudscraper.create_scraper()
        self._scraper_lock = threading.Lock()

    def _build_cookie_header(self) -> str:
        cookie_jar = self.cookies.copy()
        cookie_jar["notion_user_id"] = self.user_id
        return "; ".join(f"{name}={value}" for name, value in cookie_jar.items() if value)

    def _to_notion_transcript(self, transcript: list[dict[str, Any]]) -> list[dict[str, Any]]:
        converted: list[dict[str, Any]] = []
        for block in transcript:
            if block.get("type") != "config":
                converted.append(block)
                continue

            value = block.get("value")
            if not isinstance(value, dict):
                converted.append(block)
                continue

            notion_block = dict(block)
            notion_value = dict(value)
            notion_value["model"] = get_notion_model(str(value.get("model", "") or ""))
            notion_block["value"] = notion_value
            converted.append(notion_block)
        return converted

    def _resolve_thread_type(self, notion_transcript: list[dict[str, Any]]) -> str:
        for block in notion_transcript:
            if block.get("type") != "config":
                continue
            value = block.get("value")
            if isinstance(value, dict):
                thread_type = str(value.get("type", "") or "").strip()
                if thread_type:
                    return thread_type
        return "workflow"

    def _resolve_request_profile(self, thread_type: str) -> dict[str, Any]:
        is_markdown_chat = thread_type == "markdown-chat"
        return {
            "thread_type": thread_type,
            "create_thread": not is_markdown_chat,
            "is_partial_transcript": is_markdown_chat,
            "precreate_thread": is_markdown_chat,
            "include_debug_overrides": True,
        }

    def _build_thread_headers(self) -> dict[str, str]:
        return {
            "content-type": "application/json",
            "cookie": self._build_cookie_header(),
            "x-notion-active-user-header": self.user_id,
            "x-notion-space-id": self.space_id,
        }

    def _create_thread(self, thread_id: str, thread_type: str) -> bool:
        payload = {
            "requestId": str(uuid.uuid4()),
            "transactions": [
                {
                    "id": str(uuid.uuid4()),
                    "spaceId": self.space_id,
                    "operations": [
                        {
                            "pointer": {"table": "thread", "id": thread_id, "spaceId": self.space_id},
                            "path": [],
                            "command": "set",
                            "args": {
                                "id": thread_id,
                                "version": 1,
                                "parent_id": self.space_id,
                                "parent_table": "space",
                                "space_id": self.space_id,
                                "created_time": int(time.time() * 1000),
                                "created_by_id": self.user_id,
                                "created_by_table": "notion_user",
                                "messages": [],
                                "data": {},
                                "alive": True,
                                "type": thread_type,
                            },
                        }
                    ],
                }
            ],
        }
        try:
            resp = requests.post(
                self.delete_url,
                json=payload,
                headers=self._build_thread_headers(),
                timeout=20,
            )
            if resp.status_code == 200:
                return True
            logger.warning(
                "Pre-create thread failed",
                extra={
                    "request_info": {
                        "event": "thread_precreate_failed",
                        "thread_id": thread_id,
                        "thread_type": thread_type,
                        "status": resp.status_code,
                    }
                },
            )
        except Exception:
            logger.warning(
                "Pre-create thread raised exception",
                exc_info=True,
                extra={
                    "request_info": {
                        "event": "thread_precreate_error",
                        "thread_id": thread_id,
                        "thread_type": thread_type,
                    }
                },
            )
        return False

    def delete_thread(self, thread_id: str) -> None:
        """
        Set thread.alive=False via saveTransactions,
        and clear chat entries from the Notion main UI.
        Designed to run on a background thread without blocking the main stream.
        """
        headers = self._build_thread_headers()
        payload = {
            "requestId": str(uuid.uuid4()),
            "transactions": [
                {
                    "id": str(uuid.uuid4()),
                    "spaceId": self.space_id,
                    "operations": [
                        {
                            "pointer": {
                                "table": "thread",
                                "id": thread_id,
                                "spaceId": self.space_id,
                            },
                            "command": "update",
                            "path": [],
                            "args": {"alive": False},
                        }
                    ],
                }
            ],
        }
        try:
            resp = requests.post(self.delete_url, json=payload, headers=headers, timeout=15)
            if resp.status_code == 200:
                logger.info(
                    "Thread auto-deleted from Notion home",
                    extra={"request_info": {"event": "thread_deleted", "thread_id": thread_id}},
                )
            else:
                logger.warning(
                    f"Thread deletion failed: HTTP {resp.status_code}",
                    extra={"request_info": {"event": "thread_delete_failed", "thread_id": thread_id, "status": resp.status_code}},
                )
        except Exception as exc:
            logger.warning(
                f"Thread deletion raised an exception: {exc}",
                extra={"request_info": {"event": "thread_delete_error", "thread_id": thread_id}},
            )

    def stream_response(self, transcript: list, thread_id: Optional[str] = None) -> Generator[dict[str, Any], None, None]:
        """
        Send a Notion API request and return a structured stream generator.
        Accepts a full transcript list as input.

        Args:
            transcript: Conversation history list
            thread_id: Optional existing thread_id. If set, reuse the thread to keep context
        """
        if not isinstance(transcript, list) or not transcript:
            raise ValueError("Invalid transcript payload: transcript must be a non-empty list.")

        notion_transcript = self._to_notion_transcript(transcript)
        thread_type = self._resolve_thread_type(notion_transcript)
        request_profile = self._resolve_request_profile(thread_type)

        # If no thread_id is provided, create one; otherwise reuse
        should_create_thread = thread_id is None
        thread_id = thread_id or str(uuid.uuid4())
        trace_id = str(uuid.uuid4())
        response = None

        # Persist thread_id for external access
        self.current_thread_id = thread_id

        if request_profile["precreate_thread"] and should_create_thread:
            if not self._create_thread(thread_id, thread_type):
                should_create_thread = True
                request_profile["create_thread"] = True
                request_profile["is_partial_transcript"] = False
        elif not should_create_thread:
            # If reusing an existing thread, do not create a new one
            request_profile["create_thread"] = False
            # Key fix: set is_partial_transcript=True，Make Notion accept client-side history
            request_profile["is_partial_transcript"] = True

        # Put cookies directly in headers, bypassing cloudscraper's cookie jar
        # (cookie jar may receive non-ASCII cookies from Cloudflare challenge and break encoding)
        cookie_header = self._build_cookie_header()

        headers = {
            "Content-Type": "application/json",
            "Accept": "application/x-ndjson",
            "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/145.0.0.0 Safari/537.36",
            "x-notion-space-id": self.space_id,
            "x-notion-active-user-header": self.user_id,
            "notion-audit-log-platform": "web",
            "notion-client-version": NOTION_CLIENT_VERSION,
            "origin": NOTION_URL,
            "referer": f"{NOTION_URL}/ai",
            "cookie": cookie_header,
        }

        payload = {
            "traceId": trace_id,
            "spaceId": self.space_id,
            "threadId": thread_id,
            "threadType": thread_type,
            "createThread": request_profile["create_thread"],
            "generateTitle": True,
            "saveAllThreadOperations": True,
            "setUnreadState": True,
            "isPartialTranscript": request_profile["is_partial_transcript"],
            "asPatchResponse": True,
            "isUserInAnySalesAssistedSpace": False,
            "isSpaceSalesAssisted": False,
            "threadParentPointer": {
                "table": "space",
                "id": self.space_id,
                "spaceId": self.space_id,
            },
            "transcript": notion_transcript,
        }
        if request_profile["include_debug_overrides"]:
            payload["debugOverrides"] = {
                "emitAgentSearchExtractedResults": True,
                "cachedInferences": {},
                "annotationInferences": {},
                "emitInferences": False,
            }

        logger.info(
            "Dispatching request to Notion upstream",
            extra={
                "request_info": {
                    "event": "notion_upstream_request",
                    "trace_id": trace_id,
                    "thread_id": thread_id,
                    "thread_type": thread_type,
                    "create_thread": bool(request_profile["create_thread"]),
                    "is_partial_transcript": bool(request_profile["is_partial_transcript"]),
                    "account": self.account_key,
                    "space_id": self.space_id,
                }
            },
        )

        try:
            with self._scraper_lock:
                scraper = self._scraper
                scraper.cookies.clear()
            response = scraper.post(
                self.url,
                headers=headers,
                json=payload,
                stream=True,
                timeout=(15, 120),
            )
            if response.status_code == 403:
                # Cloudflare challenge May expire; rebuild the scraper and retry once
                response.close()
                logger.warning(
                    "Got 403, rebuilding cloudscraper to refresh Cloudflare challenge",
                    extra={"request_info": {"event": "cloudflare_challenge_refresh", "account": self.account_key}},
                )
                new_scraper = cloudscraper.create_scraper()
                with self._scraper_lock:
                    self._scraper = new_scraper
                response = new_scraper.post(
                    self.url,
                    headers=headers,
                    json=payload,
                    stream=True,
                    timeout=(15, 120),
                )
            if response.status_code != 200:
                excerpt = (response.text or "").strip().replace("\n", " ")[:300]
                # 429 and 5xx are retriable (switch account or wait)
                retriable = response.status_code >= 500 or response.status_code == 429
                raise NotionUpstreamError(
                    f"Notion upstream returned HTTP {response.status_code}.",
                    status_code=response.status_code,
                    retriable=retriable,
                    response_excerpt=excerpt,
                )

            emitted = False
            for chunk in parse_stream(response):
                emitted = True
                yield chunk

            if not emitted:
                raise NotionUpstreamError(
                    "Notion upstream returned an empty stream.",
                    status_code=502,
                    retriable=True,
                )

            # After the stream ends, do not auto-delete the thread
            # Reason: Notion workflow mode depends on server-side conversation history
            # Deleting the thread would lose history for later requests (AI amnesia)
            # Keeping the thread alive preserves conversation context
            logger.info(
                "Thread completed and preserved for conversation context",
                extra={
                    "request_info": {
                        "event": "thread_completed_preserved",
                        "thread_id": thread_id,
                        "was_created_new": should_create_thread,
                    }
                },
            )
        except requests.exceptions.Timeout as exc:
            logger.error(f"Request timeout: {exc}", exc_info=True)
            raise NotionUpstreamError("Request to Notion upstream timed out.", retriable=True) from exc
        except requests.exceptions.RequestException as exc:
            logger.error(f"Request failed: {exc}", exc_info=True)
            # 不暴露原始异常细节给User
            raise NotionUpstreamError("Request to Notion upstream failed. Please try again later.", retriable=True) from exc
        finally:
            if response is not None:
                response.close()
