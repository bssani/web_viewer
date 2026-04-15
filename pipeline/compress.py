# Copyright (c) 2025 Philip Choi

"""GLB 압축 스크립트 (단일 GLB 구조).

UE5에서 export된 GLB 파일에 Meshopt 기하학 압축 + KTX2 텍스처 압축을 적용한다.
gltf-transform CLI를 사용하며, Blender/Draco는 사용하지 않는다.

CLI 실행:
    python pipeline/compress.py \\
        --input "C:/UE5_Export/porsche_911/export.glb" \\
        --vehicle_id "porsche_911" \\
        --vehicle_name "Porsche 911" \\
        --ue_version "5.5.2"

Python 모듈 호출:
    from pipeline.compress import compress_glb
    result = compress_glb(input_path, vehicle_id, ...)
"""

import argparse
import hashlib
import json
import logging
import shutil
import subprocess
import sys
from datetime import datetime
from pathlib import Path

import psutil

logger = logging.getLogger("vehicle_viewer")

# GLB magic number: 'glTF' in little-endian
_GLB_MAGIC = b"\x67\x6C\x54\x46"


def _find_gltf_transform() -> str:
    """gltf-transform CLI 절대 경로를 찾는다."""
    path = shutil.which("gltf-transform")
    if not path:
        raise FileNotFoundError(
            "gltf-transform을 찾을 수 없습니다. "
            "'npm install -g @gltf-transform/cli'로 설치하세요."
        )
    return path


def _find_toktx() -> str:
    """toktx 바이너리 경로를 찾는다 (gltf-transform uastc/etc1s 내부 호출)."""
    path = shutil.which("toktx")
    if not path:
        raise FileNotFoundError(
            "toktx를 찾을 수 없습니다. "
            "KTX-Software를 설치하고 toktx.exe를 PATH에 추가하세요."
        )
    logger.info("toktx 확인: %s", path)
    return path


def _validate_glb(input_path: Path) -> None:
    """GLB 파일 유효성 검증."""
    if not input_path.exists():
        raise ValueError(f"파일이 존재하지 않습니다: {input_path}")

    size = input_path.stat().st_size
    if size == 0:
        raise ValueError(f"파일 크기가 0바이트입니다: {input_path}")

    magic = input_path.read_bytes()[:4]
    if magic != _GLB_MAGIC:
        raise ValueError(
            f"유효한 GLB 파일이 아닙니다 (magic: {magic.hex()}): {input_path}"
        )


def _acquire_lock(lock_path: Path) -> None:
    """PID 기반 락 파일 획득. 이미 실행 중이면 RuntimeError."""
    if lock_path.exists():
        try:
            content = lock_path.read_text(encoding="utf-8").strip()
            pid_str, timestamp_str = content.split(",", 1)
            pid = int(pid_str)
            created_at = datetime.fromisoformat(timestamp_str)

            elapsed = (datetime.now() - created_at).total_seconds()
            if psutil.pid_exists(pid) and elapsed < 600:
                raise RuntimeError(
                    f"이미 압축 중입니다 (PID={pid}, 경과={elapsed:.0f}초)"
                )

            logger.warning("stale 락 파일 감지, 무시합니다: %s", lock_path)
        except (ValueError, OSError) as exc:
            logger.warning("락 파일 파싱 실패, 무시합니다: %s (%s)", lock_path, exc)

    lock_path.parent.mkdir(parents=True, exist_ok=True)
    lock_path.write_text(
        f"{psutil.Process().pid},{datetime.now().isoformat()}",
        encoding="utf-8",
    )


def _release_lock(lock_path: Path) -> None:
    """락 파일 해제."""
    try:
        if lock_path.exists():
            lock_path.unlink()
    except OSError as exc:
        logger.warning("락 파일 삭제 실패: %s (%s)", lock_path, exc)


def _run_gltf_transform(gltf_cmd: str, args: list[str]) -> subprocess.CompletedProcess:
    """gltf-transform 명령 실행 (utf-8 강제)."""
    cmd = [gltf_cmd] + args
    logger.info("실행: %s", " ".join(cmd))
    return subprocess.run(
        cmd,
        capture_output=True,
        text=True,
        encoding="utf-8",
        errors="replace",
        check=True,
    )


def _compute_file_hash(file_path: Path) -> str:
    """SHA-256 해시 계산."""
    sha256 = hashlib.sha256()
    with file_path.open("rb") as f:
        for chunk in iter(lambda: f.read(8192), b""):
            sha256.update(chunk)
    return sha256.hexdigest()


