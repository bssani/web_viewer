# Copyright (c) 2025 Philip Choi

"""차량 모델 관련 API 라우터.

차량 목록, 메타데이터, 구역별 GLB 파일 서빙 엔드포인트를 제공한다.
GLB 파일은 StaticFiles 마운트로 서빙하며, FileResponse는 사용하지 않는다.
"""

import json
import logging
from pathlib import Path

from fastapi import APIRouter, HTTPException
from fastapi.responses import RedirectResponse

from config.local import MODELS_DIR
from storage.local import LocalStorage

logger = logging.getLogger("vehicle_viewer")

router = APIRouter(prefix="/vehicles", tags=["vehicles"])

# 스토리지 인스턴스
_storage = LocalStorage(MODELS_DIR)

# 유효한 구역 이름
_VALID_ZONES = {"exterior", "interior", "chassis", "powertrain"}


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
    차량 ID, 이름, 업데이트 시각, 구역 정보를 반환한다.
    models_dir이 비어있으면 빈 리스트를 반환한다.
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
            "zones": list(metadata.get("zones", {}).keys()),
        })

    return {"vehicles": vehicles}


@router.get("/{vehicle_id}")
def get_vehicle(vehicle_id: str):
    """특정 차량의 메타데이터를 반환한다.

    Args:
        vehicle_id: 차량 식별자
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


@router.get("/{vehicle_id}/{zone}")
def get_vehicle_zone(vehicle_id: str, zone: str):
    """특정 차량의 구역별 GLB 파일을 StaticFiles 경로로 리다이렉트한다.

    GLB 파일은 /static/{vehicle_id}/{zone}.glb 경로의 StaticFiles 마운트로 서빙된다.
    FileResponse를 사용하지 않는다.

    Args:
        vehicle_id: 차량 식별자
        zone: 구역 이름 (exterior, interior, chassis, powertrain)
    """
    zone_lower = zone.lower()

    # 차량 존재 확인
    vehicle_dir = MODELS_DIR / vehicle_id
    if not vehicle_dir.is_dir():
        available = [d.name for d in _list_vehicle_dirs() if _read_metadata(d) is not None]
        raise HTTPException(
            status_code=404,
            detail={
                "message": f"Vehicle not found: {vehicle_id}",
                "available_vehicles": available,
            },
        )

    # GLB 파일 존재 확인
    glb_path = vehicle_dir / f"{zone_lower}.glb"
    if not glb_path.is_file():
        # 사용 가능한 구역 목록
        available_zones = [
            p.stem for p in vehicle_dir.glob("*.glb")
            if p.stem in _VALID_ZONES
        ]
        raise HTTPException(
            status_code=404,
            detail={
                "message": f"Zone not found: {vehicle_id}/{zone_lower}",
                "available_zones": sorted(available_zones),
            },
        )

    # StaticFiles 마운트 경로로 리다이렉트
    static_url = f"/static/{vehicle_id}/{zone_lower}.glb"
    return RedirectResponse(url=static_url, status_code=307)
