"""Typed agent tools with explicit permission boundaries.

The model never receives raw database or filesystem access. Each tool declares
what it touches and is only invoked after the orchestrator has resolved the
authenticated user's ownership and role.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from enum import Enum
from typing import Any, Callable

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.errors import AppError, forbidden
from app.models import ChatSession, File, LibraryItem, User
from app.services import search as search_service
from app.services.ai import AttachmentContext
from app.services.extraction import extract_text
from app.services.storage import resolve_path


class Permission(str, Enum):
    READ_OWN_FILES = "read_own_files"
    READ_OWN_LIBRARY = "read_own_library"
    READ_OWN_CHATS = "read_own_chats"
    EXTERNAL_SEARCH = "external_search"
    READ_ORG_INTERNFLOW = "read_org_internflow"
    WRITE_ORG_INTERNFLOW = "write_org_internflow"


@dataclass
class ToolSpec:
    name: str
    description: str
    permission: Permission
    input_schema: dict
    handler: Callable[..., Any]
    consequential: bool = False


@dataclass
class ToolInvocation:
    tool: str
    status: str
    summary: str
    details: dict = field(default_factory=dict)


def _load_attachments(db: Session, user: User, file_ids: list[str], org_id: str | None) -> list[AttachmentContext]:
    contexts: list[AttachmentContext] = []
    for file_id in file_ids[:8]:
        record = db.get(File, file_id)
        if record is None or record.deleted_at is not None:
            raise AppError(404, "file_not_found", "One or more attachments no longer exist.")
        if record.user_id != user.id:
            raise forbidden("You do not have access to one of the attachments.")
        if record.organization_id and org_id and record.organization_id != org_id:
            raise forbidden("An attachment belongs to a different organization context.")
        text = record.extracted_text or ""
        metadata = dict(record.metadata_json or {})
        if not text and record.extraction_status in {"pending", "unsupported", "metadata_only"}:
            try:
                result = extract_text(resolve_path(record.storage_key), record.safe_name[record.safe_name.rfind("."):])
                text = result.text
                metadata.update(result.metadata)
                record.extracted_text = text or None
                record.extraction_status = result.status
                record.metadata_json = metadata
                db.commit()
            except Exception:
                pass
        if record.kind == "image":
            metadata["path"] = str(resolve_path(record.storage_key))
        contexts.append(
            AttachmentContext(
                filename=record.original_name,
                kind=record.kind,
                text=text[:24_000],
                metadata=metadata,
            )
        )
    return contexts


def document_context(db: Session, user: User, org_id: str | None, file_ids: list[str]) -> list[AttachmentContext]:
    return _load_attachments(db, user, file_ids, org_id)


def library_hits(db: Session, user: User, query: str) -> list[dict]:
    hits = search_service.retrieve_library_context(db, user.id, query)
    if not hits:
        hits = search_service.notes_fallback(db, user.id)
    return hits


def library_note_text(hits: list[dict]) -> list[str]:
    return [f"{hit['title']}: {hit['content']}" for hit in hits]


def chat_history_search(db: Session, user: User, query: str) -> list[dict]:
    return search_service.search_chats(db, user.id, query)


def web_search(db: Session, user: User, query: str) -> tuple[list[dict], dict]:
    if not search_service.web_search_configured():
        raise AppError(
            409,
            "search_not_configured",
            "Web search is not configured. Add SEARCH_PROVIDER_API_KEY, or turn off web search to continue.",
        )
    job, results = search_service.web_search(db, user.id, query)
    return results, {"job_id": job.id, "provider": job.provider}


TOOLS: dict[str, ToolSpec] = {
    "general_chat": ToolSpec(
        name="general_chat",
        description="Answer using the conversation and bounded context.",
        permission=Permission.READ_OWN_CHATS,
        input_schema={"type": "object", "properties": {"message": {"type": "string"}}},
        handler=lambda **_: None,
    ),
    "document_analysis": ToolSpec(
        name="document_analysis",
        description="Extract and analyse text from the user's own uploaded files.",
        permission=Permission.READ_OWN_FILES,
        input_schema={
            "type": "object",
            "properties": {"file_ids": {"type": "array", "items": {"type": "string"}}},
            "required": ["file_ids"],
        },
        handler=document_context,
    ),
    "library_retrieval": ToolSpec(
        name="library_retrieval",
        description="Retrieve relevant passages from the user's own library (lexical).",
        permission=Permission.READ_OWN_LIBRARY,
        input_schema={
            "type": "object",
            "properties": {"query": {"type": "string"}},
            "required": ["query"],
        },
        handler=library_hits,
    ),
    "web_search": ToolSpec(
        name="web_search",
        description="Search the live web when a provider is configured; returns real citations.",
        permission=Permission.EXTERNAL_SEARCH,
        input_schema={
            "type": "object",
            "properties": {"query": {"type": "string"}},
            "required": ["query"],
        },
        handler=web_search,
    ),
    "history_search": ToolSpec(
        name="history_search",
        description="Search the user's own conversations.",
        permission=Permission.READ_OWN_CHATS,
        input_schema={
            "type": "object",
            "properties": {"query": {"type": "string"}},
            "required": ["query"],
        },
        handler=chat_history_search,
    ),
}


@dataclass
class AgentContext:
    attachments: list[AttachmentContext] = field(default_factory=list)
    search_results: list[dict] = field(default_factory=list)
    search_meta: dict = field(default_factory=dict)
    library_hits: list[dict] = field(default_factory=list)
    invocations: list[ToolInvocation] = field(default_factory=list)
    warnings: list[str] = field(default_factory=list)
