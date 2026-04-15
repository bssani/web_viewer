# Copyright (c) 2025 Philip Choi

"""metadata.json 단독 재생성 스크립트.

이미 `backend/models_dir/{vehicle_id}/model.glb`가 존재한다고 가정.
압축은 건너뛰고 GLB JSON 청크에서 메트릭/animations만 재추출해
metadata.json을 덮어쓴다.

CLI 실행:
    python pipeline/regen_metadata.py --vehicle_id porsche_911
    python pipeline/regen_metadata.py --vehicle_id porsche_911 --vehicle_name "Porsche 911"
    python pipeline/regen_metadata.py --all
"""

import argparse
import json
import logging
import os
import sys
from pathlib import Path

from compress import (
    _compute_file_hash,
    _parse_glb_metrics,
    _validate_glb,
    _write_metadata,
)

logger = logging.getLogger("vehicle_viewer")


def _resolve_models_dir(models_dir_arg: Path | None) -> Path:
    if models_dir_arg is not None:
        return models_dir_arg.resolve()
    raw = os.environ.get("MODELS_DIR", "./models_dir")
    p = Path(raw)
    backend_dir = Path(__file__).resolve().parent.parent / "backend"
    return (p if p.is_absolute() else backend_dir / p).resolve()


def regen_metadata(
    vehicle_id: str,
    vehicle_name: str = "",
    ue_version: str = "5.5.2",
    models_dir: Path | None = None,
) -> dict:
    """metadata.json만 재생성. model.glb는 건드리지 않음."""
    resolved_dir = _resolve_models_dir(models_dir)
    vehicle_dir = resolved_dir / vehicle_id.lower()
    final_path = vehicle_dir / "model.glb"
    metadata_path = vehicle_dir / "metadata.json"
    metadata_lock_path = vehicle_dir / ".metadata.lock"

    if not final_path.exists():
        raise FileNotFoundError(f"model.glb 없음: {final_path}")

    _validate_glb(final_path)

    if not vehicle_name:
        # 기존 metadata.json의 vehicle_name 유지, 없으면 id 기반 자동 생성
        if metadata_path.exists():
            try:
                existing = json.loads(metadata_path.read_text(encoding="utf-8"))
                vehicle_name = existing.get("vehicle_name", "") or vehicle_id.replace("_", " ").title()
            except (ValueError, OSError):
                vehicle_name = vehicle_id.replace("_", " ").title()
        else:
            vehicle_name = vehicle_id.replace("_", " ").title()

    final_size = final_path.stat().st_size
    file_hash = _compute_file_hash(final_path)

    animations: list[str] = []
    try:
        metrics = _parse_glb_metrics(final_path)
        animations = metrics.pop("animations", [])
    except (ValueError, OSError, json.JSONDecodeError) as exc:
        logger.warning("GLB 메트릭 추출 실패, 기본값 사용: %s", exc)
        metrics = {
            "draw_calls": 0,
            "material_count": 0,
            "vertex_count": 0,
            "texture_memory_bytes": 0,
        }

    model_data = {
        "file": "model.glb",
        "file_size_bytes": final_size,
        "file_hash": file_hash,
        **metrics,
    }

    _write_metadata(
        metadata_path, metadata_lock_path,
        vehicle_id, vehicle_name, ue_version,
        model_data, animations,
    )

    logger.info(
        "재생성 완료: %s (draw=%d, mat=%d, vtx=%d, anims=%d)",
        vehicle_id, metrics["draw_calls"], metrics["material_count"],
        metrics["vertex_count"], len(animations),
    )
    return model_data


def main() -> None:
    parser = argparse.ArgumentParser(description="metadata.json 단독 재생성")
    parser.add_argument("--vehicle_id", help="특정 차량 ID (생략 시 --all 필요)")
    parser.add_argument("--vehicle_name", default="", help="표시명 (생략 시 기존값 유지)")
    parser.add_argument("--ue_version", default="5.5.2")
    parser.add_argument("--models_dir", default=None)
    parser.add_argument("--all", action="store_true", help="모든 차량에 대해 재생성")
    args = parser.parse_args()

    logging.basicConfig(
        level=logging.INFO,
        format="%(asctime)s [%(levelname)s] %(name)s — %(message)s",
        datefmt="%Y-%m-%d %H:%M:%S",
    )

    models_dir_arg = Path(args.models_dir) if args.models_dir else None

    if args.all:
        resolved = _resolve_models_dir(models_dir_arg)
        if not resolved.is_dir():
            logger.error("models_dir 없음: %s", resolved)
            sys.exit(1)

        vehicle_ids = [
            p.name for p in resolved.iterdir()
            if p.is_dir() and (p / "model.glb").exists()
        ]
        if not vehicle_ids:
            logger.warning("대상 차량 없음: %s", resolved)
            return

        logger.info("재생성 대상 %d건: %s", len(vehicle_ids), vehicle_ids)
        failed: list[str] = []
        for vid in vehicle_ids:
            try:
                regen_metadata(vid, ue_version=args.ue_version, models_dir=models_dir_arg)
            except (FileNotFoundError, ValueError, OSError) as exc:
                logger.error("실패 %s: %s", vid, exc)
                failed.append(vid)

        if failed:
            sys.exit(1)
        return

    if not args.vehicle_id:
        parser.error("--vehicle_id 또는 --all 중 하나 필요")

    try:
        regen_metadata(
            vehicle_id=args.vehicle_id,
            vehicle_name=args.vehicle_name,
            ue_version=args.ue_version,
            models_dir=models_dir_arg,
        )
    except (FileNotFoundError, ValueError, OSError) as exc:
        logger.error("재생성 실패: %s", exc)
        sys.exit(1)


if __name__ == "__main__":
    main()
