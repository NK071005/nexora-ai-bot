"""Personal library: folders, notes, documents, tags and lexical retrieval."""

from __future__ import annotations

from pathlib import Path

from fastapi import APIRouter, Depends, Query
from sqlalchemy import func, or_, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.database import get_db
from app.deps import AuthContext, OrgContext, get_auth, get_org_context
from app.errors import AppError, conflict, forbidden, not_found
from app.models import (
    DocumentChunk,
    File as FileRecord,
    LibraryFolder,
    LibraryItem,
    LibraryTag,
    User,
    utcnow,
)
from app.schemas.library import (
    ChunkOut,
    FolderCreate,
    FolderOut,
    FolderUpdate,
    ItemCreate,
    ItemListOut,
    ItemOut,
    ItemUpdate,
    LibrarySearchHit,
    ReindexResponse,
    TagOut,
)
from app.services.extraction import chunk_text, extract_text
from app.services.search import search_library
from app.services.storage import resolve_path

router = APIRouter(prefix="/library", tags=["library"])


def _owned_item(db: Session, user: User, item_id: str) -> LibraryItem:
    item = db.get(LibraryItem, item_id)
    if item is None or item.deleted_at is not None:
        raise not_found("Library item")
    if item.user_id != user.id:
        raise forbidden("This library item belongs to another user.")
    return item


def _owned_folder(db: Session, user: User, folder_id: str) -> LibraryFolder:
    folder = db.get(LibraryFolder, folder_id)
    if folder is None:
        raise not_found("Folder")
    if folder.user_id != user.id:
        raise forbidden("This folder belongs to another user.")
    return folder


def _folder_out(db: Session, folder: LibraryFolder) -> FolderOut:
    count = db.scalar(
        select(func.count(LibraryItem.id)).where(
            LibraryItem.folder_id == folder.id, LibraryItem.deleted_at.is_(None)
        )
    )
    return FolderOut(
        id=folder.id,
        name=folder.name,
        parent_id=folder.parent_id,
        created_at=folder.created_at,
        updated_at=folder.updated_at,
        item_count=int(count or 0),
    )


def _item_out(db: Session, item: LibraryItem) -> ItemOut:
    chunks = db.scalar(
        select(func.count(DocumentChunk.id)).where(DocumentChunk.library_item_id == item.id)
    )
    return ItemOut(
        id=item.id,
        title=item.title,
        kind=item.kind,
        description=item.description,
        content_text=item.content_text,
        folder_id=item.folder_id,
        file_id=item.file_id,
        source_type=item.source_type,
        source_id=item.source_id,
        is_favorite=item.is_favorite,
        metadata_json=item.metadata_json or {},
        tags=[tag.name for tag in (item.tags or [])],
        chunk_count=int(chunks or 0),
        created_at=item.created_at,
        updated_at=item.updated_at,
    )


def _set_tags(db: Session, user: User, item: LibraryItem, names: list[str]) -> None:
    resolved: list[LibraryTag] = []
    for name in names:
        cleaned = name.strip()[:64]
        if not cleaned:
            continue
        tag = db.scalar(
            select(LibraryTag).where(LibraryTag.user_id == user.id, LibraryTag.name == cleaned)
        )
        if tag is None:
            tag = LibraryTag(user_id=user.id, name=cleaned)
            db.add(tag)
            db.flush()
        resolved.append(tag)
    item.tags = resolved


