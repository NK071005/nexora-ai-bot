"""File uploads, extraction, downloads and media processing."""

from __future__ import annotations

import hashlib
import shutil
import subprocess
import uuid
from pathlib import Path

from fastapi import APIRouter, Depends, File, Query, UploadFile
from fastapi.responses import FileResponse
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.config import settings
from app.database import get_db
from app.deps import AuthContext, OrgContext, get_auth, get_org_context
from app.errors import AppError, forbidden, not_found
from app.models import (
    File as FileRecord,
    GeneratedArtifact,
    MediaAsset,
    Transcript,
    User,
    utcnow,
)
from app.schemas.chat import FileOut
from app.schemas.media import (
    GeneratedImageOut,
    ImageGenerationRequest,
    MediaCapabilities,
    SpreadsheetAnalysis,
    TranscriptionOut,
    VisionOut,
    VisionRequest,
)
from app.services.ai import get_provider
from app.services.capabilities import config_status
from app.services.extraction import analyze_spreadsheet, extract_text
from app.services.storage import delete_storage_key, resolve_path, safe_filename, save_upload

router = APIRouter(prefix="/files", tags=["files"])
media_router = APIRouter(prefix="/media", tags=["media"])


def owned_file(db: Session, user: User, file_id: str) -> FileRecord:
    record = db.get(FileRecord, file_id)
    if record is None or record.deleted_at is not None:
        raise not_found("File")
    if record.user_id != user.id:
        raise forbidden("This file belongs to another user.")
    return record


def _process_extraction(record: FileRecord, extension: str) -> None:
    path = resolve_path(record.storage_key)
    if record.kind in {"video", "audio"}:
        record.extraction_status = "unsupported"
        record.metadata_json = {
            **(record.metadata_json or {}),
            "note": (
                "Audio is stored. Configure transcription to extract speech."
                if record.kind == "audio"
                else "Video is stored. FFmpeg is required for frame extraction and transcoding."
            ),
        }
        return
    result = extract_text(path, extension)
    record.extracted_text = result.text or None
    record.page_count = result.page_count
    record.extraction_status = result.status
    metadata = dict(record.metadata_json or {})
    metadata.update(result.metadata or {})
    if result.error:
        metadata["extraction_error"] = result.error
    record.metadata_json = metadata


@router.post("", response_model=FileOut, status_code=201)
def upload_file(
    file: UploadFile = File(...),
    auth: AuthContext = Depends(get_auth),
    org: OrgContext = Depends(get_org_context),
    db: Session = Depends(get_db),
) -> FileOut:
    stored = save_upload(file, user_id=auth.user.id, organization_id=org.organization.id)
    extension = Path(stored.safe_name).suffix.lower()
    record = FileRecord(
        user_id=auth.user.id,
        organization_id=org.organization.id,
        original_name=(file.filename or stored.safe_name)[:255],
        safe_name=stored.safe_name,
        mime_type=stored.mime_type,
        size_bytes=stored.size_bytes,
        sha256=stored.sha256,
        storage_key=stored.storage_key,
        kind=stored.kind,
        extraction_status="pending",
        metadata_json={"extension": extension},
    )
    db.add(record)
    db.flush()
    try:
        _process_extraction(record, extension)
    except Exception as exc:
        record.extraction_status = "failed"
        record.metadata_json = {**(record.metadata_json or {}), "extraction_error": str(exc)[:400]}
    db.commit()
    db.refresh(record)
    return FileOut.model_validate(record)


@router.get("", response_model=list[FileOut])
def list_files(
    kind: str | None = Query(default=None, max_length=24),
    limit: int = Query(default=50, ge=1, le=200),
    offset: int = Query(default=0, ge=0),
    auth: AuthContext = Depends(get_auth),
    db: Session = Depends(get_db),
) -> list[FileOut]:
    stmt = select(FileRecord).where(
        FileRecord.user_id == auth.user.id, FileRecord.deleted_at.is_(None)
    )
    if kind:
        stmt = stmt.where(FileRecord.kind == kind)
    records = db.scalars(
        stmt.order_by(FileRecord.created_at.desc()).limit(limit).offset(offset)
    ).all()
    return [FileOut.model_validate(record) for record in records]


@router.get("/{file_id}", response_model=FileOut)
def get_file(
    file_id: str, auth: AuthContext = Depends(get_auth), db: Session = Depends(get_db)
) -> FileOut:
    return FileOut.model_validate(owned_file(db, auth.user, file_id))


