"""Uploaded files, speech transcripts and generated artifacts."""

from __future__ import annotations

from datetime import datetime

from sqlalchemy import (
    DateTime,
    ForeignKey,
    Index,
    Integer,
    String,
    Text,
    UniqueConstraint,
)
from sqlalchemy.orm import Mapped, mapped_column

from app.models.base import Base, IdMixin, SoftDeleteMixin, TimestampMixin, utcnow


class File(Base, IdMixin, TimestampMixin, SoftDeleteMixin):
    """A stored upload. Content lives on disk; this row is the authorization boundary."""

    __tablename__ = "files"
    __table_args__ = (
        Index("ix_files_user_deleted", "user_id", "deleted_at"),
        Index("ix_files_org_created", "organization_id", "created_at"),
    )

    user_id: Mapped[str] = mapped_column(
        String(36), ForeignKey("users.id", ondelete="CASCADE"), nullable=False
    )
    organization_id: Mapped[str | None] = mapped_column(
        String(36), ForeignKey("organizations.id", ondelete="SET NULL"), nullable=True
    )
    original_name: Mapped[str] = mapped_column(String(255), nullable=False)
    safe_name: Mapped[str] = mapped_column(String(255), nullable=False)
    mime_type: Mapped[str] = mapped_column(String(160), nullable=False)
    size_bytes: Mapped[int] = mapped_column(Integer, nullable=False)
    sha256: Mapped[str] = mapped_column(String(64), nullable=False, index=True)
    storage_key: Mapped[str] = mapped_column(String(500), nullable=False)
    kind: Mapped[str] = mapped_column(String(24), default="document", nullable=False)
    extraction_status: Mapped[str] = mapped_column(String(24), default="pending", nullable=False)
    extracted_text: Mapped[str | None] = mapped_column(Text, nullable=True)
    page_count: Mapped[int | None] = mapped_column(Integer, nullable=True)
    metadata_json: Mapped[dict] = mapped_column(default=dict, nullable=False)


class MediaAsset(Base, IdMixin, TimestampMixin):
    __tablename__ = "media_assets"

    user_id: Mapped[str] = mapped_column(
        String(36), ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True
    )
    file_id: Mapped[str] = mapped_column(
        String(36), ForeignKey("files.id", ondelete="CASCADE"), nullable=False
    )
    kind: Mapped[str] = mapped_column(String(24), nullable=False)
    status: Mapped[str] = mapped_column(String(24), default="ready", nullable=False)
    metadata_json: Mapped[dict] = mapped_column(default=dict, nullable=False)


class MediaProcessingJob(Base, IdMixin, TimestampMixin):
    __tablename__ = "media_processing_jobs"

    media_asset_id: Mapped[str] = mapped_column(
        String(36), ForeignKey("media_assets.id", ondelete="CASCADE"), nullable=False, index=True
    )
    kind: Mapped[str] = mapped_column(String(40), nullable=False)
    status: Mapped[str] = mapped_column(String(24), default="queued", nullable=False)
    progress: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    result: Mapped[dict | None] = mapped_column(nullable=True)
    error: Mapped[str | None] = mapped_column(Text, nullable=True)


class Transcript(Base, IdMixin):
    __tablename__ = "transcripts"
    __table_args__ = (UniqueConstraint("media_asset_id", name="uq_transcript_asset"),)

    media_asset_id: Mapped[str] = mapped_column(
        String(36), ForeignKey("media_assets.id", ondelete="CASCADE"), nullable=False
    )
    language: Mapped[str | None] = mapped_column(String(16), nullable=True)
    text: Mapped[str] = mapped_column(Text, nullable=False)
    segments: Mapped[list] = mapped_column(default=list, nullable=False)
    provider: Mapped[str] = mapped_column(String(32), nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow, nullable=False)


class GeneratedArtifact(Base, IdMixin, TimestampMixin):
    __tablename__ = "generated_artifacts"

    user_id: Mapped[str] = mapped_column(
        String(36), ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True
    )
    kind: Mapped[str] = mapped_column(String(24), nullable=False)
    file_id: Mapped[str | None] = mapped_column(
        String(36), ForeignKey("files.id", ondelete="SET NULL"), nullable=True
    )
    prompt: Mapped[str] = mapped_column(Text, nullable=False)
    provider: Mapped[str] = mapped_column(String(32), nullable=False)
    metadata_json: Mapped[dict] = mapped_column(default=dict, nullable=False)