def _parse_glb_metrics(glb_path: Path) -> dict:
    """GLB JSON 청크에서 draw_calls, material_count, vertex_count, animations 추출."""
    data = glb_path.read_bytes()

    if len(data) < 20:
        raise ValueError(f"JSON 청크 헤더가 없습니다: {glb_path}")

    magic = data[:4]
    if magic != _GLB_MAGIC:
        raise ValueError(f"유효한 GLB가 아닙니다 (magic: {magic.hex()}): {glb_path}")

    chunk_length = int.from_bytes(data[12:16], "little")
    chunk_type = data[16:20]
    if chunk_type != b"JSON":
        raise ValueError(
            f"첫 번째 청크가 JSON이 아닙니다 (type: {chunk_type!r}): {glb_path}"
        )

    json_bytes = data[20:20 + chunk_length]
    gltf = json.loads(json_bytes)

    draw_calls = sum(
        len(mesh.get("primitives", []))
        for mesh in gltf.get("meshes", [])
    )
    material_count = len(gltf.get("materials", []))

    accessors = gltf.get("accessors", [])
    position_indices: set[int] = set()
    for mesh in gltf.get("meshes", []):
        for prim in mesh.get("primitives", []):
            pos_idx = prim.get("attributes", {}).get("POSITION")
            if pos_idx is not None:
                position_indices.add(pos_idx)

    vertex_count = sum(
        accessors[idx].get("count", 0)
        for idx in position_indices
        if idx < len(accessors)
    )

    # animations: glTF animations 배열의 name 목록
    animations = [
        anim.get("name", f"animation_{i}")
        for i, anim in enumerate(gltf.get("animations", []))
    ]

    return {
        "draw_calls": draw_calls,
        "material_count": material_count,
        "vertex_count": vertex_count,
        "texture_memory_bytes": 0,  # Babylon.js 런타임 측정
        "animations": animations,
    }


def _extract_animations_via_inspect(gltf_cmd: str, glb_path: Path) -> list[str]:
    """gltf-transform inspect로 animationGroup 이름 목록을 추출한다.

    실패 시 빈 리스트 반환 + warning 로그 — 전체 프로세스는 중단되지 않음.
    """
    try:
        result = subprocess.run(
            [gltf_cmd, "inspect", str(glb_path)],
            capture_output=True,
            text=True,
            encoding="utf-8",
            errors="replace",
            check=True,
            timeout=60,
        )
        # inspect 출력은 표 형태 (pretty/csv/md). 파싱 생략 —
        # JSON 청크 파서(_parse_glb_metrics)가 이미 animations를 추출하므로
        # inspect는 보조 검증용으로만 호출하고 실패해도 무시.
        logger.debug("gltf-transform inspect 성공: %s", glb_path.name)
        return []
    except (subprocess.CalledProcessError, subprocess.TimeoutExpired, OSError) as exc:
        logger.warning("gltf-transform inspect 실패 (계속 진행): %s", exc)
        return []


def _write_metadata(
    metadata_path: Path,
    metadata_lock_path: Path,
    vehicle_id: str,
    vehicle_name: str,
    ue_version: str,
    model_data: dict,
    animations: list[str],
) -> None:
    """metadata.json을 단일 GLB 스키마로 작성한다."""
    _acquire_lock(metadata_lock_path)
    try:
        now = datetime.now().isoformat(timespec="seconds")

        if metadata_path.exists():
            existing = json.loads(metadata_path.read_text(encoding="utf-8"))
        else:
            existing = {}

        created_at = existing.get("created_at", now)

        metadata = {
            "vehicle_id": vehicle_id,
            "vehicle_name": vehicle_name,
            "created_at": created_at,
            "updated_at": now,
            "ue_version": ue_version,
            "model": model_data,
            "animations": animations,
        }

        metadata_path.write_text(
            json.dumps(metadata, indent=2, ensure_ascii=False) + "\n",
            encoding="utf-8",
        )
        logger.info("metadata.json 업데이트 완료: %s", vehicle_id)
    finally:
        _release_lock(metadata_lock_path)