@router.get("/{file_id}/download")
def download_file(
    file_id: str, auth: AuthContext = Depends(get_auth), db: Session = Depends(get_db)
) -> FileResponse:
    record = owned_file(db, auth.user, file_id)
    path = resolve_path(record.storage_key)
    return FileResponse(
        path,
        media_type=record.mime_type,
        filename=record.original_name,
        headers={"Cache-Control": "private, no-store"},
    )


@router.get("/{file_id}/analysis", response_model=SpreadsheetAnalysis)
def file_analysis(
    file_id: str, auth: AuthContext = Depends(get_auth), db: Session = Depends(get_db)
) -> SpreadsheetAnalysis:
    record = owned_file(db, auth.user, file_id)
    extension = Path(record.safe_name).suffix.lower()
    if extension not in {".csv", ".xlsx", ".xls"}:
        raise AppError(422, "unsupported_analysis", "Spreadsheet analysis is available for CSV and Excel files only.")
    result = analyze_spreadsheet(resolve_path(record.storage_key), extension)
    return SpreadsheetAnalysis(
        file_id=record.id,
        filename=record.original_name,
        status=result["status"],
        metadata=result["metadata"],
        text=result["text"][:8000],
    )


@router.delete("/{file_id}")
def delete_file(
    file_id: str, auth: AuthContext = Depends(get_auth), db: Session = Depends(get_db)
) -> dict:
    record = owned_file(db, auth.user, file_id)
    record.deleted_at = utcnow()
    delete_storage_key(record.storage_key)
    db.commit()
    return {"ok": True, "message": "File deleted."}


# ---------------------------------------------------------------------------
# Media processing
# ---------------------------------------------------------------------------


def _media_capabilities() -> MediaCapabilities:
    video = config_status()["video"]
    return MediaCapabilities(
        vision={
            "configured": settings.ai_configured,
            "model": settings.openai_model,
            "mode": "openai" if settings.ai_configured else "unconfigured",
            "note": "Set OPENAI_API_KEY to analyse images with vision.",
        },
        transcription={
            "configured": settings.transcription_configured,
            "model": settings.transcription_model,
            "mode": "openai" if settings.transcription_configured else "unconfigured",
            "note": "Set OPENAI_API_KEY and TRANSCRIPTION_MODEL to enable speech-to-text.",
        },
        image_generation={
            "configured": settings.image_generation_configured,
            "model": settings.image_generation_model or None,
            "mode": "openai" if settings.image_generation_configured else "unconfigured",
            "note": "Set IMAGE_GENERATION_MODEL (and OPENAI_API_KEY) to enable image generation.",
        },
        video=video,
        ffmpeg_available=bool(video["configured"]),
    )


@media_router.get("/capabilities", response_model=MediaCapabilities)
def media_capabilities(_: AuthContext = Depends(get_auth)) -> MediaCapabilities:
    return _media_capabilities()


@media_router.post("/files/{file_id}/transcribe", response_model=TranscriptionOut)
def transcribe_file(
    file_id: str, auth: AuthContext = Depends(get_auth), db: Session = Depends(get_db)
) -> TranscriptionOut:
    record = owned_file(db, auth.user, file_id)
    if record.kind != "audio":
        raise AppError(422, "not_audio", "Only audio files can be transcribed.")
    if not settings.transcription_configured:
        raise AppError(
            409,
            "transcription_not_configured",
            "Speech-to-text is not configured. Set OPENAI_API_KEY and TRANSCRIPTION_MODEL to enable it.",
        )
    provider = get_provider()
    if not hasattr(provider, "transcribe"):
        raise AppError(409, "transcription_not_configured", "The active provider does not support transcription.")
    result = provider.transcribe(resolve_path(record.storage_key))  # type: ignore[attr-defined]
    asset = db.scalar(select(MediaAsset).where(MediaAsset.file_id == record.id, MediaAsset.kind == "audio"))
    if asset is None:
        asset = MediaAsset(
            user_id=auth.user.id,
            file_id=record.id,
            kind="audio",
            status="processed",
            metadata_json={"filename": record.original_name},
        )
        db.add(asset)
        db.flush()
    existing = db.scalar(select(Transcript).where(Transcript.media_asset_id == asset.id))
    if existing:
        existing.text = result.get("text", "")
        existing.language = result.get("language")
        existing.segments = result.get("segments", [])
        existing.provider = provider.name
        transcript = existing
    else:
        transcript = Transcript(
            media_asset_id=asset.id,
            language=result.get("language"),
            text=result.get("text", ""),
            segments=result.get("segments", []),
            provider=provider.name,
        )
        db.add(transcript)
    db.commit()
    return TranscriptionOut(
        text=transcript.text,
        language=transcript.language,
        segments=transcript.segments,
        provider=provider.name,
        demo=False,
    )


