"""공통 에러 응답: { request_id, error: { code, message, fields, context, retryable } } (openapi ErrorResponse)."""
from typing import Any
from uuid import uuid4

from fastapi import FastAPI, Request
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse
from starlette.exceptions import HTTPException as StarletteHTTPException

REQUEST_ID_HEADER = "X-Request-ID"


class ApiError(Exception):
    """화면 처리는 code 기준. message는 사용자에게 그대로 보여 줄 문장."""

    def __init__(
        self,
        status: int,
        code: str,
        message: str,
        *,
        fields: list[dict[str, str]] | None = None,
        context: dict[str, Any] | None = None,
        retryable: bool = False,
    ):
        super().__init__(message)
        self.status = status
        self.code = code
        self.message = message
        self.fields = fields or []
        self.context = context or {}
        self.retryable = retryable


def request_id_of(request: Request) -> str:
    return getattr(request.state, "request_id", None) or str(uuid4())


def error_response(request: Request, err: ApiError) -> JSONResponse:
    rid = request_id_of(request)
    return JSONResponse(
        status_code=err.status,
        content={
            "request_id": rid,
            "error": {
                "code": err.code,
                "message": err.message,
                "fields": err.fields,
                "context": err.context,
                "retryable": err.retryable,
            },
        },
        headers={REQUEST_ID_HEADER: rid, "Cache-Control": "no-store"},
    )


_HTTP_CODES = {
    400: ("MALFORMED_REQUEST", "요청 형식이 올바르지 않아요."),
    401: ("UNAUTHENTICATED", "로그인이 필요해요."),
    403: ("FORBIDDEN", "권한이 없어요."),
    404: ("RESOURCE_NOT_FOUND", "대상을 찾을 수 없어요."),
    405: ("MALFORMED_REQUEST", "지원하지 않는 요청 방식이에요."),
    413: ("PAYLOAD_TOO_LARGE", "파일이 너무 커요."),
    415: ("UNSUPPORTED_MEDIA_TYPE", "지원하지 않는 형식이에요."),
    429: ("RATE_LIMITED", "요청이 너무 많아요. 잠시 후 다시 시도해 주세요."),
}


def install_error_handlers(app: FastAPI) -> None:
    @app.middleware("http")
    async def attach_request_id(request: Request, call_next):
        incoming = request.headers.get(REQUEST_ID_HEADER, "")
        request.state.request_id = incoming[:128] if incoming else str(uuid4())
        response = await call_next(request)
        response.headers[REQUEST_ID_HEADER] = request.state.request_id
        return response

    @app.exception_handler(ApiError)
    async def handle_api_error(request: Request, err: ApiError):
        return error_response(request, err)

    @app.exception_handler(RequestValidationError)
    async def handle_validation(request: Request, err: RequestValidationError):
        fields = []
        for e in err.errors():
            loc = [str(p) for p in e.get("loc", []) if p not in ("body", "query", "path", "header")]
            fields.append({"field": ".".join(loc) or "body", "code": e.get("type", "invalid"), "message": e.get("msg", "")})
        return error_response(request, ApiError(422, "VALIDATION_ERROR", "입력값을 확인해 주세요.", fields=fields))

    @app.exception_handler(StarletteHTTPException)
    async def handle_http(request: Request, err: StarletteHTTPException):
        code, message = _HTTP_CODES.get(err.status_code, ("INTERNAL_ERROR", "서버 오류가 발생했어요."))
        return error_response(request, ApiError(err.status_code, code, message))

    @app.exception_handler(Exception)
    async def handle_unexpected(request: Request, err: Exception):
        return error_response(request, ApiError(500, "INTERNAL_ERROR", "서버 오류가 발생했어요.", retryable=True))
