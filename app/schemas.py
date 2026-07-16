import time
from typing import Any, Dict, List, Literal, Optional, Union
from pydantic import BaseModel, Field, field_validator, model_validator


def flatten_message_content(v: Any) -> str:
    """
    Normalize OpenAI multimodal content (str | list of parts) to a plain string
    for Notion transcript (which only accepts text blocks).
    """
    if v is None:
        return ""
    if isinstance(v, str):
        return v
    if isinstance(v, list):
        parts: List[str] = []
        for item in v:
            if isinstance(item, str):
                parts.append(item)
                continue
            if not isinstance(item, dict):
                continue
            t = str(item.get("type") or "")
            if t == "text" or ("text" in item and t not in ("image_url", "image", "file")):
                parts.append(str(item.get("text") or ""))
            elif t in ("image_url", "image"):
                img = item.get("image_url") or item.get("image") or {}
                url = img.get("url") if isinstance(img, dict) else str(img or "")
                name = item.get("name") or item.get("filename") or "image"
                if isinstance(url, str) and url.startswith("data:"):
                    # Cap extremely large payloads in the string form
                    parts.append(f"\n[Attached image: {name}]\n{url}\n")
                elif url:
                    parts.append(f"\n[Attached image URL: {name}] {url}\n")
                else:
                    parts.append(f"\n[Attached image: {name}]\n")
            elif t == "file" or item.get("file"):
                f = item.get("file") if isinstance(item.get("file"), dict) else item
                name = f.get("name") or f.get("filename") or "file"
                text = f.get("text") or f.get("content") or ""
                mime = f.get("mime") or f.get("media_type") or "text/plain"
                if text:
                    parts.append(
                        f"\n[Attached file: {name} | {mime}]\n```\n{text}\n```\n"
                    )
                else:
                    parts.append(f"\n[Attached file: {name} | {mime}]\n")
        return "\n".join(p for p in parts if p)
    return str(v)


# ================================
# 请求相关 Schema (Chat Completion)
# ================================

class ChatMessage(BaseModel):
    """单条对话消息 — accepts str or OpenAI multimodal parts list."""
    role: Literal["user", "assistant", "system"]
    content: Any = ""
    thinking: Optional[str] = None

    @model_validator(mode="before")
    @classmethod
    def _flatten_content(cls, data: Any) -> Any:
        if isinstance(data, dict) and "content" in data:
            data = {**data, "content": flatten_message_content(data.get("content"))}
        return data

    @field_validator("content", mode="after")
    @classmethod
    def _ensure_str(cls, v: Any) -> str:
        return v if isinstance(v, str) else flatten_message_content(v)


class ChatCompletionRequest(BaseModel):
    """
    OpenAI-Compatible 发起完成请求的 Payload。
    保留 `conversation_id` 作为特定的扩展字段，若缺失则视为独立请求。
    """
    model: str = Field(default="claude-opus4.6", description="Requested model.")
    messages: List[ChatMessage]
    stream: bool = Field(default=False, description="Whether to stream the response as SSE.")
    temperature: Optional[float] = Field(default=None, description="Sampling temperature.")
    conversation_id: Optional[str] = Field(default=None, description="Extension for stateful conversation tracking.")


# ================================
# 非流式返回 Schema
# ================================

class ChatMessageResponseChoice(BaseModel):
    """非流式响应的选项"""
    index: int = 0
    message: ChatMessage
    finish_reason: str = "stop"


class ChatCompletionResponse(BaseModel):
    """
    OpenAI-Compatible 完整返回 Payload。
    """
    id: str
    object: str = "chat.completion"
    created: int = Field(default_factory=lambda: int(time.time()))
    model: str
    choices: List[ChatMessageResponseChoice]
    usage: Dict[str, int] = Field(
        default_factory=lambda: {"prompt_tokens": 0, "completion_tokens": 0, "total_tokens": 0}
    )
    # Standard 模式扩展字段
    search_metadata: Optional[Dict[str, Any]] = Field(default=None)


# ================================
# 流式返回 Schema (供内部组织)
# ================================

class ChatCompletionChunkDelta(BaseModel):
    """SSE Delta Block"""
    content: Optional[str] = None
    role: Optional[str] = None


class ChatCompletionChunkChoice(BaseModel):
    """SSE Choice Block"""
    index: int = 0
    delta: ChatCompletionChunkDelta
    finish_reason: Optional[str] = None


class ChatCompletionChunk(BaseModel):
    """
    OpenAI-Compatible 流式 Chunk
    """
    id: str
    object: str = "chat.completion.chunk"
    created: int = Field(default_factory=lambda: int(time.time()))
    model: str
    choices: List[ChatCompletionChunkChoice]