@media_router.post("/files/{file_id}/describe", response_model=VisionOut)
def describe_image(
    file_id: str,
    payload: VisionRequest,
    auth: AuthContext = Depends(get_auth),
    db: Session = Depends(get_db),
) -> VisionOut:
    record = owned_file(db, auth.user, file_id)
    if record.kind != "image":
        raise AppError(422, "not_image", "Only image files can be analysed.")
    if not settings.ai_configured:
        raise AppError(
            409,
            "vision_not_configured",
            "Image analysis requires a vision model. Set OPENAI_API_KEY to enable it.",
        )
    provider = get_provider()
    description = provider.describe_image(resolve_path(record.storage_key), payload.prompt)  # type: ignore[attr-defined]
    return VisionOut(description=description, provider=provider.name)


@media_router.post("/images", response_model=GeneratedImageOut)
def generate_image(
    payload: ImageGenerationRequest,
    auth: AuthContext = Depends(get_auth),
    org: OrgContext = Depends(get_org_context),
    db: Session = Depends(get_db),
) -> GeneratedImageOut:
    if not settings.image_generation_configured:
        raise AppError(
            409,
            "image_generation_not_configured",
            "Image generation is not configured. Set IMAGE_GENERATION_MODEL and OPENAI_API_KEY.",
        )
    provider = get_provider()
    data = provider.generate_image(payload.prompt, payload.size)  # type: ignore[attr-defined]
    folder = settings.storage_dir / org.organization.id / auth.user.id / uuid.uuid4().hex
    folder.mkdir(parents=True, exist_ok=True)
    name = safe_filename(f"nexora-{utcnow().strftime('%Y%m%d-%H%M%S')}.png")
    target = folder / name
    target.write_bytes(data)
    record = FileRecord(
        user_id=auth.user.id,
        organization_id=org.organization.id,
        original_name=name,
        safe_name=name,
        mime_type="image/png",
        size_bytes=len(data),
        sha256=hashlib.sha256(data).hexdigest(),
        storage_key=(folder.relative_to(settings.storage_dir) / name).as_posix(),
        kind="image",
        extraction_status="metadata_only",
        metadata_json={"generated": True, "prompt": payload.prompt},
    )
    db.add(record)
    db.flush()
    artifact = GeneratedArtifact(
        user_id=auth.user.id,
        kind="image",
        file_id=record.id,
        prompt=payload.prompt,
        provider=provider.name,
        metadata_json={"size": payload.size},
    )
    db.add(artifact)
    db.commit()
    return GeneratedImageOut(
        file=FileOut.model_validate(record),
        artifact_id=artifact.id,
        provider=provider.name,
        prompt=payload.prompt,
        demo=False,
    )


@media_router.post("/files/{file_id}/video/frame")
def extract_video_frame(
    file_id: str,
    at: float = Query(default=1.0, ge=0, le=3600),
    auth: AuthContext = Depends(get_auth),
    db: Session = Depends(get_db),
):
    record = owned_file(db, auth.user, file_id)
    if record.kind != "video":
        raise AppError(422, "not_video", "Only video files can be processed here.")
    ffmpeg = shutil.which("ffmpeg")
    if not ffmpeg:
        raise AppError(
            409,
            "ffmpeg_unavailable",
            "FFmpeg is not installed. Frame extraction and transcoding are unavailable in this environment. "
            "Upload a still image or install FFmpeg to enable video processing.",
        )
    source = resolve_path(record.storage_key)
    frame_dir = source.parent / "frames"
    frame_dir.mkdir(parents=True, exist_ok=True)
    output = frame_dir / f"frame-{int(at)}.png"
    try:
        subprocess.run(
            [ffmpeg, "-y", "-ss", str(at), "-i", str(source), "-frames:v", "1", str(output)],
            check=True,
            capture_output=True,
            timeout=60,
        )
    except subprocess.CalledProcessError as exc:
        raise AppError(422, "frame_extraction_failed", "FFmpeg could not extract a frame from this video.") from exc
    return {
        "ok": True,
        "path": str(output),
        "filename": output.name,
        "note": "Frame stored locally. Use the media library to attach it to a conversation.",
    }
