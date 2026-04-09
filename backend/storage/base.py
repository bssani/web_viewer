# Copyright (c) 2025 GM Technical Center Korea — PQDQ Team

"""스토리지 백엔드 추상 인터페이스.

로컬 파일 시스템, S3, Azure Blob 등 구현체를 교체할 수 있도록
공통 인터페이스를 정의한다. Cloud 이전 시 구현체만 교체하면 된다.
"""

from abc import ABC, abstractmethod
from pathlib import Path


class StorageBackend(ABC):
    """스토리지 백엔드 추상 클래스."""

    @abstractmethod
    def exists(self, key: str) -> bool:
        """키에 해당하는 객체 존재 여부."""
        ...

    @abstractmethod
    def read_bytes(self, key: str) -> bytes:
        """키에 해당하는 객체를 bytes로 읽기."""
        ...

    @abstractmethod
    def write_bytes(self, key: str, data: bytes) -> None:
        """키에 bytes 데이터 쓰기."""
        ...

    @abstractmethod
    def delete(self, key: str) -> None:
        """키에 해당하는 객체 삭제."""
        ...

    @abstractmethod
    def list_prefix(self, prefix: str) -> list[str]:
        """프리픽스로 시작하는 키 목록."""
        ...

    @abstractmethod
    def get_local_path(self, key: str) -> Path:
        """StaticFiles 마운트용 로컬 경로 반환.

        로컬 백엔드는 실제 경로, S3 백엔드는 Presigned URL로 리다이렉트 대체.
        """
        ...
