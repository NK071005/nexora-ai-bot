"""Application errors and consistent JSON error handling."""

from __future__ import annotations

import logging
from typing import Any

from fastapi import FastAPI, Request
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse
from starlette.exceptions import HTTPException as StarletteHTTPException

logger = logging.getLogger("nexora.errors")


class AppError(Exception):
    def __init__(
        self,
        status_code: int,
        code: str,
        message: str,
        details: Any | None = None,
    ) -> None:
        super().__init__(message)
        self.status_code = status_code
        self.code = code
        self.message = message
        self.details = details


def not_found(entity: str = "Resource") -> AppError:
    return AppError(404, "not_found", f"{entity} not found.")


def forbidden(message: str = "You do not have permission to perform this action.") -> AppError:
    return AppError(403, "forbidden", message)


def unauthorized(message: str = "Authentication required.") -> AppError:
    return AppError(401, "unauthorized", message)


def bad_request(message: str, details: Any | None = None) -> AppError:
    return AppError(400, "bad_request", message, details)


def conflict(message: str, details: Any | None = None) -> AppError:
    return AppError(409, "conflict", message, details)


def unprocessable(message: str, details: Any | None = None) -> AppError:
    return AppError(422, "validation_error", message, details)


def error_payload(
    code: str, message: str, request_id: str | None, details: Any | None = None
) -> dict[str, Any]:
    body: dict[str, Any] = {"error": {"code": code, "message": message, "request_id": request_id}}
    if details is not None:
        body["error"]["details"] = details
    return body


def install_error_handlers(app: FastAPI) -> None:
    @app.exception_handler(AppError)
    async def _app_error(request: Request, exc: AppError) -> JSONResponse:
        request_id = getattr(request.state, "request_id", None)
        return JSONResponse(
            status_code=exc.status_code,
            content=error_payload(exc.code, exc.message, request_id, exc.details),
        )

    @app.exception_handler(RequestValidationError)
    async def _validation_error(request: Request, exc: RequestValidationError) -> JSONResponse:
        details = []
        for err in exc.errors():
            details.append(
                {
                    "field": ".".join(str(p) for p in err.get("loc", []) if p != "body"),
                    "message": err.get("msg", "Invalid value"),
                }
            )
        return JSONResponse(
            status_code=422,
            content=error_payload(
                "validation_error",
                "Some fields need attention.",
                getattr(request.state, "request_id", None),
                details,
            ),
        )

    @app.exception_handler(StarletteHTTPException)
    async def _http_error(request: Request, exc: StarletteHTTPException) -> JSONResponse:
        message = exc.detail if isinstance(exc.detail, str) else "Request failed."
        return JSONResponse(
            status_code=exc.status_code,
            content=error_payload(
                "http_error", message, getattr(request.state, "request_id", None)
            ),
        )

    @app.exception_handler(Exception)
    async def _unhandled(request: Request, exc: Exception) -> JSONResponse:
        request_id = getattr(request.state, "request_id", None)
        logger.exception("Unhandled error request_id=%s", request_id)
        return JSONResponse(
            status_code=500,
            content=error_payload(
                "internal_error",
                "Something went wrong on our side. Please retry.",
                request_id,
            ),
        )
