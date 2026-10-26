"""Web, chat-history and library search."""

from __future__ import annotations

from urllib.parse import urlparse

import httpx
from sqlalchemy import or_, select
from sqlalchemy.orm import Session

from app.config import settings
from app.errors import AppError
from app.models import ChatMessage, ChatSession, DocumentChunk, LibraryItem, SearchJob, SearchResult
from app.models.base import utcnow
from app.schemas.common import domain_of


def web_search_configured() -> bool:
    return settings.search_configured


def _normalise_results(raw: list[dict], provider: str) -> list[dict]:
    results: list[dict] = []
    for item in raw:
        if provider == "tavily":
            title = item.get("title") or ""
            url = item.get("url") or ""
            snippet = item.get("content") or ""
            published = item.get("published_date")
        elif provider == "serper":
            title = item.get("title") or ""
            url = item.get("link") or ""
            snippet = item.get("snippet") or ""
            published = item.get("date")
        else:
            title = item.get("title") or ""
            url = item.get("url") or ""
            snippet = item.get("snippet") or ""
            published = item.get("published_at")
        if not title or not url or not url.startswith(("http://", "https://")):
            continue
        results.append(
            {
                "title": title[:400],
                "url": url[:1000],
                "snippet": (snippet or "")[:2000],
                "domain": domain_of(url),
                "published_at": (published or None),
                "rank": len(results) + 1,
            }
        )
    return results


def web_search(db: Session, user_id: str, query: str, max_results: int = 6) -> tuple[SearchJob, list[dict]]:
    if not settings.search_configured:
        raise AppError(
            409,
            "search_not_configured",
            "Web search is not configured. Add SEARCH_PROVIDER_API_KEY to enable live results.",
        )
    provider = settings.search_provider
    if provider not in {"tavily", "serper"}:
        raise AppError(400, "search_provider_unsupported", f"Unknown search provider '{provider}'.")
    job = SearchJob(user_id=user_id, query=query[:500], scope="web", provider=provider, status="running")
    db.add(job)
    db.flush()
    results: list[dict] = []
    try:
        with httpx.Client(timeout=20) as client:
            if provider == "tavily":
                response = client.post(
                    "https://api.tavily.com/search",
                    json={
                        "api_key": settings.search_provider_api_key,
                        "query": query,
                        "max_results": max_results,
                        "search_depth": "basic",
                        "include_answer": False,
                    },
                )
            else:
                response = client.post(
                    "https://google.serper.dev/search",
                    headers={"X-API-KEY": settings.search_provider_api_key},
                    json={"q": query, "num": max_results},
                )
            response.raise_for_status()
            payload = response.json()
            raw = payload.get("results") if provider == "tavily" else payload.get("organic", [])
            results = _normalise_results(raw or [], provider)[:max_results]
    except httpx.HTTPError as exc:
        job.status = "failed"
        job.error = str(exc)[:400]
        db.commit()
        raise AppError(502, "search_failed", "The search provider request failed. Try again shortly.") from exc
    except Exception as exc:
        job.status = "failed"
        job.error = str(exc)[:400]
        db.commit()
        raise AppError(502, "search_failed", "The search provider returned an unexpected response.") from exc

    job.status = "completed"
    job.result_count = len(results)
    for item in results:
        db.add(
            SearchResult(
                search_job_id=job.id,
                title=item["title"],
                url=item["url"],
                snippet=item["snippet"],
                domain=item["domain"],
                published_at=item["published_at"],
                rank=item["rank"],
            )
        )
    db.commit()
    return job, results


def search_chats(db: Session, user_id: str, query: str, limit: int = 20) -> list[dict]:
    pattern = f"%{query.strip()}%"
    stmt = (
        select(ChatSession)
        .where(ChatSession.user_id == user_id, ChatSession.deleted_at.is_(None))
        .order_by(ChatSession.last_message_at.desc())
        .limit(limit)
    )
    sessions = db.scalars(stmt).all()
    hits: list[dict] = []
    message_matches = db.scalars(
        select(ChatMessage)
        .join(ChatSession, ChatMessage.chat_id == ChatSession.id)
        .where(
            ChatSession.user_id == user_id,
            ChatSession.deleted_at.is_(None),
            ChatMessage.content.ilike(pattern),
        )
        .order_by(ChatMessage.created_at.desc())
        .limit(limit)
    ).all()
    by_chat: dict[str, ChatMessage] = {}
    for message in message_matches:
        by_chat.setdefault(message.chat_id, message)
    for session in sessions:
        title_match = query.lower() in session.title.lower()
        message = by_chat.get(session.id)
        if not title_match and not message:
            continue
        hits.append(
            {
                "id": session.id,
                "title": session.title,
                "snippet": (message.content[:240] if message else "Title match"),
                "updated_at": session.last_message_at,
                "is_archived": session.is_archived,
                "is_pinned": session.is_pinned,
                "match": "title" if title_match else "message",
            }
        )
    return hits


