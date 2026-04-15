# Copyright (c) 2025 Philip Choi

"""UE5 export 폴더 감시 + 자동 압축 스크립트 (단일 GLB 구조).

지정된 폴더를 감시하여 config.json의 `source_filename`과 정확히 일치하는
GLB 파일이 추가/수정되면 안정화 판정 후 compress_glb()를 호출한다.
임시 파일(test.glb, temp_*.glb 등)에는 반응하지 않는다.

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

from compress import compress_glb

logger = logging.getLogger("vehicle_viewer")

SCRIPT_DIR = Path(__file__).resolve().parent
CONFIG_PATH = SCRIPT_DIR / "config.json"

DEBOUNCE_SECONDS = 2.0
STABILIZE_SECONDS = 5.0
STABILIZE_CHECK_INTERVAL = 1.0

# 기본 감시 대상 파일명 (config에 source_filename 없을 때)
DEFAULT_SOURCE_FILENAME = "export.glb"


def load_config() -> dict:
    """config.json에서 설정을 읽어온다."""
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
    """Windows 파일 락 체크 (쓰기 모드 필수)."""
    try:
        with open(filepath, "rb+"):
            pass
        return True
    except (PermissionError, OSError):
        return False


def wait_for_stable(filepath: Path) -> bool:
    """파일 안정화 대기 (크기+mtime 5초 안정 + 락 해제)."""
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

        if current_size != prev_size or current_mtime != prev_mtime:
            prev_size = current_size
            prev_mtime = current_mtime
            stable_since = time.monotonic()
            continue

        elapsed = time.monotonic() - stable_since
        if elapsed >= STABILIZE_SECONDS:
            if is_file_unlocked(filepath):
                logger.info("파일 안정화 완료 (%.1f초 경과): %s", elapsed, filepath)
                return True
            logger.debug("파일 락 대기 중: %s", filepath)


class GLBHandler(FileSystemEventHandler):
    """지정된 파일명(source_filename)에만 반응하는 핸들러."""

    def __init__(self, config: dict) -> None:
        super().__init__()
        self._vehicle_id: str = config["vehicle_id"]
        self._vehicle_name: str = config["vehicle_name"]
        self._ue_version: str = config["ue_version"]
        self._source_filename: str = config.get(
            "source_filename", DEFAULT_SOURCE_FILENAME
        ).lower()
        self._models_dir = self._resolve_models_dir(config)

        self._timers: dict[str, threading.Timer] = {}
        self._lock = threading.Lock()

        logger.info("감시 대상 파일명: %s", self._source_filename)

    @staticmethod
    def _resolve_models_dir(config: dict) -> Path:
        """models_dir 경로 결정."""
        raw = config.get("models_dir", "backend/models_dir")
        path = Path(raw)
        if not path.is_absolute():
            path = SCRIPT_DIR.parent / path
        return path

    def _is_target_file(self, path: str) -> bool:
        """config에서 지정한 source_filename과 정확히 일치하는지 확인."""
        return Path(path).name.lower() == self._source_filename

    def _process_file(self, filepath_str: str) -> None:
        """파일 안정화 후 압축 실행."""
        filepath = Path(filepath_str)
        if not filepath.exists():
            return

        if not wait_for_stable(filepath):
            return

        logger.info("압축 시작: %s → %s", filepath, self._vehicle_id)
        try:
            result = compress_glb(
                input_path=filepath,
                vehicle_id=self._vehicle_id,
                vehicle_name=self._vehicle_name,
                ue_version=self._ue_version,
                models_dir=self._models_dir,
            )
            logger.info(
                "압축 완료: %s (%d bytes, hash=%s)",
                self._vehicle_id,
                result.get("file_size_bytes", 0),
                result.get("file_hash", "")[:8],
            )
        except Exception as exc:
            logger.error("압축 실패: %s — %s", self._vehicle_id, exc)

    def _schedule_processing(self, filepath: str) -> None:
        """2초 디바운스 후 압축 예약."""
        with self._lock:
            if filepath in self._timers:
                self._timers[filepath].cancel()

            timer = threading.Timer(
                DEBOUNCE_SECONDS,
                self._process_file,
                args=[filepath],
            )
            timer.daemon = True
            self._timers[filepath] = timer
            timer.start()

    def on_created(self, event) -> None:
        if event.is_directory or not self._is_target_file(event.src_path):
            return
        logger.debug("파일 생성 감지: %s", event.src_path)
        self._schedule_processing(event.src_path)

    def on_modified(self, event) -> None:
        if event.is_directory or not self._is_target_file(event.src_path):
            return
        logger.debug("파일 수정 감지: %s", event.src_path)
        self._schedule_processing(event.src_path)


def main() -> None:
    """메인 감시 루프."""
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
