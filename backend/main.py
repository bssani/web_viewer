# Copyright (c) 2025 GM Technical Center Korea — PQDQ Team

"""Vehicle Web Viewer — FastAPI 서버.

차량 3D 모델(GLB) 파일을 서빙하는 REST API 서버.

실행 방법:
    cd backend
    uvicorn main:app --host 0.0.0.0 --port 8000 --reload
"""

import logging
import mimetypes

from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import Response
from starlette.staticfiles import StaticFiles

from config.base import setup_logging
from config.local import ALLOWED_ORIGINS, LOG_FILE, MODELS_DIR
from middleware.auth import AuthMiddleware
from routers.vehicles import router as vehicles_router
from storage.local import LocalStorage

# 로깅 설정
setup_logging(LOG_FILE)
logger = logging.getLogger("vehicle_viewer")

# GLB MIME 타입 등록 (StaticFiles가 자동 처리 못 하는 경우 대비)
mimetypes.add_type("model/gltf-binary", ".glb")

# 스토리지 초기화
storage = LocalStorage(MODELS_DIR)

# FastAPI 앱
app = FastAPI(
    title="Vehicle Web Viewer API",
    description="차량 3D 모델 파일 서빙 API",
    version="0.1.0",
)

# 인증 미들웨어 (Phase 1~5: no-op)
app.add_middleware(AuthMiddleware)

# CORS 설정 (사내 도메인 화이트리스트만 허용)
if ALLOWED_ORIGINS:
    app.add_middleware(
        CORSMiddleware,
        allow_origins=ALLOWED_ORIGINS,
        allow_credentials=False,
        allow_methods=["GET"],
        allow_headers=["*"],
    )
    logger.info("CORS 허용 출처: %s", ALLOWED_ORIGINS)
else:
    logger.warning("ALLOWED_ORIGINS가 설정되지 않음 — CORS 비활성화 상태")

# 라우터 등록
app.include_router(vehicles_router)

# StaticFiles 마운트 (GLB 파일 직접 서빙)
if MODELS_DIR.is_dir():
    app.mount("/static", StaticFiles(directory=str(MODELS_DIR)), name="models")
    logger.info("StaticFiles 마운트: /static → %s", MODELS_DIR)


@app.middleware("http")
async def cache_control_middleware(request: Request, call_next) -> Response:
    """Cache-Control 헤더를 구분 적용한다.

    - GLB 파일 (StaticFiles): public, max-age=3600
    - API 응답 (/vehicles): no-cache
    """
    response = await call_next(request)

    path = request.url.path
    if path.startswith("/static/") and path.endswith(".glb"):
        response.headers["Cache-Control"] = "public, max-age=3600"
    elif path.startswith("/vehicles"):
        response.headers["Cache-Control"] = "no-cache"

    return response


@app.get("/")
def root():
    """서버 상태 확인용 루트 엔드포인트."""
    return {"status": "ok", "message": "Vehicle Web Viewer API"}