def search_library(db: Session, user_id: str, query: str, limit: int = 20) -> list[dict]:
    pattern = f"%{query.strip()}%"
    items = db.scalars(
        select(LibraryItem)
        .where(
            LibraryItem.user_id == user_id,
            LibraryItem.deleted_at.is_(None),
            or_(
                LibraryItem.title.ilike(pattern),
                LibraryItem.description.ilike(pattern),
                LibraryItem.content_text.ilike(pattern),
            ),
        )
        .order_by(LibraryItem.updated_at.desc())
        .limit(limit)
    ).all()
    seen = {item.id for item in items}
    chunk_rows = db.execute(
        select(DocumentChunk, LibraryItem)
        .join(LibraryItem, DocumentChunk.library_item_id == LibraryItem.id)
        .where(
            LibraryItem.user_id == user_id,
            LibraryItem.deleted_at.is_(None),
            DocumentChunk.content.ilike(pattern),
        )
        .limit(limit)
    ).all()
    results = [
        {
            "id": item.id,
            "title": item.title,
            "kind": item.kind,
            "snippet": (item.content_text or item.description or "")[:240],
            "updated_at": item.updated_at,
        }
        for item in items
    ]
    for chunk, item in chunk_rows:
        if item.id in seen:
            continue
        seen.add(item.id)
        results.append(
            {
                "id": item.id,
                "title": item.title,
                "kind": item.kind,
                "snippet": chunk.content[:240],
                "updated_at": item.updated_at,
            }
        )
    return results[:limit]


STOPWORDS = set(
    """the a an and or but if then than that this these those is are was were be been being to of in
    on for with as by from at it its into about your you we they their our can could should would will
    shall may might must do does did not no nor so such very more most other which who whom what when
    where why how all any both each few some own same too also there here have has had i me my mine us
    them he she his her""".split()
)


def retrieve_library_context(db: Session, user_id: str, query: str, limit: int = 4) -> list[dict]:
    """Lexical retrieval over the user's own library chunks.

    Explicitly NOT semantic/vector retrieval. Scores term frequency with a
    title bonus; every returned passage is scoped to the authenticated user.
    """
    terms = [
        t for t in (word.strip(".,;:!?()[]{}\"'").lower() for word in query.split())
        if len(t) > 2 and t not in STOPWORDS
    ][:10]
    if not terms:
        return []
    rows = db.execute(
        select(DocumentChunk, LibraryItem)
        .join(LibraryItem, DocumentChunk.library_item_id == LibraryItem.id)
        .where(LibraryItem.user_id == user_id, LibraryItem.deleted_at.is_(None))
        .limit(1200)
    ).all()
    scored: list[tuple[float, DocumentChunk, LibraryItem]] = []
    for chunk, item in rows:
        text_lower = chunk.content.lower()
        title_lower = item.title.lower()
        score = 0.0
        for term in terms:
            score += text_lower.count(term)
            if term in title_lower:
                score += 4
        if score > 0:
            scored.append((score, chunk, item))
    scored.sort(key=lambda row: row[0], reverse=True)
    hits = []
    for score, chunk, item in scored[:limit]:
        hits.append(
            {
                "item_id": item.id,
                "title": item.title,
                "content": chunk.content[:1200],
                "score": round(score, 2),
                "page": chunk.page_number,
            }
        )
    return hits


def notes_fallback(db: Session, user_id: str) -> list[dict]:
    """Fallback: recent notes when no chunk-level hits exist."""
    items = db.scalars(
        select(LibraryItem)
        .where(LibraryItem.user_id == user_id, LibraryItem.deleted_at.is_(None))
        .order_by(LibraryItem.updated_at.desc())
        .limit(4)
    ).all()
    return [
        {"item_id": item.id, "title": item.title, "content": (item.content_text or item.description or "")[:800], "score": 0}
        for item in items
        if item.content_text or item.description
    ]
