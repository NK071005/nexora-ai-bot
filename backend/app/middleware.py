"""HTTP middleware: request IDs, security headers, CSRF and auth rate limits."""

from __future__ import annotations

import logging
import time
import uuid
from collections import defaultdict, deque

from fastapi import Request
from starlette.middleware.base import BaseHTTPMiddleware
from starlette.responses import JSONResponse

from app.config import settings
from app.database import SessionLocal
from app.errors import error_payload
from app.security.passwords import constant_time_equals
from app.security.sessions import CSRF_HEADER, SESSION_COOKIE, resolve_session

logger = logging.getLogger("nexora.http")

SAFE_METHODS = {"GET", "HEAD", "OPTIONS", "TRACE"}
CSRF_EXEMPT_PATHS = {
    "/api/auth/login",
    "/api/auth/register",
    "/api/auth/forgot-password",
    "/api/auth/reset-password",
    "/api/auth/activate",
    "/api/auth/google/callback",
}
# Only credential/account-recovery endpoints are throttled. Read-only session
# checks such as /api/auth/me must stay available for normal SPA navigation.
RATE_LIMITED_AUTH_PATHS = {
    "/api/auth/login",
    "/api/auth/register",
    "/api/auth/forgot-password",
    "/api/auth/reset-password",
    "/api/auth/activate",
    "/api/auth/resend-verification",
    "/api/auth/google/callback",
}


class RequestContextMiddleware(BaseHTTPMiddleware):
    async def dispatch(self, request: Request, call_next):
        request_id = request.headers.get("X-Request-ID") or str(uuid.uuid4())
        request.state.request_id = request_id
        started = time.perf_counter()
        response = await call_next(request)
        response.headers["X-Request-ID"] = request_id
        response.headers["X-Content-Type-Options"] = "nosniff"
        response.headers["X-Frame-Options"] = "DENY"
        response.headers["Referrer-Policy"] = "strict-origin-when-cross-origin"
        response.headers["Permissions-Policy"] = "microphone=(self), camera=(), geolocation=()"
        response.headers["Cross-Origin-Opener-Policy"] = "same-origin"
        elapsed_ms = (time.perf_counter() - started) * 1000
        if request.url.path.startswith("/api"):
            logger.info(
                "%s %s %s %.0fms rid=%s",
                request.method,
                request.url.path,
                response.status_code,
                elapsed_ms,
                request_id,
            )
        return response


class CsrfMiddleware(BaseHTTPMiddleware):
    """Double-submit CSRF validation bound to the server-side session.

    A session cookie alone is never sufficient for state-changing requests:
    the client must also prove it can read the CSRF cookie value. Login and
    account-recovery endpoints are exempt because no session exists yet.
    """

    async def dispatch(self, request: Request, call_next):
        if (
            request.url.path.startswith("/api/")
            and request.method.upper() not in SAFE_METHODS
            and request.url.path not in CSRF_EXEMPT_PATHS
        ):
            token = request.cookies.get(SESSION_COOKIE)
            if token:
                db = SessionLocal()
                try:
                    session = resolve_session(db, token)
                    if session is not None:
                        supplied = request.headers.get(CSRF_HEADER, "")
                        if not supplied or not constant_time_equals(supplied, session.csrf_token):
                            return JSONResponse(
                                status_code=403,
                                content=error_payload(
                                    "csrf_failed",
                                    "Security token missing or invalid. Refresh the page and retry.",
                                    getattr(request.state, "request_id", None),
                                ),
                            )
                finally:
                    db.close()
        return await call_next(request)


class AuthRateLimitMiddleware(BaseHTTPMiddleware):
    """Small in-memory limiter for credential endpoints.

    Single-process only; production deployments should use Redis (configured
    but optional). Tests disable it to keep suites deterministic.
    """

    def __init__(self, app, limit: int = 12, window_seconds: int = 60) -> None:
        super().__init__(app)
        self.limit = limit
        self.window = window_seconds
        self.hits: dict[str, deque[float]] = defaultdict(deque)

    async def dispatch(self, request: Request, call_next):
        if settings.is_test or request.url.path not in RATE_LIMITED_AUTH_PATHS:
            return await call_next(request)
        client = request.client.host if request.client else "unknown"
        key = f"{client}:{request.url.path}"
        now = time.monotonic()
        bucket = self.hits[key]
        while bucket and now - bucket[0] > self.window:
            bucket.popleft()
        if len(bucket) >= self.limit:
            retry = max(1, int(self.window - (now - bucket[0])))
            return JSONResponse(
                status_code=429,
                content=error_payload(
                    "rate_limited",
                    f"Too many requests. Try again in {retry} seconds.",
                    getattr(request.state, "request_id", None),
                ),
                headers={"Retry-After": str(retry)},
            )
        bucket.append(now)
        return await call_next(request)
