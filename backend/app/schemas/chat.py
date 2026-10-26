"""Chat, attachment and search schemas."""

from __future__ import annotations

from pydantic import BaseModel, Field

from app.schemas.common import Citation, ORMModel, UTCDateTime


class FileOut(ORMModel):
    id: str
    original_name: str
    mime_type: str
    size_bytes: int
    sha256: str
    kind: str
    extraction_status: str
    page_count: int | None = None
    metadata_json: dict = Field(default_factory=dict)
    created_at: UTCDateTime


class ChatCreateRequest(BaseModel):
    title: str | None = Field(default=None, max_length=200)
    model: str | None = Field(default=None, max_length=120)


class ChatUpdateRequest(BaseModel):
    title: str | None = Field(default=None, min_length=1, max_length=200)
    is_pinned: bool | None = None
    is_archived: bool | None = None
    tags: list[str] | None = None


class ChatOut(ORMModel):
    id: str
    title: str
    model: str | None = None
    is_pinned: bool
    is_archived: bool
    message_count: int
    last_message_at: UTCDateTime
    created_at: UTCDateTime
    updated_at: UTCDateTime
    tags: list[str] = Field(default_factory=list)
    preview: str | None = None


class MessageOut(ORMModel):
    id: str
    chat_id: str
    role: str
    content: str
    status: str
    provider: str | None = None
    model: str | None = None
    citations: list[Citation] = Field(default_factory=list)
    tool_activity: list[dict] = Field(default_factory=list)
    error: str | None = None
    created_at: UTCDateTime
    attachments: list[FileOut] = Field(default_factory=list)


class ChatDetailOut(BaseModel):
    chat: ChatOut
    messages: list[MessageOut]


class MessageCreateRequest(BaseModel):
    content: str = Field(default="", max_length=20000)
    attachment_ids: list[str] = Field(default_factory=list, max_length=8)
    use_search: bool = False
    use_library: bool = False
    model: str | None = Field(default=None, max_length=120)
    mode: str = Field(default="chat", pattern="^(chat|document|media)$")


class RegenerateRequest(BaseModel):
    model: str | None = None
    use_search: bool = False
    use_library: bool = False


class StopResponse(BaseModel):
    stopped: bool
    message_id: str | None = None


class ChatListResponse(BaseModel):
    items: list[ChatOut]
    total: int
    limit: int
    offset: int
    has_more: bool


class HistorySearchItem(BaseModel):
    id: str
    title: str
    snippet: str
    updated_at: UTCDateTime
    is_archived: bool
    is_pinned: bool
    match: str


class WebSearchItem(BaseModel):
    title: str
    url: str
    snippet: str
    domain: str
    published_at: str | None = None
    rank: int


class WebSearchResponse(BaseModel):
    configured: bool
    provider: str
    results: list[WebSearchItem] = Field(default_factory=list)
    message: str | None = None
