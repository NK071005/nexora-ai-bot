"""Shared schema helpers, UTC serialization and pagination."""

from __future__ import annotations

from datetime import datetime, timezone
from typing import Annotated, Any, Generic, TypeVar
from urllib.parse import urlparse

from pydantic import BaseModel, ConfigDict, Field, PlainSerializer


def _iso_utc(value: datetime | None) -> str | None:
    if value is None:
        return None
    if value.tzinfo is None:
        value = value.replace(tzinfo=timezone.utc)
    else:
        value = value.astimezone(timezone.utc)
    return value.isoformat().replace("+00:00", "Z")


UTCDateTime = Annotated[datetime, PlainSerializer(_iso_utc, return_type=str | None)]
T = TypeVar("T")


class ORMModel(BaseModel):
    model_config = ConfigDict(from_attributes=True, populate_by_name=True)


class PageMeta(BaseModel):
    total: int
    limit: int
    offset: int
    has_more: bool = False


class Page(BaseModel, Generic[T]):
    items: list[T]
    meta: PageMeta


class OkResponse(BaseModel):
    ok: bool = True
    message: str = ""


class ErrorBody(BaseModel):
    code: str
    message: str
    request_id: str | None = None
    details: Any | None = None


class ErrorResponse(BaseModel):
    error: ErrorBody


def domain_of(url: str) -> str:
    try:
        return urlparse(url).netloc.lower().removeprefix("www.")
    except Exception:
        return ""


class Citation(BaseModel):
    title: str
    url: str
    domain: str = ""
    snippet: str = ""
    published_at: str | None = None
    index: int = 0


class PaginationParams(BaseModel):
    limit: int = Field(default=20, ge=1, le=100)
    offset: int = Field(default=0, ge=0)
