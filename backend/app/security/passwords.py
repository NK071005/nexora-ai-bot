"""Password hashing, opaque tokens and CSRF helpers."""

from __future__ import annotations

import hashlib
import hmac
import secrets
from datetime import datetime, timedelta

from argon2 import PasswordHasher
from argon2.exceptions import InvalidHashError, VerificationError, VerifyMismatchError

_hasher = PasswordHasher(time_cost=3, memory_cost=65536, parallelism=2, hash_len=32, salt_len=16)


def hash_password(password: str) -> str:
    return _hasher.hash(password)


def verify_password(password_hash: str | None, password: str) -> bool:
    if not password_hash:
        return False
    try:
        return _hasher.verify(password_hash, password)
    except (VerifyMismatchError, VerificationError, InvalidHashError):
        return False


def needs_rehash(password_hash: str | None) -> bool:
    if not password_hash:
        return False
    try:
        return _hasher.check_needs_rehash(password_hash)
    except InvalidHashError:
        return True


def new_opaque_token() -> str:
    """Return a high-entropy URL-safe token (given to the client once)."""
    return secrets.token_urlsafe(40)


def hash_token(token: str) -> str:
    return hashlib.sha256(token.encode("utf-8")).hexdigest()


def constant_time_equals(a: str, b: str) -> bool:
    return hmac.compare_digest(a.encode("utf-8"), b.encode("utf-8"))


def new_csrf_token() -> str:
    return secrets.token_urlsafe(32)


def expiry(hours: int | None = None, minutes: int | None = None) -> datetime:
    from app.models.base import utcnow

    delta = timedelta(hours=hours or 0, minutes=minutes or 0)
    return utcnow() + delta


def password_problems(password: str) -> list[str]:
    problems: list[str] = []
    if len(password) < 10:
        problems.append("Password must be at least 10 characters.")
    if not any(c.islower() for c in password):
        problems.append("Include at least one lowercase letter.")
    if not any(c.isupper() for c in password):
        problems.append("Include at least one uppercase letter.")
    if not any(c.isdigit() for c in password):
        problems.append("Include at least one number.")
    return problems
