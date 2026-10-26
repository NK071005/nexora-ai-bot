"""Isolated local file storage with validation and hashing."""

from __future__ import annotations

import hashlib
import mimetypes
import re
import shutil
import uuid
from dataclasses import dataclass
from pathlib import Path

from fastapi import UploadFile

from app.config import settings
from app.errors import AppError

ALLOWED_EXTENSIONS = {
    ".pdf", ".docx", ".txt", ".md", ".csv", ".xlsx", ".xls", ".json",
    ".png", ".jpg", ".jpeg", ".webp", ".gif", ".bmp", ".svg",
    ".mp3", ".wav", ".m4a", ".ogg", ".webm", ".flac",
    ".mp4", ".mov", ".mkv", ".avi",
    ".py", ".js", ".ts", ".tsx", ".jsx", ".html", ".css", ".sql", ".yaml", ".yml", ".xml",
}

IMAGE_EXTENSIONS = {".png", ".jpg", ".jpeg", ".webp", ".gif", ".bmp", ".svg"}
AUDIO_EXTENSIONS = {".mp3", ".wav", ".m4a", ".ogg", ".webm", ".flac"}
VIDEO_EXTENSIONS = {".mp4", ".mov", ".mkv", ".avi"}
DOCUMENT_EXTENSIONS = {".pdf", ".docx", ".txt", ".md", ".csv", ".xlsx", ".xls", ".json"} | {
    ".py", ".js", ".ts", ".tsx", ".jsx", ".html", ".css", ".sql", ".yaml", ".yml", ".xml"
}

DANGEROUS_EXTENSIONS = {
    ".exe", ".dll", ".bat", ".cmd", ".com", ".msi", ".scr", ".ps1", ".vbs", ".jar",
    ".sh", ".php", ".asp", ".aspx", ".jsp", ".cgi", ".pyc", ".lnk", ".reg",
}

# Declared MIME prefixes we accept. A mismatch between extension and MIME is not
# trusted; both are validated and the extension drives processing.
ALLOWED_MIME_PREFIXES = (
    "image/", "audio/", "video/", "text/", "application/pdf",
    "application/vnd.openxmlformats-officedocument", "application/vnd.ms-excel",
    "application/json", "application/octet-stream",
)

_SAFE_NAME_RE = re.compile(r"[^A-Za-z0-9._ -]+")


@dataclass
class StoredFile:
    safe_name: str
    storage_key: str
    size_bytes: int
    sha256: str
    mime_type: str
    extension: str
    kind: str


def classify(extension: str, mime_type: str) -> str:
    ext = extension.lower()
    if ext in IMAGE_EXTENSIONS or mime_type.startswith("image/"):
        return "image"
    if ext in AUDIO_EXTENSIONS or mime_type.startswith("audio/"):
        return "audio"
    if ext in VIDEO_EXTENSIONS or mime_type.startswith("video/"):
        return "video"
    if ext in {".xlsx", ".xls", ".csv"}:
        return "spreadsheet"
    return "document"


def safe_filename(name: str) -> str:
    base = Path(name or "upload").name
    cleaned = _SAFE_NAME_RE.sub("_", base).strip(" ._") or "upload"
    return cleaned[:180]


def validate_upload(filename: str, content_type: str | None, size: int) -> tuple[str, str]:
    original = Path(filename or "upload").name
    extension = Path(original).suffix.lower()
    if extension in DANGEROUS_EXTENSIONS:
        raise AppError(415, "unsupported_file_type", f"Files of type {extension} are not allowed.")
    if extension not in ALLOWED_EXTENSIONS:
        raise AppError(
            415,
            "unsupported_file_type",
            f"Unsupported file type '{extension or 'unknown'}'. Allowed examples: PDF, DOCX, XLSX, CSV, TXT, PNG, JPG, MP3, MP4.",
        )
    if size <= 0:
        raise AppError(400, "empty_file", "The uploaded file is empty.")
    if size > settings.max_upload_bytes:
        raise AppError(
            413,
            "file_too_large",
            f"File exceeds the {settings.max_upload_size_mb} MB limit.",
        )
    mime = (content_type or "").split(";")[0].strip().lower()
    if not mime:
        mime = mimetypes.guess_type(original)[0] or "application/octet-stream"
    if not mime.startswith(ALLOWED_MIME_PREFIXES):
        raise AppError(415, "unsupported_mime", f"Content type '{mime}' is not accepted.")
    return extension, mime


def save_upload(
    upload: UploadFile,
    *,
    user_id: str,
    organization_id: str | None,
    max_bytes: int | None = None,
) -> StoredFile:
    declared_size = 0
    try:
        upload.file.seek(0, 2)
        declared_size = upload.file.tell()
        upload.file.seek(0)
    except Exception:
        declared_size = 0

    extension, mime = validate_upload(
        upload.filename or "upload", upload.content_type, max(declared_size, 1)
    )

    limit = max_bytes or settings.max_upload_bytes
    owner_scope = organization_id or f"u_{user_id}"
    safe = safe_filename(upload.filename or "upload")
    key_dir = Path(owner_scope) / user_id / uuid.uuid4().hex
    target_dir = settings.storage_dir / key_dir
    target_dir.mkdir(parents=True, exist_ok=True)
    target = target_dir / safe

    hasher = hashlib.sha256()
    total = 0
    try:
        with target.open("wb") as out:
            while True:
                chunk = upload.file.read(1024 * 1024)
                if not chunk:
                    break
                total += len(chunk)
                if total > limit:
                    raise AppError(
                        413,
                        "file_too_large",
                        f"File exceeds the {settings.max_upload_size_mb} MB limit.",
                    )
                hasher.update(chunk)
                out.write(chunk)
    except AppError:
        shutil.rmtree(target_dir, ignore_errors=True)
        raise
    except Exception as exc:  # pragma: no cover - IO failures
        shutil.rmtree(target_dir, ignore_errors=True)
        raise AppError(500, "storage_failed", "The file could not be stored.") from exc

    if total == 0:
        shutil.rmtree(target_dir, ignore_errors=True)
        raise AppError(400, "empty_file", "The uploaded file is empty.")

    storage_key = (key_dir / safe).as_posix()
    return StoredFile(
        safe_name=safe,
        storage_key=storage_key,
        size_bytes=total,
        sha256=hasher.hexdigest(),
        mime_type=mime,
        extension=extension,
        kind=classify(extension, mime),
    )


def resolve_path(storage_key: str) -> Path:
    root = settings.storage_dir.resolve()
    candidate = (root / storage_key).resolve()
    if not str(candidate).startswith(str(root)) or not candidate.is_file():
        raise AppError(404, "file_missing", "The stored file is unavailable.")
    return candidate


def delete_storage_key(storage_key: str) -> None:
    try:
        target = resolve_path(storage_key)
        target.unlink(missing_ok=True)
        parent = target.parent
        if parent.exists() and not any(parent.iterdir()):
            parent.rmdir()
    except AppError:
        return
    except Exception:  # pragma: no cover
        return
