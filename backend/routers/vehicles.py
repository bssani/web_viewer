# Copyright (c) 2025 Philip Choi

"""차량 모델 관련 API 라우터.

차량 목록, 메타데이터, 썸네일 엔드포인트를 제공한다.
GLB 파일은 StaticFiles 마운트(/static/{vehicle_id}/model.glb)로 서빙하며,
FileResponse는 사용하지 않는다.
"""

import json
import logging
from pathlib import Path

from fastapi import APIRouter, HTTPException
from fastapi.responses import FileResponse

from config.local import MODELS_DIR

logger = logging.getLogger("vehicle_viewer")

router = APIRouter(prefix="/api/vehicles", tags=["vehicles"])


def _list_vehicle_dirs() -> list[Path]:
    """models_dir 내 차량 디렉토리 목록을 반환한다."""
    if not MODELS_DIR.is_dir():
        return []
    return sorted(
        d for d in MODELS_DIR.iterdir()
        if d.is_dir() and not d.name.startswith(".")
    )


def _read_metadata(vehicle_dir: Path) -> dict | None:
    """차량 디렉토리에서 metadata.json을 읽는다. 실패 시 None."""
    metadata_path = vehicle_dir / "metadata.json"
    if not metadata_path.is_file():
        return None
    try:
        return json.loads(metadata_path.read_text(encoding="utf-8"))
    except (json.JSONDecodeError, OSError) as exc:
        logger.error("metadata.json 파싱 실패: %s — %s", metadata_path, exc)
        return None


@router.get("")
def list_vehicles():
    """전체 차량 목록을 반환한다.

    models_dir 내부의 각 차량 폴더에서 metadata.json을 읽어
    차량 ID, 이름, 업데이트 시각을 반환한다.
    models_dir이 비어있거나 유효 metadata가 없으면 빈 리스트를 반환한다.
    """
    vehicles = []
    for vehicle_dir in _list_vehicle_dirs():
        metadata = _read_metadata(vehicle_dir)
        if metadata is None:
            continue
        vehicles.append({
            "vehicle_id": metadata.get("vehicle_id", vehicle_dir.name),
            "vehicle_name": metadata.get("vehicle_name", vehicle_dir.name),
            "updated_at": metadata.get("updated_at"),
        })

    return {"vehicles": vehicles}


@router.get("/{vehicle_id}")
def get_vehicle(vehicle_id: str):
    """특정 차량의 메타데이터를 반환한다 (단일 GLB 구조).

    반환 스키마: vehicle_id, vehicle_name, created_at, updated_at,
    ue_version, model{...}, animations[...].
    """
    vehicle_dir = MODELS_DIR / vehicle_id
    metadata = _read_metadata(vehicle_dir)

    if metadata is None:
        available = [d.name for d in _list_vehicle_dirs() if _read_metadata(d) is not None]
        raise HTTPException(
            status_code=404,
            detail={
                "message": f"Vehicle not found: {vehicle_id}",
                "available_vehicles": available,
            },
        )

    return metadata


@router.get("/{vehicle_id}/thumbnail")
def get_vehicle_thumbnail(vehicle_id: str):
    """차량 썸네일 이미지를 반환한다.

    thumbnail.jpg 또는 thumbnail.png 파일이 있으면 반환, 없으면 404.
    """
    vehicle_dir = MODELS_DIR / vehicle_id
    for name, media in (("thumbnail.jpg", "image/jpeg"), ("thumbnail.png", "image/png")):
        candidate = vehicle_dir / name
        if candidate.is_file():
            return FileResponse(str(candidate), media_type=media)

    raise HTTPException(status_code=404, detail="썸네일 없음")
