"""Library folder, item, tag and retrieval schemas."""

from __future__ import annotations

from pydantic import BaseModel, Field, field_validator

from app.schemas.common import ORMModel, UTCDateTime


class FolderCreate(BaseModel):
    name: str = Field(min_length=1, max_length=120)
    parent_id: str | None = None


class FolderUpdate(BaseModel):
    name: str | None = Field(default=None, min_length=1, max_length=120)
    parent_id: str | None = None


class FolderOut(ORMModel):
    id: str
    name: str
    parent_id: str | None = None
    created_at: UTCDateTime
    updated_at: UTCDateTime
    item_count: int = 0


class TagOut(ORMModel):
    id: str
    name: str
    created_at: UTCDateTime


class ItemCreate(BaseModel):
    title: str = Field(min_length=1, max_length=240)
    kind: str = Field(default="note", pattern="^(note|document|web|chat|answer|spreadsheet|image)$")
    description: str = Field(default="", max_length=4000)
    content_text: str | None = Field(default=None, max_length=400_000)
    folder_id: str | None = None
    file_id: str | None = None
    tags: list[str] = Field(default_factory=list, max_length=20)
    source_type: str | None = Field(default=None, max_length=32)
    source_id: str | None = Field(default=None, max_length=36)
    metadata_json: dict = Field(default_factory=dict)

    @field_validator("tags")
    @classmethod
    def _clean_tags(cls, value: list[str]) -> list[str]:
        cleaned: list[str] = []
        for tag in value:
            tag = tag.strip()[:64]
            if tag and tag.lower() not in {t.lower() for t in cleaned}:
                cleaned.append(tag)
        return cleaned[:20]


class ItemUpdate(BaseModel):
    title: str | None = Field(default=None, min_length=1, max_length=240)
    description: str | None = Field(default=None, max_length=4000)
    content_text: str | None = Field(default=None, max_length=400_000)
    folder_id: str | None = None
    tags: list[str] | None = None
    is_favorite: bool | None = None
    metadata_json: dict | None = None

    @field_validator("tags")
    @classmethod
    def _clean_tags(cls, value: list[str] | None) -> list[str] | None:
        if value is None:
            return None
        cleaned: list[str] = []
        for tag in value:
            tag = tag.strip()[:64]
            if tag and tag.lower() not in {t.lower() for t in cleaned}:
                cleaned.append(tag)
        return cleaned[:20]


class ItemOut(ORMModel):
    id: str
    title: str
    kind: str
    description: str
    content_text: str | None = None
    folder_id: str | None = None
    file_id: str | None = None
    source_type: str | None = None
    source_id: str | None = None
    is_favorite: bool
    metadata_json: dict = Field(default_factory=dict)
    tags: list[str] = Field(default_factory=list)
    chunk_count: int = 0
    created_at: UTCDateTime
    updated_at: UTCDateTime


class ItemListOut(BaseModel):
    items: list[ItemOut]
    total: int
    limit: int
    offset: int
    has_more: bool


class LibrarySearchHit(BaseModel):
    id: str
    title: str
    kind: str
    snippet: str
    updated_at: UTCDateTime


class ChunkOut(BaseModel):
    id: str
    chunk_index: int
    content: str
    page_number: int | None = None
    token_estimate: int = 0


class ReindexResponse(BaseModel):
    item_id: str
    chunks: int
    status: str
    message: str
