"""Persistent conversations with real SSE streaming, stop and regenerate."""

from __future__ import annotations

import json
import threading
from collections.abc import Iterator

from fastapi import APIRouter, Depends, Query, Request
from fastapi.responses import StreamingResponse
from sqlalchemy import or_, select
from sqlalchemy.orm import Session

from app.agent.orchestrator import agent
from app.agent.tools import AgentContext, ToolInvocation
from app.database import SessionLocal, get_db
from app.deps import AuthContext, OrgContext, get_auth, get_org_context
from app.errors import AppError, forbidden, not_found
from app.models import (
    ChatAttachment,
    ChatMessage,
    ChatSession,
    ConversationTag,
    File,
    User,
    utcnow,
)
from app.schemas.chat import (
    ChatCreateRequest,
    ChatDetailOut,
    ChatListResponse,
    ChatOut,
    ChatUpdateRequest,
    FileOut,
    MessageCreateRequest,
    MessageOut,
    RegenerateRequest,
    StopResponse,
)
from app.schemas.common import Citation
from app.services import notifications
from app.services.ai import ChatTurn

router = APIRouter(prefix="/chats", tags=["chat"])

_GENERATIONS: dict[str, dict] = {}
_GENERATIONS_LOCK = threading.Lock()
MAX_HISTORY_MESSAGES = 40


def _owned_chat(db: Session, user: User, chat_id: str) -> ChatSession:
    chat = db.get(ChatSession, chat_id)
    if chat is None or chat.deleted_at is not None:
        raise not_found("Conversation")
    if chat.user_id != user.id:
        raise forbidden("This conversation belongs to another user.")
    return chat


def _tag_names(chat: ChatSession) -> list[str]:
    return [tag.tag for tag in (chat.tags or [])]


def _preview(db: Session, chat: ChatSession) -> str | None:
    message = db.scalar(
        select(ChatMessage)
        .where(ChatMessage.chat_id == chat.id, ChatMessage.role == "user")
        .order_by(ChatMessage.created_at.asc())
        .limit(1)
    )
    if message is None:
        return None
    return message.content[:180]


def _chat_out(db: Session, chat: ChatSession) -> ChatOut:
    return ChatOut(
        id=chat.id,
        title=chat.title,
        model=chat.model,
        is_pinned=chat.is_pinned,
        is_archived=chat.is_archived,
        message_count=chat.message_count,
        last_message_at=chat.last_message_at,
        created_at=chat.created_at,
        updated_at=chat.updated_at,
        tags=_tag_names(chat),
        preview=_preview(db, chat),
    )


def _attachments_for(db: Session, message_id: str) -> list[FileOut]:
    rows = db.execute(
        select(File)
        .join(ChatAttachment, ChatAttachment.file_id == File.id)
        .where(ChatAttachment.message_id == message_id, File.deleted_at.is_(None))
    ).all()
    return [FileOut.model_validate(row[0]) for row in rows]


def _message_out(db: Session, message: ChatMessage) -> MessageOut:
    return MessageOut(
        id=message.id,
        chat_id=message.chat_id,
        role=message.role,
        content=message.content,
        status=message.status,
        provider=message.provider,
        model=message.model,
        citations=[Citation(**c) if isinstance(c, dict) else c for c in (message.citations or [])],
        tool_activity=message.tool_activity or [],
        error=message.error,
        created_at=message.created_at,
        attachments=_attachments_for(db, message.id),
    )


def _bind_attachments(
    db: Session,
    user: User,
    chat: ChatSession,
    message: ChatMessage,
    file_ids: list[str],
) -> None:
    for file_id in file_ids[:8]:
        record = db.get(File, file_id)
        if record is None or record.deleted_at is not None:
            raise AppError(404, "file_not_found", "One or more attachments no longer exist.")
        if record.user_id != user.id:
            raise forbidden("You do not have access to one of the attachments.")
        if record.organization_id and chat.organization_id and record.organization_id != chat.organization_id:
            raise forbidden("An attachment belongs to a different organization context.")
        exists = db.scalar(
            select(ChatAttachment).where(
                ChatAttachment.message_id == message.id, ChatAttachment.file_id == file_id
            )
        )
        if exists is None:
            db.add(
                ChatAttachment(chat_id=chat.id, message_id=message.id, file_id=file_id)
            )


