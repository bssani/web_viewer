# Copyright (c) 2025 Philip Choi

"""공통 설정. 환경변수 기반으로 설정값을 읽어온다."""

import logging
from pathlib import Path

from dotenv import load_dotenv

# .env 파일 로드 (backend/ 디렉토리 기준)
_backend_dir = Path(__file__).resolve().parent.parent
load_dotenv(_backend_dir / ".env")


def setup_logging(log_file: Path | None = None) -> None:
    """로깅 설정. 콘솔 + 파일 로그 출력.

    Args:
        log_file: 로그 파일 경로. None이면 콘솔만 출력.
    """
    handlers: list[logging.Handler] = [logging.StreamHandler()]

    if log_file:
        log_file.parent.mkdir(parents=True, exist_ok=True)
        file_handler = logging.FileHandler(log_file, encoding="utf-8")
        handlers.append(file_handler)

    logging.basicConfig(
        level=logging.INFO,
        format="%(asctime)s [%(levelname)s] %(name)s — %(message)s",
        datefmt="%Y-%m-%d %H:%M:%S",
        handlers=handlers,
    )
