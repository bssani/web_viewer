# Copyright (c) 2025 GM Technical Center Korea — PQDQ Team

"""GLB 압축 스크립트.

UE5에서 export된 GLB 파일에 Meshopt 기하학 압축 + KTX2 텍스처 압축을 적용한다.
gltf-transform CLI를 사용하며, Blender/Draco는 사용하지 않는다.

CLI 실행:
    python pipeline/compress.py \\
        --input "C:/UE5_Export/vehicle_a/exterior.glb" \\
        --vehicle_id "vehicle_a" \\
        --vehicle_name "Vehicle A" \\
        --zone "exterior" \\
        --ue_version "5.5.2"

Python 모듈 호출:
    from pipeline.compress import compress_glb
    result = compress_glb(input_path, vehicle_id, zone, ...)
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

# 유효한 구역 이름
VALID_ZONES = {"exterior", "interior", "chassis", "powertrain"}


def _find_gltf_transform() -> str:
    """gltf-transform CLI 절대 경로를 찾는다.

    Returns:
        gltf-transform 실행 파일 절대 경로

    Raises:
        FileNotFoundError: gltf-transform이 PATH에 없을 때
    """
    path = shutil.which("gltf-transform")
    if not path:
        raise FileNotFoundError(
            "gltf-transform을 찾을 수 없습니다. "
            "'npm install -g @gltf-transform/cli'로 설치하세요."
        )
    return path


def _validate_glb(input_path: Path) -> None:
    """GLB 파일의 유효성을 검증한다.

    Args:
        input_path: 검증할 GLB 파일 경로

    Raises:
        ValueError: 파일이 유효한 GLB가 아닐 때
    """
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
    """락 파일을 획득한다. 이미 실행 중이면 예외 발생.

    Args:
        lock_path: 락 파일 경로

    Raises:
        RuntimeError: 이미 다른 프로세스가 실행 중일 때
    """
    if lock_path.exists():
        try:
            content = lock_path.read_text(encoding="utf-8").strip()
            pid_str, timestamp_str = content.split(",", 1)
            pid = int(pid_str)
            created_at = datetime.fromisoformat(timestamp_str)

            # PID가 살아있고 10분 이내면 이미 실행 중
            elapsed = (datetime.now() - created_at).total_seconds()
            if psutil.pid_exists(pid) and elapsed < 600:
                raise RuntimeError(
                    f"이미 압축 중입니다 (PID={pid}, 경과={elapsed:.0f}초)"
                )

            # stale 락 — 무시하고 진행
            logger.warning("stale 락 파일 감지, 무시합니다: %s", lock_path)
        except (ValueError, OSError) as exc:
            logger.warning("락 파일 파싱 실패, 무시합니다: %s (%s)", lock_path, exc)

    # 새 락 파일 생성
    lock_path.parent.mkdir(parents=True, exist_ok=True)
    lock_path.write_text(
        f"{psutil.Process().pid},{datetime.now().isoformat()}",
        encoding="utf-8",
    )


def _release_lock(lock_path: Path) -> None:
    """락 파일을 해제한다."""
    try:
        if lock_path.exists():
            lock_path.unlink()
    except OSError as exc:
        logger.warning("락 파일 삭제 실패: %s (%s)", lock_path, exc)


def _run_gltf_transform(gltf_cmd: str, args: list[str]) -> subprocess.CompletedProcess:
    """gltf-transform 명령을 실행한다.

    Args:
        gltf_cmd: gltf-transform 실행 파일 경로
        args: gltf-transform에 전달할 인자 리스트

    Returns:
        실행 결과

    Raises:
        subprocess.CalledProcessError: 명령 실행 실패 시
    """
    cmd = [gltf_cmd] + args
    logger.info("실행: %s", " ".join(cmd))
    return subprocess.run(
        cmd,
        capture_output=True,
        text=True,
        encoding="utf-8",
        check=True,
    )


def _compute_file_hash(file_path: Path) -> str:
    """파일의 SHA-256 해시를 계산한다."""
    sha256 = hashlib.sha256()
    with file_path.open("rb") as f:
        for chunk in iter(lambda: f.read(8192), b""):
            sha256.update(chunk)
    return sha256.hexdigest()


def _inspect_glb(gltf_cmd: str, glb_path: Path) -> dict:
    """gltf-transform inspect로 GLB 정보를 추출한다.

    Args:
        gltf_cmd: gltf-transform 실행 파일 경로
        glb_path: 검사할 GLB 파일 경로

    Returns:
        검사 결과 딕셔너리
    """
    result = _run_gltf_transform(gltf_cmd, [
        "inspect", str(glb_path), "--format", "json",
    ])
    return json.loads(result.stdout)


def _extract_metrics(info: dict) -> dict:
    """gltf-transform inspect 결과에서 메트릭을 추출한다.

    Args:
        info: gltf-transform inspect --format json 결과

    Returns:
        draw_calls, material_count, vertex_count, texture_memory_bytes 딕셔너리
    """
    # primitives(draw calls) 수 계산
    draw_calls = 0
    meshes = info.get("meshes", info.get("scenes", {}).get("properties", []))
    if isinstance(meshes, dict):
        # meshes.properties 내 각 메시의 primitives 수
        for mesh_info in meshes.get("properties", []):
            draw_calls += mesh_info.get("primitives", 1)
    elif isinstance(meshes, list):
        draw_calls = len(meshes)

    # 머티리얼 수
    materials = info.get("materials", {})
    if isinstance(materials, dict):
        material_count = len(materials.get("properties", []))
    elif isinstance(materials, list):
        material_count = len(materials)
    else:
        material_count = 0

    # vertex 수 계산
    vertex_count = 0
    accessors = info.get("accessors", {})
    if isinstance(accessors, dict):
        for acc in accessors.get("properties", []):
            if "POSITION" in acc.get("types", []):
                vertex_count += acc.get("count", 0)

    # 텍스처 메모리 추정 (RGBA8 디코딩 시)
    # width * height * 4 * mipmap_factor(1.33)
    texture_memory_bytes = 0
    textures = info.get("textures", {})
    if isinstance(textures, dict):
        for tex in textures.get("properties", []):
            w = tex.get("width", 0)
            h = tex.get("height", 0)
            if w > 0 and h > 0:
                # mipmap factor 약 1.33
                texture_memory_bytes += int(w * h * 4 * 1.33)

    return {
        "draw_calls": draw_calls,
        "material_count": material_count,
        "vertex_count": vertex_count,
        "texture_memory_bytes": texture_memory_bytes,
    }


def _update_metadata(
    metadata_path: Path,
    metadata_lock_path: Path,
    vehicle_id: str,
    vehicle_name: str,
    ue_version: str,
    zone: str,
    zone_data: dict,
) -> None:
    """metadata.json을 부분 업데이트한다. 다른 zone 데이터는 보존.

    Args:
        metadata_path: metadata.json 파일 경로
        metadata_lock_path: .metadata.lock 파일 경로
        vehicle_id: 차량 ID
        vehicle_name: 차량 표시명
        ue_version: UE5 버전
        zone: 구역 이름
        zone_data: 해당 zone의 메트릭 데이터
    """
    _acquire_lock(metadata_lock_path)
    try:
        now = datetime.now().isoformat(timespec="seconds")

        # 기존 metadata 읽기
        if metadata_path.exists():
            existing = json.loads(metadata_path.read_text(encoding="utf-8"))
        else:
            existing = {}

        # created_at은 최초 생성 시에만
        created_at = existing.get("created_at", now)

        metadata = {
            "vehicle_id": vehicle_id,
            "vehicle_name": vehicle_name,
            "created_at": created_at,
            "updated_at": now,
            "ue_version": ue_version,
            "zones": existing.get("zones", {}),
        }
        metadata["zones"][zone] = zone_data

        metadata_path.write_text(
            json.dumps(metadata, indent=2, ensure_ascii=False) + "\n",
            encoding="utf-8",
        )
        logger.info("metadata.json 업데이트 완료: %s/%s", vehicle_id, zone)
    finally:
        _release_lock(metadata_lock_path)


def compress_glb(
    input_path: Path,
    vehicle_id: str,
    zone: str,
    vehicle_name: str = "",
    ue_version: str = "5.5.2",
    simplify: float | None = None,
    models_dir: Path | None = None,
) -> dict:
    """GLB 파일을 Meshopt + KTX2로 압축한다.

    핵심 압축 로직. CLI와 Python 모듈 양쪽에서 호출 가능.

    Args:
        input_path: 입력 GLB 파일 경로
        vehicle_id: 차량 ID
        zone: 구역 이름 (exterior, interior, chassis, powertrain)
        vehicle_name: 차량 표시명 (기본값: vehicle_id 기반 자동 생성)
        ue_version: UE5 버전
        simplify: 메시 간소화 비율 (0.0~1.0, None이면 비활성화)
        models_dir: 모델 저장 경로 (기본값: 환경변수 MODELS_DIR)

    Returns:
        압축 결과 메트릭 딕셔너리

    Raises:
        ValueError: 유효하지 않은 입력
        RuntimeError: 이미 압축 중이거나 gltf-transform 실행 실패
        FileNotFoundError: gltf-transform 미설치
    """
    input_path = Path(input_path).resolve()
    zone_lower = zone.lower()

    if not vehicle_name:
        vehicle_name = vehicle_id.replace("_", " ").title()

    # models_dir 결정
    if models_dir is None:
        # 환경변수 기반 (config/local.py와 동일 로직)
        import os
        _raw = os.environ.get("MODELS_DIR", "./models_dir")
        _p = Path(_raw)
        _backend_dir = Path(__file__).resolve().parent.parent / "backend"
        models_dir = _p if _p.is_absolute() else _backend_dir / _p

    # 입력 검증
    _validate_glb(input_path)

    # gltf-transform 경로 확인
    gltf_cmd = _find_gltf_transform()

    # 경로 설정
    vehicle_dir = models_dir / vehicle_id
    tmp_dir = vehicle_dir / ".tmp"
    final_path = vehicle_dir / f"{zone_lower}.glb"
    lock_path = vehicle_dir / f".{zone_lower}.lock"
    metadata_path = vehicle_dir / "metadata.json"
    metadata_lock_path = vehicle_dir / ".metadata.lock"

    # 락 획득
    _acquire_lock(lock_path)
    try:
        # 임시 디렉토리 생성
        tmp_dir.mkdir(parents=True, exist_ok=True)

        original_size = input_path.stat().st_size
        current = input_path

        # 1단계: simplify (옵션)
        if simplify is not None:
            logger.warning(
                "simplify는 메시 형상 손상 가능, Phase 2 뷰어로 결과 검증 필수 (ratio=%.2f)",
                simplify,
            )
            step_out = tmp_dir / f"{zone_lower}_simplified.glb"
            _run_gltf_transform(gltf_cmd, [
                "simplify", str(current), str(step_out),
                "--ratio", str(simplify),
            ])
            current = step_out

        # 2단계: Meshopt 기하학 압축
        step_meshopt = tmp_dir / f"{zone_lower}_meshopt.glb"
        _run_gltf_transform(gltf_cmd, [
            "meshopt", str(current), str(step_meshopt),
            "--level", "medium",
        ])
        current = step_meshopt

        # 3단계: UASTC (normal, metallicRoughness, occlusion)
        step_uastc = tmp_dir / f"{zone_lower}_uastc.glb"
        _run_gltf_transform(gltf_cmd, [
            "uastc", str(current), str(step_uastc),
            "--slots", "normalTexture,metallicRoughnessTexture,occlusionTexture",
        ])
        current = step_uastc

        # 4단계: ETC1S (baseColor, emissive)
        step_etc1s = tmp_dir / f"{zone_lower}_etc1s.glb"
        _run_gltf_transform(gltf_cmd, [
            "etc1s", str(current), str(step_etc1s),
            "--slots", "baseColorTexture,emissiveTexture",
        ])
        current = step_etc1s

        compressed_size = current.stat().st_size

        # 압축 효율 역전 처리: 압축 결과가 원본보다 크면 원본 유지
        if compressed_size >= original_size:
            logger.warning(
                "compression increased size (%d → %d), keeping original",
                original_size,
                compressed_size,
            )
            # 원본을 최종 경로로 복사
            vehicle_dir.mkdir(parents=True, exist_ok=True)
            shutil.copy2(str(input_path), str(final_path))
        else:
            # 압축 결과를 최종 경로로 원자적 이동
            vehicle_dir.mkdir(parents=True, exist_ok=True)
            current.replace(final_path)
            logger.info(
                "압축 완료: %d → %d (%.1f%% 감소)",
                original_size,
                compressed_size,
                (1 - compressed_size / original_size) * 100,
            )

        # 임시 파일 정리
        shutil.rmtree(str(tmp_dir), ignore_errors=True)

        # 최종 파일 정보 수집
        final_size = final_path.stat().st_size
        file_hash = _compute_file_hash(final_path)

        # gltf-transform inspect로 메트릭 추출
        try:
            info = _inspect_glb(gltf_cmd, final_path)
            metrics = _extract_metrics(info)
        except (subprocess.CalledProcessError, json.JSONDecodeError) as exc:
            logger.warning("inspect 실패, 기본값 사용: %s", exc)
            metrics = {
                "draw_calls": 0,
                "material_count": 0,
                "vertex_count": 0,
                "texture_memory_bytes": 0,
            }

        zone_data = {
            "file": f"{zone_lower}.glb",
            "file_size_bytes": final_size,
            "file_hash": file_hash,
            **metrics,
        }

        # metadata.json 업데이트
        _update_metadata(
            metadata_path, metadata_lock_path,
            vehicle_id, vehicle_name, ue_version,
            zone_lower, zone_data,
        )

        return zone_data

    except Exception:
        # 실패 시 임시 파일 정리, 기존 최종 파일은 보존
        shutil.rmtree(str(tmp_dir), ignore_errors=True)
        raise
    finally:
        _release_lock(lock_path)


def main() -> None:
    """CLI 진입점. argparse로 compress_glb 함수를 호출하는 래퍼."""
    parser = argparse.ArgumentParser(description="GLB Meshopt + KTX2 압축")
    parser.add_argument("--input", required=True, help="입력 GLB 파일 경로")
    parser.add_argument("--vehicle_id", required=True, help="차량 ID")
    parser.add_argument("--vehicle_name", default="", help="차량 표시명")
    parser.add_argument("--zone", required=True, help="구역 (exterior/interior/chassis/powertrain)")
    parser.add_argument("--ue_version", default="5.5.2", help="UE5 버전")
    parser.add_argument(
        "--simplify", type=float, default=None,
        help="메시 간소화 비율 0.0~1.0 (기본: 비활성화, 형상 손상 주의)",
    )
    parser.add_argument("--models_dir", default=None, help="모델 저장 경로 (기본: 환경변수 MODELS_DIR)")
    args = parser.parse_args()

    # 로깅 설정
    logging.basicConfig(
        level=logging.INFO,
        format="%(asctime)s [%(levelname)s] %(name)s — %(message)s",
        datefmt="%Y-%m-%d %H:%M:%S",
    )

    zone_lower = args.zone.lower()
    if zone_lower not in VALID_ZONES:
        logger.error("유효하지 않은 구역: %s (허용: %s)", args.zone, ", ".join(sorted(VALID_ZONES)))
        sys.exit(1)

    models_dir_arg = Path(args.models_dir) if args.models_dir else None

    try:
        result = compress_glb(
            input_path=Path(args.input),
            vehicle_id=args.vehicle_id,
            zone=zone_lower,
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
