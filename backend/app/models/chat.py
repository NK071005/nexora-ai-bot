"""Conversation persistence."""

from __future__ import annotations

from datetime import datetime

from sqlalchemy import (
    DateTime,
    ForeignKey,
    Index,
    String,
    Text,
    UniqueConstraint,
)
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.models.base import Base, IdMixin, SoftDeleteMixin, TimestampMixin, utcnow


class ChatSession(Base, IdMixin, TimestampMixin, SoftDeleteMixin):
    __tablename__ = "chat_sessions"
    __table_args__ = (
        Index("ix_chat_user_recent", "user_id", "deleted_at", "last_message_at"),
        Index("ix_chat_org", "organization_id", "updated_at"),
    )

    user_id: Mapped[str] = mapped_column(
        String(36), ForeignKey("users.id", ondelete="CASCADE"), nullable=False
    )
    organization_id: Mapped[str | None] = mapped_column(
        String(36), ForeignKey("organizations.id", ondelete="SET NULL"), nullable=True
    )
    title: Mapped[str] = mapped_column(String(200), default="New conversation", nullable=False)
    model: Mapped[str | None] = mapped_column(String(120), nullable=True)
    is_pinned: Mapped[bool] = mapped_column(default=False, nullable=False)
    is_archived: Mapped[bool] = mapped_column(default=False, nullable=False)
    last_message_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow, nullable=False)
    message_count: Mapped[int] = mapped_column(default=0, nullable=False)

    messages: Mapped[list["ChatMessage"]] = relationship(
        back_populates="chat", cascade="all, delete-orphan", order_by="ChatMessage.created_at"
    )
    tags: Mapped[list["ConversationTag"]] = relationship(
        back_populates="chat", cascade="all, delete-orphan"
    )


class ChatMessage(Base, IdMixin):
    __tablename__ = "chat_messages"
    __table_args__ = (Index("ix_messages_chat_created", "chat_id", "created_at"),)

    chat_id: Mapped[str] = mapped_column(
        String(36), ForeignKey("chat_sessions.id", ondelete="CASCADE"), nullable=False
    )
    parent_id: Mapped[str | None] = mapped_column(String(36), nullable=True)
    role: Mapped[str] = mapped_column(String(16), nullable=False)
    content: Mapped[str] = mapped_column(Text, default="", nullable=False)
    status: Mapped[str] = mapped_column(String(20), default="complete", nullable=False)
    provider: Mapped[str | None] = mapped_column(String(32), nullable=True)
    model: Mapped[str | None] = mapped_column(String(120), nullable=True)
    citations: Mapped[list] = mapped_column(default=list, nullable=False)
    tool_activity: Mapped[list] = mapped_column(default=list, nullable=False)
    error: Mapped[str | None] = mapped_column(Text, nullable=True)
    token_usage: Mapped[dict] = mapped_column(default=dict, nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow, nullable=False, index=True)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime, default=utcnow, onupdate=utcnow, nullable=False
    )

    chat: Mapped[ChatSession] = relationship(back_populates="messages")


class ChatAttachment(Base, IdMixin):
    __tablename__ = "chat_attachments"
    __table_args__ = (UniqueConstraint("message_id", "file_id", name="uq_chat_attachment_pair"),)

    chat_id: Mapped[str] = mapped_column(
        String(36), ForeignKey("chat_sessions.id", ondelete="CASCADE"), nullable=False
    )
    message_id: Mapped[str | None] = mapped_column(
        String(36), ForeignKey("chat_messages.id", ondelete="CASCADE"), nullable=True
    )
    file_id: Mapped[str] = mapped_column(
        String(36), ForeignKey("files.id", ondelete="CASCADE"), nullable=False
    )
    created_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow, nullable=False)


class ConversationSummary(Base, IdMixin):
    __tablename__ = "conversation_summaries"

    chat_id: Mapped[str] = mapped_column(
        String(36), ForeignKey("chat_sessions.id", ondelete="CASCADE"), nullable=False, index=True
    )
    summary: Mapped[str] = mapped_column(Text, nullable=False)
    message_count: Mapped[int] = mapped_column(default=0, nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow, nullable=False)


class ConversationTag(Base, IdMixin):
    __tablename__ = "conversation_tags"
    __table_args__ = (UniqueConstraint("chat_id", "tag", name="uq_conversation_tag"),)

    chat_id: Mapped[str] = mapped_column(
        String(36), ForeignKey("chat_sessions.id", ondelete="CASCADE"), nullable=False
    )
    tag: Mapped[str] = mapped_column(String(48), nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow, nullable=False)

    chat: Mapped[ChatSession] = relationship(back_populates="tags")
