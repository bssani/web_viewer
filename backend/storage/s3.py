# Copyright (c) 2025 GM Technical Center Korea — PQDQ Team

"""S3 기반 스토리지 구현 skeleton. Phase 6에서 구현 예정."""

from pathlib import Path

from .base import StorageBackend


class S3Storage(StorageBackend):
    """S3 스토리지 백엔드. Phase 6에서 boto3로 구현."""

    def exists(self, key: str) -> bool:
        raise NotImplementedError("Phase 6")

    def read_bytes(self, key: str) -> bytes:
        raise NotImplementedError("Phase 6")

    def write_bytes(self, key: str, data: bytes) -> None:
        raise NotImplementedError("Phase 6")

    def delete(self, key: str) -> None:
        raise NotImplementedError("Phase 6")

    def list_prefix(self, prefix: str) -> list[str]:
        raise NotImplementedError("Phase 6")

    def get_local_path(self, key: str) -> Path:
        raise NotImplementedError("Phase 6")