def _reindex(db: Session, item: LibraryItem) -> int:
    for chunk in db.scalars(
        select(DocumentChunk).where(DocumentChunk.library_item_id == item.id)
    ).all():
        db.delete(chunk)
    db.flush()
    text = item.content_text or ""
    if not text.strip() and item.file_id:
        record = db.get(FileRecord, item.file_id)
        if record and record.extracted_text:
            text = record.extracted_text
    pieces = chunk_text(text)
    for index, piece in enumerate(pieces):
        db.add(
            DocumentChunk(
                library_item_id=item.id,
                user_id=item.user_id,
                chunk_index=index,
                content=piece,
                page_number=None,
                token_estimate=max(1, len(piece) // 4),
            )
        )
    return len(pieces)


def _content_from_file(db: Session, user: User, file_id: str) -> tuple[str, str | None, dict]:
    record = db.get(FileRecord, file_id)
    if record is None or record.deleted_at is not None:
        raise not_found("File")
    if record.user_id != user.id:
        raise forbidden("This file belongs to another user.")
    text = record.extracted_text or ""
    if not text and record.kind not in {"audio", "video"}:
        try:
            result = extract_text(resolve_path(record.storage_key), Path(record.safe_name).suffix.lower())
            text = result.text
            record.extracted_text = text or None
            record.extraction_status = result.status
        except Exception:
            pass
    return text, record.original_name, dict(record.metadata_json or {})


# ---------------------------------------------------------------------------
# Folders
# ---------------------------------------------------------------------------


@router.get("/folders", response_model=list[FolderOut])
def list_folders(
    auth: AuthContext = Depends(get_auth), db: Session = Depends(get_db)
) -> list[FolderOut]:
    folders = db.scalars(
        select(LibraryFolder)
        .where(LibraryFolder.user_id == auth.user.id)
        .order_by(LibraryFolder.name)
    ).all()
    return [_folder_out(db, folder) for folder in folders]


@router.post("/folders", response_model=FolderOut, status_code=201)
def create_folder(
    payload: FolderCreate,
    auth: AuthContext = Depends(get_auth),
    org: OrgContext = Depends(get_org_context),
    db: Session = Depends(get_db),
) -> FolderOut:
    if payload.parent_id:
        _owned_folder(db, auth.user, payload.parent_id)
    folder = LibraryFolder(
        user_id=auth.user.id,
        organization_id=org.organization.id,
        name=payload.name.strip(),
        parent_id=payload.parent_id,
    )
    db.add(folder)
    try:
        db.commit()
    except IntegrityError as exc:
        db.rollback()
        raise conflict("A folder with that name already exists at this level.") from exc
    db.refresh(folder)
    return _folder_out(db, folder)


@router.patch("/folders/{folder_id}", response_model=FolderOut)
def update_folder(
    folder_id: str,
    payload: FolderUpdate,
    auth: AuthContext = Depends(get_auth),
    db: Session = Depends(get_db),
) -> FolderOut:
    folder = _owned_folder(db, auth.user, folder_id)
    if payload.name is not None:
        folder.name = payload.name.strip()
    if payload.parent_id is not None:
        if payload.parent_id == folder.id:
            raise AppError(422, "invalid_parent", "A folder cannot be its own parent.")
        if payload.parent_id:
            _owned_folder(db, auth.user, payload.parent_id)
        folder.parent_id = payload.parent_id or None
    try:
        db.commit()
    except IntegrityError as exc:
        db.rollback()
        raise conflict("A folder with that name already exists at this level.") from exc
    db.refresh(folder)
    return _folder_out(db, folder)


@router.delete("/folders/{folder_id}")
def delete_folder(
    folder_id: str, auth: AuthContext = Depends(get_auth), db: Session = Depends(get_db)
) -> dict:
    folder = _owned_folder(db, auth.user, folder_id)
    db.delete(folder)
    db.commit()
    return {"ok": True, "message": "Folder deleted. Items were moved to the library root."}


# ---------------------------------------------------------------------------
# Items
# ---------------------------------------------------------------------------


@router.get("/items", response_model=ItemListOut)
def list_items(
    q: str | None = Query(default=None, max_length=200),
    kind: str | None = Query(default=None, max_length=24),
    folder_id: str | None = Query(default=None),
    favorite: bool | None = Query(default=None),
    tag: str | None = Query(default=None, max_length=64),
    limit: int = Query(default=30, ge=1, le=100),
    offset: int = Query(default=0, ge=0),
    auth: AuthContext = Depends(get_auth),
    db: Session = Depends(get_db),
) -> ItemListOut:
    stmt = select(LibraryItem).where(
        LibraryItem.user_id == auth.user.id, LibraryItem.deleted_at.is_(None)
    )
    if q:
        pattern = f"%{q.strip()}%"
        stmt = stmt.where(
            or_(
                LibraryItem.title.ilike(pattern),
                LibraryItem.description.ilike(pattern),
                LibraryItem.content_text.ilike(pattern),
            )
        )
    if kind:
        stmt = stmt.where(LibraryItem.kind == kind)
    if folder_id:
        stmt = stmt.where(LibraryItem.folder_id == folder_id)
    if favorite is not None:
        stmt = stmt.where(LibraryItem.is_favorite.is_(favorite))
    if tag:
        stmt = stmt.where(LibraryItem.tags.any(LibraryTag.name == tag))
    total = db.scalar(select(func.count()).select_from(stmt.subquery())) or 0
    items = db.scalars(
        stmt.order_by(LibraryItem.updated_at.desc()).limit(limit).offset(offset)
    ).all()
    return ItemListOut(
        items=[_item_out(db, item) for item in items],
        total=int(total),
        limit=limit,
        offset=offset,
        has_more=offset + len(items) < int(total),
    )


@router.post("/items", response_model=ItemOut, status_code=201)
def create_item(
    payload: ItemCreate,
    auth: AuthContext = Depends(get_auth),
    org: OrgContext = Depends(get_org_context),
    db: Session = Depends(get_db),
) -> ItemOut:
    if payload.folder_id:
        _owned_folder(db, auth.user, payload.folder_id)
    content = payload.content_text or ""
    description = payload.description
    file_meta: dict = {}
    if payload.file_id:
        extracted, filename, meta = _content_from_file(db, auth.user, payload.file_id)
        content = content or extracted
        description = description or f"Imported from {filename}"
        file_meta = {"original_filename": filename, **meta}
    item = LibraryItem(
        user_id=auth.user.id,
        organization_id=org.organization.id,
        folder_id=payload.folder_id,
        file_id=payload.file_id,
        kind=payload.kind,
        title=payload.title.strip(),
        description=description,
        content_text=content or None,
        source_type=payload.source_type,
        source_id=payload.source_id,
        metadata_json={**(payload.metadata_json or {}), **file_meta},
    )
    db.add(item)
    db.flush()
    _set_tags(db, auth.user, item, payload.tags)
    chunks = _reindex(db, item)
    item.metadata_json = {**(item.metadata_json or {}), "chunks": chunks}
    db.commit()
    db.refresh(item)
    return _item_out(db, item)


@router.get("/items/{item_id}", response_model=ItemOut)
def get_item(
    item_id: str, auth: AuthContext = Depends(get_auth), db: Session = Depends(get_db)
) -> ItemOut:
    return _item_out(db, _owned_item(db, auth.user, item_id))


@router.get("/items/{item_id}/chunks", response_model=list[ChunkOut])
def item_chunks(
    item_id: str, auth: AuthContext = Depends(get_auth), db: Session = Depends(get_db)
) -> list[ChunkOut]:
    item = _owned_item(db, auth.user, item_id)
    chunks = db.scalars(
        select(DocumentChunk)
        .where(DocumentChunk.library_item_id == item.id)
        .order_by(DocumentChunk.chunk_index)
    ).all()
    return [
        ChunkOut(
            id=chunk.id,
            chunk_index=chunk.chunk_index,
            content=chunk.content,
            page_number=chunk.page_number,
            token_estimate=chunk.token_estimate,
        )
        for chunk in chunks
    ]


@router.patch("/items/{item_id}", response_model=ItemOut)
def update_item(
    item_id: str,
    payload: ItemUpdate,
    auth: AuthContext = Depends(get_auth),
    db: Session = Depends(get_db),
) -> ItemOut:
    item = _owned_item(db, auth.user, item_id)
    if payload.folder_id is not None:
        if payload.folder_id:
            _owned_folder(db, auth.user, payload.folder_id)
        item.folder_id = payload.folder_id or None
    if payload.title is not None:
        item.title = payload.title.strip()
    if payload.description is not None:
        item.description = payload.description
    if payload.content_text is not None:
        item.content_text = payload.content_text
        _reindex(db, item)
    if payload.is_favorite is not None:
        item.is_favorite = payload.is_favorite
    if payload.metadata_json is not None:
        item.metadata_json = payload.metadata_json
    if payload.tags is not None:
        _set_tags(db, auth.user, item, payload.tags)
    item.updated_at = utcnow()
    db.commit()
    db.refresh(item)
    return _item_out(db, item)


@router.delete("/items/{item_id}")
def delete_item(
    item_id: str, auth: AuthContext = Depends(get_auth), db: Session = Depends(get_db)
) -> dict:
    item = _owned_item(db, auth.user, item_id)
    item.deleted_at = utcnow()
    db.commit()
    return {"ok": True, "message": "Library item moved to trash."}


@router.post("/items/{item_id}/reindex", response_model=ReindexResponse)
def reindex_item(
    item_id: str, auth: AuthContext = Depends(get_auth), db: Session = Depends(get_db)
) -> ReindexResponse:
    item = _owned_item(db, auth.user, item_id)
    if item.file_id and not item.content_text:
        extracted, _, _ = _content_from_file(db, auth.user, item.file_id)
        item.content_text = extracted or None
    count = _reindex(db, item)
    item.updated_at = utcnow()
    db.commit()
    return ReindexResponse(
        item_id=item.id,
        chunks=count,
        status="indexed" if count else "empty",
        message=(
            f"Indexed {count} passage(s) for lexical retrieval."
            if count
            else "No extractable text, so no passages were indexed."
        ),
    )


@router.get("/tags", response_model=list[TagOut])
def list_tags(
    auth: AuthContext = Depends(get_auth), db: Session = Depends(get_db)
) -> list[TagOut]:
    tags = db.scalars(
        select(LibraryTag).where(LibraryTag.user_id == auth.user.id).order_by(LibraryTag.name)
    ).all()
    return [TagOut.model_validate(tag) for tag in tags]


@router.get("/search", response_model=list[LibrarySearchHit])
def library_search(
    q: str = Query(min_length=1, max_length=200),
    limit: int = Query(default=20, ge=1, le=100),
    auth: AuthContext = Depends(get_auth),
    db: Session = Depends(get_db),
) -> list[LibrarySearchHit]:
    hits = search_library(db, auth.user.id, q, limit)
    return [LibrarySearchHit(**hit) for hit in hits]
