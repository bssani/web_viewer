# Copyright (c) 2025 Philip Choi

"""IBL 환경(.env) 파일 목록 API 라우터.

environments 디렉토리를 스캔하여 사용 가능한 환경 목록을 반환한다.
실제 .env 파일 서빙은 StaticFiles(/static/environments) 마운트가 담당한다.
"""

import logging

from fastapi import APIRouter

from config.local import ENVIRONMENTS_DIR

logger = logging.getLogger("vehicle_viewer")

router = APIRouter(prefix="/api/environments", tags=["environments"])


@router.get("")
def list_environments() -> list[dict]:
    """environments 디렉토리의 .env 파일 목록을 반환한다.

    반환 스키마: [{ id, name, url }]
    빈 디렉토리 또는 디렉토리 부재 시 빈 배열을 반환한다.
    """
    if not ENVIRONMENTS_DIR.is_dir():
        logger.warning("환경 디렉토리 없음: %s", ENVIRONMENTS_DIR)
        return []

    files = sorted(ENVIRONMENTS_DIR.glob("*.env"))
    return [
        {
            "id": f.stem,
            "name": f.stem.replace("_", " ").title(),
            "url": f"/static/environments/{f.name}",
        }
        for f in files
    ]
