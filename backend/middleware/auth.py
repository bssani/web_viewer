# Copyright (c) 2025 GM Technical Center Korea — PQDQ Team

"""인증 미들웨어. Phase 1~5: 통과(no-op). Phase 6: JWT 검증 추가."""

from fastapi import Request
from starlette.middleware.base import BaseHTTPMiddleware
from starlette.responses import Response


class AuthMiddleware(BaseHTTPMiddleware):
    """인증 미들웨어.

    Phase 1~5에서는 모든 요청을 통과시킨다.
    Phase 6에서 Authorization 헤더 검증 로직을 추가할 예정.
    """

    async def dispatch(self, request: Request, call_next) -> Response:
        """요청을 처리한다. Phase 1~5: 무조건 통과."""
        # Phase 6에서 Authorization 헤더 검증 로직 추가
        response = await call_next(request)
        return response
