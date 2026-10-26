"""Personal library: folders, items, tags, chunks, saved answers."""

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
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.models.base import Base, IdMixin, SoftDeleteMixin, TimestampMixin, utcnow


class LibraryFolder(Base, IdMixin, TimestampMixin):
    __tablename__ = "library_folders"
    __table_args__ = (UniqueConstraint("user_id", "name", "parent_id", name="uq_folder_user_name"),)

    user_id: Mapped[str] = mapped_column(
        String(36), ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True
    )
    organization_id: Mapped[str | None] = mapped_column(
        String(36), ForeignKey("organizations.id", ondelete="SET NULL"), nullable=True
    )
    name: Mapped[str] = mapped_column(String(120), nullable=False)
    parent_id: Mapped[str | None] = mapped_column(
        String(36), ForeignKey("library_folders.id", ondelete="CASCADE"), nullable=True
    )


class LibraryItem(Base, IdMixin, TimestampMixin, SoftDeleteMixin):
    __tablename__ = "library_items"
    __table_args__ = (
        Index("ix_library_user_updated", "user_id", "deleted_at", "updated_at"),
        Index("ix_library_user_kind", "user_id", "kind"),
    )

    user_id: Mapped[str] = mapped_column(
        String(36), ForeignKey("users.id", ondelete="CASCADE"), nullable=False
    )
    organization_id: Mapped[str | None] = mapped_column(
        String(36), ForeignKey("organizations.id", ondelete="SET NULL"), nullable=True
    )
    folder_id: Mapped[str | None] = mapped_column(
        String(36), ForeignKey("library_folders.id", ondelete="SET NULL"), nullable=True
    )
    file_id: Mapped[str | None] = mapped_column(
        String(36), ForeignKey("files.id", ondelete="SET NULL"), nullable=True
    )
    kind: Mapped[str] = mapped_column(String(24), default="note", nullable=False)
    title: Mapped[str] = mapped_column(String(240), nullable=False)
    description: Mapped[str] = mapped_column(Text, default="", nullable=False)
    content_text: Mapped[str | None] = mapped_column(Text, nullable=True)
    source_type: Mapped[str | None] = mapped_column(String(32), nullable=True)
    source_id: Mapped[str | None] = mapped_column(String(36), nullable=True)
    is_favorite: Mapped[bool] = mapped_column(default=False, nullable=False)
    metadata_json: Mapped[dict] = mapped_column(default=dict, nullable=False)

    tags: Mapped[list["LibraryTag"]] = relationship(
        secondary="library_item_tags", back_populates="items", lazy="selectin"
    )


class LibraryTag(Base, IdMixin):
    __tablename__ = "library_tags"
    __table_args__ = (UniqueConstraint("user_id", "name", name="uq_tag_user_name"),)

    user_id: Mapped[str] = mapped_column(
        String(36), ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True
    )
    name: Mapped[str] = mapped_column(String(64), nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow, nullable=False)

    items: Mapped[list[LibraryItem]] = relationship(
        secondary="library_item_tags", back_populates="tags"
    )


class LibraryItemTag(Base):
    __tablename__ = "library_item_tags"
    __table_args__ = (UniqueConstraint("item_id", "tag_id", name="uq_item_tag"),)

    item_id: Mapped[str] = mapped_column(
        String(36), ForeignKey("library_items.id", ondelete="CASCADE"), primary_key=True
    )
    tag_id: Mapped[str] = mapped_column(
        String(36), ForeignKey("library_tags.id", ondelete="CASCADE"), primary_key=True
    )


class DocumentChunk(Base, IdMixin):
    __tablename__ = "document_chunks"
    __table_args__ = (Index("ix_chunks_item_index", "library_item_id", "chunk_index"),)

    library_item_id: Mapped[str] = mapped_column(
        String(36), ForeignKey("library_items.id", ondelete="CASCADE"), nullable=False
    )
    user_id: Mapped[str] = mapped_column(
        String(36), ForeignKey("users.id", ondelete="CASCADE"), nullable=False
    )
    chunk_index: Mapped[int] = mapped_column(Integer, nullable=False)
    content: Mapped[str] = mapped_column(Text, nullable=False)
    page_number: Mapped[int | None] = mapped_column(Integer, nullable=True)
    token_estimate: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