def compress_glb(
    input_path: Path,
    vehicle_id: str,
    vehicle_name: str = "",
    ue_version: str = "5.5.2",
    simplify: float | None = None,
    models_dir: Path | None = None,
) -> dict:
    """GLB 파일을 Meshopt + KTX2로 압축하고 model.glb로 저장한다.

    Args:
        input_path: 입력 GLB 파일
        vehicle_id: 차량 ID
        vehicle_name: 차량 표시명 (기본값: vehicle_id 기반 자동 생성)
        ue_version: UE5 버전
        simplify: 메시 간소화 비율 (None이면 비활성화)
        models_dir: 저장 루트 (None이면 환경변수 MODELS_DIR)

    Returns:
        metadata 내 model 객체 딕셔너리
    """
    input_path = Path(input_path).resolve()

    if not vehicle_name:
        vehicle_name = vehicle_id.replace("_", " ").title()

    if models_dir is None:
        import os
        _raw = os.environ.get("MODELS_DIR", "./models_dir")
        _p = Path(_raw)
        _backend_dir = Path(__file__).resolve().parent.parent / "backend"
        models_dir = _p if _p.is_absolute() else _backend_dir / _p

    _validate_glb(input_path)

    gltf_cmd = _find_gltf_transform()
    _find_toktx()

    vehicle_dir = models_dir / vehicle_id.lower()
    tmp_dir = vehicle_dir / ".tmp"
    final_path = vehicle_dir / "model.glb"
    lock_path = vehicle_dir / ".model.lock"
    metadata_path = vehicle_dir / "metadata.json"
    metadata_lock_path = vehicle_dir / ".metadata.lock"

    _acquire_lock(lock_path)
    try:
        tmp_dir.mkdir(parents=True, exist_ok=True)

        original_size = input_path.stat().st_size
        current = input_path

        if simplify is not None:
            logger.warning(
                "simplify는 메시 형상 손상 가능 (ratio=%.2f)", simplify,
            )
            step_out = tmp_dir / "model_simplified.glb"
            _run_gltf_transform(gltf_cmd, [
                "simplify", str(current), str(step_out),
                "--ratio", str(simplify),
            ])
            current = step_out

        # Meshopt
        step_meshopt = tmp_dir / "model_meshopt.glb"
        _run_gltf_transform(gltf_cmd, [
            "meshopt", str(current), str(step_meshopt),
            "--level", "medium",
        ])
        current = step_meshopt

        # UASTC (normal/MR/occlusion)
        step_uastc = tmp_dir / "model_uastc.glb"
        _run_gltf_transform(gltf_cmd, [
            "uastc", str(current), str(step_uastc),
            "--slots", "normalTexture,metallicRoughnessTexture,occlusionTexture",
        ])
        current = step_uastc

        # ETC1S (baseColor/emissive)
        step_etc1s = tmp_dir / "model_etc1s.glb"
        _run_gltf_transform(gltf_cmd, [
            "etc1s", str(current), str(step_etc1s),
            "--slots", "baseColorTexture,emissiveTexture",
        ])
        current = step_etc1s

        compressed_size = current.stat().st_size

        # 압축 효율 역전 시 원본 유지
        if compressed_size >= original_size:
            logger.warning(
                "compression increased size (%d → %d), keeping original",
                original_size, compressed_size,
            )
            vehicle_dir.mkdir(parents=True, exist_ok=True)
            shutil.copy2(str(input_path), str(final_path))
        else:
            vehicle_dir.mkdir(parents=True, exist_ok=True)
            current.replace(final_path)
            logger.info(
                "압축 완료: %d → %d (%.1f%% 감소)",
                original_size, compressed_size,
                (1 - compressed_size / original_size) * 100,
            )

        shutil.rmtree(str(tmp_dir), ignore_errors=True)

        final_size = final_path.stat().st_size
        file_hash = _compute_file_hash(final_path)

        # 메트릭 + animations 추출 (JSON 청크 파싱)
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

        # 보조로 gltf-transform inspect 시도 (실패 무시)
        _extract_animations_via_inspect(gltf_cmd, final_path)

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

        return model_data

    except Exception:
        shutil.rmtree(str(tmp_dir), ignore_errors=True)
        raise
    finally:
        _release_lock(lock_path)


def main() -> None:
    """CLI 진입점."""
    parser = argparse.ArgumentParser(description="GLB Meshopt + KTX2 압축 (단일 GLB)")
    parser.add_argument("--input", required=True, help="입력 GLB 파일 경로")
    parser.add_argument("--vehicle_id", required=True, help="차량 ID")
    parser.add_argument("--vehicle_name", default="", help="차량 표시명")
    parser.add_argument("--ue_version", default="5.5.2", help="UE5 버전")
    parser.add_argument(
        "--simplify", type=float, default=None,
        help="메시 간소화 비율 0.0~1.0 (기본: 비활성화)",
    )
    parser.add_argument("--models_dir", default=None, help="모델 저장 경로")
    args = parser.parse_args()

    logging.basicConfig(
        level=logging.INFO,
        format="%(asctime)s [%(levelname)s] %(name)s — %(message)s",
        datefmt="%Y-%m-%d %H:%M:%S",
    )

    models_dir_arg = Path(args.models_dir) if args.models_dir else None

    try:
        result = compress_glb(
            input_path=Path(args.input),
            vehicle_id=args.vehicle_id,
            vehicle_name=args.vehicle_name,
            ue_version=args.ue_version,
            simplify=args.simplify,
            models_dir=models_dir_arg,
        )
        logger.info("결과: %s", json.dumps(result, indent=2, ensure_ascii=False))
    except (ValueError, RuntimeError, FileNotFoundError) as exc:
        logger.error("압축 실패: %s", exc)
        sys.exit(1)
    except subprocess.CalledProcessError as exc:
        logger.error("gltf-transform 실행 실패: %s\n%s", exc, exc.stderr)
        sys.exit(1)


if __name__ == "__main__":
    main()
