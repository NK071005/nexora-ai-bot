"""Web and workspace search endpoints."""

from __future__ import annotations

from fastapi import APIRouter, Depends, Query
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.config import settings
from app.database import get_db
from app.deps import AuthContext, get_auth
from app.models import SearchJob, SearchResult
from app.schemas.chat import HistorySearchItem, WebSearchItem, WebSearchResponse
from app.schemas.library import LibrarySearchHit
from app.services import search as search_service

router = APIRouter(prefix="/search", tags=["search"])


@router.get("/status")
def search_status(_: AuthContext = Depends(get_auth)) -> dict:
    return {
        "configured": settings.search_configured,
        "provider": settings.search_provider if settings.search_configured else "none",
        "mode": "live" if settings.search_configured else "unconfigured",
        "note": (
            f"Live {settings.search_provider} search is available. Results include real URLs."
            if settings.search_configured
            else "Web search is not configured. Set SEARCH_PROVIDER and SEARCH_PROVIDER_API_KEY. "
            "Chat and library search keep working locally."
        ),
        "local": {
            "chat_history": True,
            "library_lexical": True,
            "semantic": False,
            "note": "Library retrieval is lexical (term frequency), not vector/semantic.",
        },
    }


@router.get("/web", response_model=WebSearchResponse)
def web_search(
    q: str = Query(min_length=1, max_length=400),
    limit: int = Query(default=6, ge=1, le=10),
    auth: AuthContext = Depends(get_auth),
    db: Session = Depends(get_db),
) -> WebSearchResponse:
    if not settings.search_configured:
        return WebSearchResponse(
            configured=False,
            provider="none",
            results=[],
            message="Web search is not configured. Add SEARCH_PROVIDER_API_KEY to retrieve live sources.",
        )
    _, results = search_service.web_search(db, auth.user.id, q, max_results=limit)
    return WebSearchResponse(
        configured=True,
        provider=settings.search_provider,
        results=[WebSearchItem(**item) for item in results],
        message=None,
    )


@router.get("/chats", response_model=list[HistorySearchItem])
def chat_search(
    q: str = Query(min_length=1, max_length=200),
    limit: int = Query(default=20, ge=1, le=100),
    auth: AuthContext = Depends(get_auth),
    db: Session = Depends(get_db),
) -> list[HistorySearchItem]:
    hits = search_service.search_chats(db, auth.user.id, q, limit)
    return [HistorySearchItem(**hit) for hit in hits]


@router.get("/library", response_model=list[LibrarySearchHit])
def library_search(
    q: str = Query(min_length=1, max_length=200),
    limit: int = Query(default=20, ge=1, le=100),
    auth: AuthContext = Depends(get_auth),
    db: Session = Depends(get_db),
) -> list[LibrarySearchHit]:
    hits = search_service.search_library(db, auth.user.id, q, limit)
    return [LibrarySearchHit(**hit) for hit in hits]


@router.get("/recent")
def recent_searches(
    limit: int = Query(default=10, ge=1, le=50),
    auth: AuthContext = Depends(get_auth),
    db: Session = Depends(get_db),
) -> list[dict]:
    jobs = db.scalars(
        select(SearchJob)
        .where(SearchJob.user_id == auth.user.id, SearchJob.scope == "web")
        .order_by(SearchJob.created_at.desc())
        .limit(limit)
    ).all()
    output = []
    for job in jobs:
        results = db.scalars(
            select(SearchResult)
            .where(SearchResult.search_job_id == job.id)
            .order_by(SearchResult.rank)
            .limit(6)
        ).all()
        output.append(
            {
                "id": job.id,
                "query": job.query,
                "provider": job.provider,
                "status": job.status,
                "result_count": job.result_count,
                "created_at": job.created_at.isoformat() + "Z",
                "results": [
                    {
                        "title": row.title,
                        "url": row.url,
                        "snippet": row.snippet,
                        "domain": row.domain,
                        "published_at": row.published_at,
                        "rank": row.rank,
                    }
                    for row in results
                ],
            }
        )
    return output
