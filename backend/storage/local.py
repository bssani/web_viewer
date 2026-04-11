# Copyright (c) 2025 Philip Choi

"""로컬 파일 시스템 기반 스토리지 구현. Phase 1~5에서 사용."""

import logging
from pathlib import Path

from .base import StorageBackend

logger = logging.getLogger("vehicle_viewer")


class LocalStorage(StorageBackend):
    """로컬 파일 시스템 스토리지.

    키 형식: '{vehicle_id}/{filename}' (예: 'vehicle_a/exterior.glb')
    모든 키는 소문자로 강제 변환된다.
    """

    def __init__(self, base_dir: Path) -> None:
        """로컬 스토리지 초기화.

        Args:
            base_dir: 모델 파일이 저장되는 루트 디렉토리 (models_dir)
        """
        self._base_dir = base_dir
        self._base_dir.mkdir(parents=True, exist_ok=True)
        logger.info("LocalStorage 초기화: %s", self._base_dir)

    @property
    def base_dir(self) -> Path:
        """모델 저장 루트 디렉토리."""
        return self._base_dir

    def _resolve(self, key: str) -> Path:
        """키를 로컬 파일 경로로 변환한다. 소문자 강제."""
        return self._base_dir / key.lower()

    def exists(self, key: str) -> bool:
        """키에 해당하는 파일 존재 여부."""
        return self._resolve(key).exists()

    def read_bytes(self, key: str) -> bytes:
        """키에 해당하는 파일을 bytes로 읽기."""
        path = self._resolve(key)
        return path.read_bytes()

    def write_bytes(self, key: str, data: bytes) -> None:
        """키에 bytes 데이터 쓰기. 부모 디렉토리 자동 생성."""
        path = self._resolve(key)
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_bytes(data)

    def delete(self, key: str) -> None:
        """키에 해당하는 파일 삭제."""
        path = self._resolve(key)
        if path.exists():
            path.unlink()

    def list_prefix(self, prefix: str) -> list[str]:
        """프리픽스로 시작하는 키 목록. 디렉토리 기준 탐색."""
        prefix_lower = prefix.lower()
        prefix_path = self._base_dir / prefix_lower
        if not prefix_path.exists():
            return []

        results = []
        # 프리픽스가 디렉토리면 해당 디렉토리 내 파일 나열
        if prefix_path.is_dir():
            for item in prefix_path.rglob("*"):
                if item.is_file():
                    rel = item.relative_to(self._base_dir)
                    results.append(str(rel).replace("\\", "/"))
        return sorted(results)

    def get_local_path(self, key: str) -> Path:
        """StaticFiles 마운트용 로컬 경로 반환."""
        return self._resolve(key)