def _citations(context: AgentContext) -> list[dict]:
    citations = []
    for index, result in enumerate(context.search_results, start=1):
        citations.append(
            {
                "title": result.get("title", ""),
                "url": result.get("url", ""),
                "domain": result.get("domain", ""),
                "snippet": result.get("snippet", ""),
                "published_at": result.get("published_at"),
                "index": index,
            }
        )
    return citations


def _tool_activity(context: AgentContext) -> list[dict]:
    return [
        {
            "tool": item.tool,
            "status": item.status,
            "summary": item.summary,
            "details": item.details,
        }
        for item in context.invocations
    ]


def _history(db: Session, chat_id: str, before_id: str | None = None) -> list[ChatTurn]:
    stmt = (
        select(ChatMessage)
        .where(ChatMessage.chat_id == chat_id, ChatMessage.role.in_(["user", "assistant"]))
        .order_by(ChatMessage.created_at.asc())
    )
    messages = db.scalars(stmt).all()
    turns: list[ChatTurn] = []
    for message in messages:
        if before_id and message.id == before_id:
            break
        if message.status in {"failed", "superseded", "streaming"}:
            continue
        if not (message.content or "").strip():
            continue
        turns.append(ChatTurn(role=message.role, content=message.content))
    return turns[-MAX_HISTORY_MESSAGES:]


def _sse(event: str, data: dict) -> str:
    return f"event: {event}\ndata: {json.dumps(data, ensure_ascii=False)}\n\n"


def _stream_generation(
    chat_id: str,
    assistant_id: str,
    history: list[ChatTurn],
    context: AgentContext,
    model: str | None,
    stop_event: threading.Event,
) -> Iterator[str]:
    db = SessionLocal()
    buffer: list[str] = []
    try:
        message = db.get(ChatMessage, assistant_id)
        if message is None:
            yield _sse("error", {"message": "The assistant message was deleted."})
            return
        yield _sse(
            "meta",
            {
                "message_id": assistant_id,
                "chat_id": chat_id,
                "provider": context.search_meta.get("provider") or None,
                "citations": _citations(context),
                "tools": _tool_activity(context),
            },
        )
        try:
            for chunk in agent.stream_answer(history, context, model):
                if stop_event.is_set():
                    break
                if not chunk:
                    continue
                buffer.append(chunk)
                yield _sse("token", {"text": chunk})
        except Exception as exc:
            message.status = "failed"
            message.error = str(exc)[:1000]
            message.content = "".join(buffer)
            message.tool_activity = _tool_activity(context)
            db.commit()
            yield _sse("error", {"message": str(exc)[:1000], "message_id": assistant_id})
            return
        stopped = stop_event.is_set()
        message.content = "".join(buffer)
        message.status = "stopped" if stopped else "complete"
        message.citations = _citations(context)
        message.tool_activity = _tool_activity(context)
        message.provider = "demo" if not context.search_meta.get("provider") else "search"
        if model:
            message.model = model
        db.commit()
        payload = _message_out(db, message).model_dump(mode="json")
        yield _sse("done", {"message": payload, "stopped": stopped})
    finally:
        db.close()
        with _GENERATIONS_LOCK:
            if _GENERATIONS.get(chat_id, {}).get("message_id") == assistant_id:
                _GENERATIONS.pop(chat_id, None)


@router.get("", response_model=ChatListResponse)
def list_chats(
    q: str | None = Query(default=None, max_length=200),
    archived: bool = False,
    limit: int = Query(default=40, ge=1, le=100),
    offset: int = Query(default=0, ge=0),
    auth: AuthContext = Depends(get_auth),
    db: Session = Depends(get_db),
) -> ChatListResponse:
    stmt = select(ChatSession).where(
        ChatSession.user_id == auth.user.id,
        ChatSession.deleted_at.is_(None),
        ChatSession.is_archived.is_(archived),
    )
    if q:
        pattern = f"%{q.strip()}%"
        matching_ids = select(ChatMessage.chat_id).where(ChatMessage.content.ilike(pattern))
        stmt = stmt.where(
            or_(ChatSession.title.ilike(pattern), ChatSession.id.in_(matching_ids))
        )
    total = len(db.scalars(stmt).all())
    chats = db.scalars(
        stmt.order_by(ChatSession.is_pinned.desc(), ChatSession.last_message_at.desc())
        .limit(limit)
        .offset(offset)
    ).all()
    return ChatListResponse(
        items=[_chat_out(db, chat) for chat in chats],
        total=total,
        limit=limit,
        offset=offset,
        has_more=offset + len(chats) < total,
    )


