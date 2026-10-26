"""NEXORA AI FastAPI application entrypoint."""

from __future__ import annotations

import logging
from contextlib import asynccontextmanager
from pathlib import Path

from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, HTMLResponse, JSONResponse
from fastapi.staticfiles import StaticFiles

from app import __version__
from app.config import PROJECT_ROOT, settings
from app.database import init_db
from app.errors import install_error_handlers, not_found
from app.middleware import AuthRateLimitMiddleware, CsrfMiddleware, RequestContextMiddleware
from app.routers import (
    admin,
    auth,
    chat,
    files,
    internflow,
    library,
    notifications,
    scheduled,
    search,
    settings as settings_router,
)
from app.services.capabilities import config_status
from app.services.scheduler import scheduler

logging.basicConfig(
    level=logging.INFO if not settings.is_production else logging.WARNING,
    format="%(asctime)s %(levelname)s %(name)s %(message)s",
)
logger = logging.getLogger("nexora")

FRONTEND_DIST = PROJECT_ROOT / "frontend" / "dist"
FRONTEND_INDEX = FRONTEND_DIST / "index.html"


@asynccontextmanager
async def lifespan(_: FastAPI):
    if not settings.is_production:
        # Development convenience: create missing tables. Production uses Alembic.
        init_db()
    if settings.scheduler_enabled and not settings.is_test:
        scheduler.start()
    logger.info(
        "NEXORA AI %s started (env=%s, ai=%s, search=%s)",
        __version__,
        settings.app_env,
        "openai" if settings.ai_configured else "demo",
        "live" if settings.search_configured else "unconfigured",
    )
    try:
        yield
    finally:
        if settings.scheduler_enabled and not settings.is_test:
            scheduler.stop()


def create_app() -> FastAPI:
    app = FastAPI(
        title="NEXORA AI",
        version=__version__,
        description=(
            "Multimodal AI workspace with persistent chat, a document library, "
            "live web research, scheduled automations and the InternFlow agent."
        ),
        docs_url="/api/docs",
        redoc_url="/api/redoc",
        openapi_url="/api/openapi.json",
        lifespan=lifespan,
    )

    # Middleware: last added is outermost, so request IDs wrap everything.
    app.add_middleware(
        CORSMiddleware,
        allow_origins=sorted(
            {
                settings.frontend_url,
                "http://localhost:5173",
                "http://127.0.0.1:5173",
                "http://localhost:8000",
            }
        ),
        allow_credentials=True,
        allow_methods=["GET", "POST", "PATCH", "PUT", "DELETE", "OPTIONS"],
        allow_headers=["Content-Type", "X-CSRF-Token", "X-Organization-Id", "X-Request-ID"],
        expose_headers=["X-Request-ID"],
    )
    app.add_middleware(AuthRateLimitMiddleware)
    app.add_middleware(CsrfMiddleware)
    app.add_middleware(RequestContextMiddleware)

    install_error_handlers(app)

    for router in (
        auth.router,
        chat.router,
        files.router,
        files.media_router,
        library.router,
        search.router,
        scheduled.router,
        notifications.router,
        settings_router.router,
        admin.router,
        internflow.router,
    ):
        app.include_router(router, prefix="/api")

    @app.get("/api/health", tags=["system"])
    def health() -> dict:
        return {
            "status": "ok",
            "app": settings.app_name,
            "version": __version__,
            "environment": settings.app_env,
        }

    @app.get("/api/health/ready", tags=["system"])
    def readiness() -> JSONResponse:
        from sqlalchemy import text

        from app.database import SessionLocal

        checks: dict[str, dict] = {}
        try:
            db = SessionLocal()
            try:
                db.execute(text("SELECT 1"))
                checks["database"] = {"status": "ok"}
            finally:
                db.close()
        except Exception as exc:  # pragma: no cover - infrastructure failure
            checks["database"] = {"status": "error", "detail": str(exc)[:200]}
        storage_ok = False
        try:
            settings.storage_dir.mkdir(parents=True, exist_ok=True)
            storage_ok = settings.storage_dir.is_dir()
        except Exception:
            storage_ok = False
        checks["storage"] = {"status": "ok" if storage_ok else "error"}
        healthy = all(item["status"] == "ok" for item in checks.values())
        return JSONResponse(
            status_code=200 if healthy else 503,
            content={"status": "ready" if healthy else "degraded", "checks": checks},
        )

    @app.get("/api/meta", tags=["system"])
    def meta() -> dict:
        """Public, non-secret capability advertisement used by the UI shell."""
        status = config_status()
        return {
            "app": status["app"],
            "version": __version__,
            "demo_mode": not settings.ai_configured,
            "capabilities": {
                "ai": status["ai"],
                "search": status["search"],
                "email": status["email"],
                "calendar": status["calendar"],
                "google_oauth": status["google_oauth"],
                "storage": status["storage"],
                "scheduler": status["scheduler"],
                "video": status["video"],
            },
            "demo_login": settings.allow_demo_login and not settings.is_production,
            "docs": "/api/docs",
        }

    if (FRONTEND_DIST / "assets").is_dir():
        app.mount("/assets", StaticFiles(directory=FRONTEND_DIST / "assets"), name="assets")

    @app.get("/", include_in_schema=False)
    def root():
        if FRONTEND_INDEX.exists():
            return FileResponse(FRONTEND_INDEX)
        return HTMLResponse(
            "<!doctype html><html><body style=\"font-family:system-ui;background:#0b1220;color:#e8eefc;"
            "padding:48px\"><h1>NEXORA AI</h1><p>Backend is running. The frontend bundle is not built yet."
            "</p><p>API docs: <a style=\"color:#5b8cff\" href=\"/api/docs\">/api/docs</a> · "
            "Health: <a style=\"color:#5b8cff\" href=\"/api/health\">/api/health</a></p></body></html>"
        )

    @app.get("/{full_path:path}", include_in_schema=False)
    def spa_fallback(full_path: str, request: Request):
        if full_path.startswith(("api/", "assets/")):
            raise not_found("Endpoint")
        candidate = (FRONTEND_DIST / full_path).resolve()
        try:
            candidate.relative_to(FRONTEND_DIST.resolve())
        except ValueError:
            raise not_found("Asset")
        if candidate.is_file():
            return FileResponse(candidate)
        if FRONTEND_INDEX.exists():
            return FileResponse(FRONTEND_INDEX)
        raise not_found("Page")

    return app


app = create_app()

__all__ = ["app", "create_app"]
