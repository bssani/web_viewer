# Copyright (c) 2025 GM Technical Center Korea — PQDQ Team

"""UE5 export 폴더 감시 + 자동 압축 스크립트.

지정된 폴더를 감시하여 GLB 파일이 추가/수정되면
파일 안정화 판정 후 compress.compress_glb() 함수를 호출한다.

실행 방법:
    python pipeline/watch.py
"""

import json
import logging
import sys
import threading
import time
from pathlib import Path

from watchdog.observers import Observer
from watchdog.events import FileSystemEventHandler

# 같은 패키지의 compress 모듈 임포트
from compress import compress_glb, VALID_ZONES

logger = logging.getLogger("vehicle_viewer")

# 스크립트 기준 경로
SCRIPT_DIR = Path(__file__).resolve().parent
CONFIG_PATH = SCRIPT_DIR / "config.json"

# 상수
DEBOUNCE_SECONDS = 2.0
STABILIZE_SECONDS = 5.0
STABILIZE_CHECK_INTERVAL = 1.0


def load_config() -> dict:
    """config.json에서 설정을 읽어온다.

    Returns:
        설정 딕셔너리
    """
    if not CONFIG_PATH.is_file():
        logger.error("설정 파일을 찾을 수 없습니다: %s", CONFIG_PATH)
        sys.exit(1)

    config = json.loads(CONFIG_PATH.read_text(encoding="utf-8"))

    required_keys = ["watch_folder", "vehicle_id", "vehicle_name", "ue_version"]
    for key in required_keys:
        if key not in config:
            logger.error("config.json에 '%s' 키가 없습니다", key)
            sys.exit(1)

    return config


def is_file_unlocked(filepath: Path) -> bool:
    """Windows에서 파일이 다른 프로세스에 의해 락 걸려있는지 확인.

    반드시 쓰기 모드('rb+')로 열어야 정확한 체크 가능.
    읽기 모드('rb')는 UE5가 쓰는 중에도 성공할 수 있음.
    """
    try:
        with open(filepath, "rb+"):
            pass
        return True
    except (PermissionError, OSError):
        return False


def wait_for_stable(filepath: Path) -> bool:
    """파일이 안정화될 때까지 대기한다.

    5초간 크기 변화 없음 + 5초간 mtime 변화 없음 + 파일 락 해제
    세 조건 모두 충족해야 True 반환.

    Args:
        filepath: 감시 대상 파일

    Returns:
        안정화 성공 여부 (파일 삭제 등으로 실패 시 False)
    """
    logger.info("안정화 대기 시작: %s", filepath)

    try:
        prev_size = filepath.stat().st_size
        prev_mtime = filepath.stat().st_mtime
    except OSError:
        return False

    stable_since = time.monotonic()

    while True:
        time.sleep(STABILIZE_CHECK_INTERVAL)

        try:
            current_size = filepath.stat().st_size
            current_mtime = filepath.stat().st_mtime
        except OSError:
            logger.warning("파일이 사라졌습니다: %s", filepath)
            return False

        # 크기 또는 mtime이 변했으면 타이머 리셋
        if current_size != prev_size or current_mtime != prev_mtime:
            prev_size = current_size
            prev_mtime = current_mtime
            stable_since = time.monotonic()
            continue

        elapsed = time.monotonic() - stable_since
        if elapsed >= STABILIZE_SECONDS:
            # 파일 락 체크
            if is_file_unlocked(filepath):
                logger.info("파일 안정화 완료 (%.1f초 경과): %s", elapsed, filepath)
                return True
            # 락이 아직 걸려있으면 계속 대기
            logger.debug("파일 락 대기 중: %s", filepath)