@router.post("", response_model=ChatOut, status_code=201)
def create_chat(
    payload: ChatCreateRequest,
    auth: AuthContext = Depends(get_auth),
    org: OrgContext = Depends(get_org_context),
    db: Session = Depends(get_db),
) -> ChatOut:
    chat = ChatSession(
        user_id=auth.user.id,
        organization_id=org.organization.id,
        title=(payload.title or "New conversation").strip()[:200],
        model=payload.model,
    )
    db.add(chat)
    db.commit()
    return _chat_out(db, chat)


@router.get("/{chat_id}", response_model=ChatDetailOut)
def get_chat(
    chat_id: str,
    limit: int = Query(default=200, ge=1, le=500),
    auth: AuthContext = Depends(get_auth),
    db: Session = Depends(get_db),
) -> ChatDetailOut:
    chat = _owned_chat(db, auth.user, chat_id)
    messages = db.scalars(
        select(ChatMessage)
        .where(ChatMessage.chat_id == chat.id)
        .order_by(ChatMessage.created_at.asc())
        .limit(limit)
    ).all()
    return ChatDetailOut(
        chat=_chat_out(db, chat),
        messages=[_message_out(db, message) for message in messages],
    )


@router.patch("/{chat_id}", response_model=ChatOut)
def update_chat(
    chat_id: str,
    payload: ChatUpdateRequest,
    auth: AuthContext = Depends(get_auth),
    db: Session = Depends(get_db),
) -> ChatOut:
    chat = _owned_chat(db, auth.user, chat_id)
    if payload.title is not None:
        chat.title = payload.title.strip()
    if payload.is_pinned is not None:
        chat.is_pinned = payload.is_pinned
    if payload.is_archived is not None:
        chat.is_archived = payload.is_archived
    if payload.tags is not None:
        for row in db.scalars(select(ConversationTag).where(ConversationTag.chat_id == chat.id)).all():
            db.delete(row)
        seen: set[str] = set()
        for tag in payload.tags:
            cleaned = tag.strip()[:48]
            if cleaned and cleaned.lower() not in seen:
                seen.add(cleaned.lower())
                db.add(ConversationTag(chat_id=chat.id, tag=cleaned))
    db.commit()
    db.refresh(chat)
    return _chat_out(db, chat)


@router.delete("/{chat_id}")
def delete_chat(
    chat_id: str,
    auth: AuthContext = Depends(get_auth),
    db: Session = Depends(get_db),
) -> dict:
    chat = _owned_chat(db, auth.user, chat_id)
    chat.deleted_at = utcnow()
    db.commit()
    return {"ok": True, "message": "Conversation deleted."}


@router.get("/{chat_id}/messages", response_model=list[MessageOut])
def list_messages(
    chat_id: str,
    limit: int = Query(default=200, ge=1, le=500),
    auth: AuthContext = Depends(get_auth),
    db: Session = Depends(get_db),
) -> list[MessageOut]:
    chat = _owned_chat(db, auth.user, chat_id)
    messages = db.scalars(
        select(ChatMessage)
        .where(ChatMessage.chat_id == chat.id)
        .order_by(ChatMessage.created_at.asc())
        .limit(limit)
    ).all()
    return [_message_out(db, message) for message in messages]


def _start_generation(
    *,
    db: Session,
    user: User,
    chat: ChatSession,
    history: list[ChatTurn],
    context: AgentContext,
    model: str | None,
) -> tuple[str, threading.Event]:
    assistant = ChatMessage(
        chat_id=chat.id,
        role="assistant",
        content="",
        status="streaming",
        provider="demo",
        model=model or chat.model,
        citations=_citations(context),
        tool_activity=_tool_activity(context),
    )
    db.add(assistant)
    db.flush()
    stop_event = threading.Event()
    with _GENERATIONS_LOCK:
        previous = _GENERATIONS.get(chat.id)
        if previous:
            previous["stop"].set()
        _GENERATIONS[chat.id] = {"message_id": assistant.id, "stop": stop_event}
    db.commit()
    return assistant.id, stop_event


