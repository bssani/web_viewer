# Copyright (c) 2025 Philip Choi

"""Windows 데스크탑 환경 설정. Phase 1~5에서 사용."""

import os
from pathlib import Path

# backend/ 디렉토리 기준 절대 경로 해석
_backend_dir = Path(__file__).resolve().parent.parent

# 모델 저장 경로 (환경변수 또는 기본값)
_models_dir_raw = os.environ.get("MODELS_DIR", "./models_dir")
_models_dir_path = Path(_models_dir_raw)
MODELS_DIR: Path = _models_dir_path if _models_dir_path.is_absolute() else _backend_dir / _models_dir_path

# CORS 허용 출처 (쉼표 구분)
ALLOWED_ORIGINS: list[str] = [
    o.strip()
    for o in os.environ.get("ALLOWED_ORIGINS", "").split(",")
    if o.strip()
]

# 로그 파일 경로
_log_file_raw = os.environ.get("LOG_FILE", "./logs/vehicle_viewer.log")
_log_file_path = Path(_log_file_raw)
LOG_FILE: Path = _log_file_path if _log_file_path.is_absolute() else _backend_dir / _log_file_path