class GLBHandler(FileSystemEventHandler):
    """GLB 파일 생성/수정 이벤트를 처리하는 핸들러.

    동일 파일에 대해 2초 디바운싱을 적용하고,
    안정화 판정 후 compress_glb를 호출한다.
    """

    def __init__(self, config: dict) -> None:
        super().__init__()
        self._vehicle_id: str = config["vehicle_id"]
        self._vehicle_name: str = config["vehicle_name"]
        self._ue_version: str = config["ue_version"]
        self._models_dir = self._resolve_models_dir(config)

        # 디바운스 타이머 관리
        self._timers: dict[str, threading.Timer] = {}
        self._lock = threading.Lock()

    @staticmethod
    def _resolve_models_dir(config: dict) -> Path:
        """models_dir 경로를 결정한다. config에 없으면 기본값 사용."""
        raw = config.get("models_dir", "backend/models_dir")
        path = Path(raw)
        if not path.is_absolute():
            # 프로젝트 루트 기준
            path = SCRIPT_DIR.parent / path
        return path

    def _is_glb(self, path: str) -> bool:
        """GLB 파일인지 확인한다 (대소문자 무관)."""
        return path.lower().endswith(".glb")

    def _detect_zone(self, filepath: Path) -> str | None:
        """파일명에서 구역을 감지한다.

        Args:
            filepath: GLB 파일 경로

        Returns:
            구역 이름 또는 None (매칭 실패)
        """
        stem = filepath.stem.lower()
        if stem in VALID_ZONES:
            return stem
        logger.warning("인식할 수 없는 구역 파일명: %s (허용: %s)", filepath.name, ", ".join(sorted(VALID_ZONES)))
        return None

    def _process_file(self, filepath_str: str) -> None:
        """파일 안정화 판정 후 압축을 실행한다."""
        filepath = Path(filepath_str)

        if not filepath.exists():
            return

        zone = self._detect_zone(filepath)
        if zone is None:
            return

        # 안정화 대기
        if not wait_for_stable(filepath):
            return

        # 압축 실행
        logger.info("압축 시작: %s → %s/%s", filepath, self._vehicle_id, zone)
        try:
            result = compress_glb(
                input_path=filepath,
                vehicle_id=self._vehicle_id,
                zone=zone,
                vehicle_name=self._vehicle_name,
                ue_version=self._ue_version,
                models_dir=self._models_dir,
            )
            logger.info(
                "압축 완료: %s/%s (%d bytes, hash=%s)",
                self._vehicle_id, zone,
                result.get("file_size_bytes", 0),
                result.get("file_hash", "")[:8],
            )
        except Exception as exc:
            logger.error("압축 실패: %s/%s — %s", self._vehicle_id, zone, exc)

    def _schedule_processing(self, filepath: str) -> None:
        """2초 디바운스 후 파일 처리를 예약한다."""
        with self._lock:
            # 기존 타이머 취소
            if filepath in self._timers:
                self._timers[filepath].cancel()

            # 새 타이머 설정
            timer = threading.Timer(
                DEBOUNCE_SECONDS,
                self._process_file,
                args=[filepath],
            )
            timer.daemon = True
            self._timers[filepath] = timer
            timer.start()

    def on_created(self, event) -> None:
        """파일 생성 이벤트 처리."""
        if event.is_directory or not self._is_glb(event.src_path):
            return
        logger.debug("파일 생성 감지: %s", event.src_path)
        self._schedule_processing(event.src_path)

    def on_modified(self, event) -> None:
        """파일 수정 이벤트 처리."""
        if event.is_directory or not self._is_glb(event.src_path):
            return
        logger.debug("파일 수정 감지: %s", event.src_path)
        self._schedule_processing(event.src_path)


def main() -> None:
    """메인 감시 루프를 실행한다."""
    # 로깅 설정
    logging.basicConfig(
        level=logging.INFO,
        format="%(asctime)s [%(levelname)s] %(name)s — %(message)s",
        datefmt="%Y-%m-%d %H:%M:%S",
    )

    config = load_config()
    watch_folder = Path(config["watch_folder"])

    if not watch_folder.is_dir():
        logger.warning("감시 폴더가 존재하지 않아 생성합니다: %s", watch_folder)
        watch_folder.mkdir(parents=True, exist_ok=True)

    logger.info("=== GLB 파일 감시 시작 ===")
    logger.info("감시 폴더: %s", watch_folder)
    logger.info("차량 ID: %s", config["vehicle_id"])
    logger.info("차량 이름: %s", config["vehicle_name"])
    logger.info("UE5 버전: %s", config["ue_version"])
    logger.info("종료하려면 Ctrl+C를 누르세요")

    handler = GLBHandler(config)
    observer = Observer()
    observer.schedule(handler, str(watch_folder), recursive=True)
    observer.start()

    try:
        while True:
            time.sleep(1)
    except KeyboardInterrupt:
        logger.info("감시 종료 중...")
        observer.stop()

    observer.join()
    logger.info("감시 종료 완료")


if __name__ == "__main__":
    main()