@router.post("/{chat_id}/messages")
def send_message(
    chat_id: str,
    payload: MessageCreateRequest,
    request: Request,
    auth: AuthContext = Depends(get_auth),
    org: OrgContext = Depends(get_org_context),
    db: Session = Depends(get_db),
):
    chat = _owned_chat(db, auth.user, chat_id)
    content = payload.content.strip()
    if not content and not payload.attachment_ids:
        raise AppError(422, "empty_message", "Write a message or attach a file.")
    # Prepare context first: configuration errors must fail before persistence.
    context = agent.prepare_chat(
        db,
        auth.user,
        organization_id=org.organization.id,
        message=content,
        attachment_ids=payload.attachment_ids,
        use_search=payload.use_search,
        use_library=payload.use_library,
    )
    if payload.use_search and not context.search_results:
        raise AppError(409, "search_not_configured", "Web search returned no results or is not configured.")

    user_message = ChatMessage(chat_id=chat.id, role="user", content=content)
    db.add(user_message)
    db.flush()
    _bind_attachments(db, auth.user, chat, user_message, payload.attachment_ids)
    chat.message_count += 2
    chat.last_message_at = utcnow()
    if chat.title in {"New conversation", ""} and content:
        chat.title = content[:80].split("\n")[0] or "New conversation"
    if payload.model:
        chat.model = payload.model
    history = _history(db, chat.id)
    if not history or history[-1].role != "user":
        history.append(ChatTurn(role="user", content=content))
    assistant_id, stop_event = _start_generation(
        db=db,
        user=auth.user,
        chat=chat,
        history=history,
        context=context,
        model=payload.model or chat.model,
    )
    return StreamingResponse(
        _stream_generation(
            chat.id, assistant_id, history, context, payload.model or chat.model, stop_event
        ),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache, no-transform",
            "X-Accel-Buffering": "no",
            "Connection": "keep-alive",
        },
    )


@router.post("/{chat_id}/stop", response_model=StopResponse)
def stop_generation(
    chat_id: str,
    auth: AuthContext = Depends(get_auth),
    db: Session = Depends(get_db),
) -> StopResponse:
    _owned_chat(db, auth.user, chat_id)
    with _GENERATIONS_LOCK:
        entry = _GENERATIONS.get(chat_id)
        if not entry:
            return StopResponse(stopped=False, message_id=None)
        entry["stop"].set()
        message_id = str(entry["message_id"])
    return StopResponse(stopped=True, message_id=message_id)


@router.post("/{chat_id}/regenerate")
def regenerate(
    chat_id: str,
    payload: RegenerateRequest,
    auth: AuthContext = Depends(get_auth),
    org: OrgContext = Depends(get_org_context),
    db: Session = Depends(get_db),
):
    chat = _owned_chat(db, auth.user, chat_id)
    last_assistant = db.scalar(
        select(ChatMessage)
        .where(ChatMessage.chat_id == chat.id, ChatMessage.role == "assistant")
        .order_by(ChatMessage.created_at.desc())
        .limit(1)
    )
    last_user = db.scalar(
        select(ChatMessage)
        .where(ChatMessage.chat_id == chat.id, ChatMessage.role == "user")
        .order_by(ChatMessage.created_at.desc())
        .limit(1)
    )
    if last_user is None:
        raise AppError(422, "nothing_to_regenerate", "Send a message before regenerating an answer.")
    if last_assistant:
        last_assistant.status = "superseded"
    history = _history(db, chat.id, before_id=last_assistant.id if last_assistant else None)
    if not history or history[-1].role != "user":
        history.append(ChatTurn(role="user", content=last_user.content))
    attachment_ids = [
        row.file_id
        for row in db.scalars(
            select(ChatAttachment).where(ChatAttachment.message_id == last_user.id)
        ).all()
    ]
    context = agent.prepare_chat(
        db,
        auth.user,
        organization_id=org.organization.id,
        message=last_user.content,
        attachment_ids=attachment_ids,
        use_search=payload.use_search,
        use_library=payload.use_library,
    )
    assistant_id, stop_event = _start_generation(
        db=db,
        user=auth.user,
        chat=chat,
        history=history,
        context=context,
        model=payload.model or chat.model,
    )
    return StreamingResponse(
        _stream_generation(
            chat.id, assistant_id, history, context, payload.model or chat.model, stop_event
        ),
        media_type="text/event-stream",
        headers={"Cache-Control": "no-cache, no-transform", "X-Accel-Buffering": "no"},
    )
