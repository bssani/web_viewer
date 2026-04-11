# Phase 1 프롬프트 — GLB 압축 파이프라인 + FastAPI 파일 서버

## 목표
UE5 5.5.2에서 구역별로 export된 GLB 파일을 Meshopt + KTX2로 압축하고,
FastAPI로 브라우저에서 접근 가능한 파일 서버를 구축한다.
Cloud 이전 가능성에 대비해 스토리지 추상화 레이어를 Phase 1부터 적용한다.

> **중요**: 이 프롬프트는 CLAUDE.md의 규칙을 전제로 한다. 충돌이 발생하면 **CLAUDE.md가 우선**이다.

---

## 작업 내용

### 1. 프로젝트 초기 세팅
아래 구조로 프로젝트 폴더를 생성해줘:

```
vehicle-web-viewer/
├── CLAUDE.md                  (이미 존재, 건드리지 말 것)
├── .gitignore                 (이미 존재, 건드리지 말 것)
├── LICENSE                    (이미 존재, 건드리지 말 것)
├── backend/
│   ├── main.py
│   ├── routers/
│   │   └── vehicles.py
│   ├── middleware/
│   │   └── auth.py            # Phase 1은 no-op, Phase 6 대비 skeleton
│   ├── storage/
│   │   ├── base.py            # StorageBackend 추상 인터페이스
│   │   ├── local.py           # Phase 1~5 로컬 구현
│   │   └── s3.py              # Phase 6 skeleton만
│   ├── config/
│   │   ├── base.py
│   │   └── local.py
│   ├── models_dir/
│   │   └── sample_vehicle/
│   │       └── metadata.json
│   ├── requirements.txt
│   └── .env.example
└── pipeline/
    ├── compress.py
    ├── watch.py
    └── config.json
```

---

### 2. backend/storage/ — 스토리지 추상화 레이어

**이게 왜 필요한가**: Cloud 이전 시 파일 경로 조작 코드를 전부 뜯어고치지 않기 위해. 지금 인터페이스만 잡아두면 나중에 구현체만 교체하면 됨.

**`backend/storage/base.py`**:
```python
from abc import ABC, abstractmethod
from pathlib import Path

class StorageBackend(ABC):
    """스토리지 백엔드 추상 인터페이스.
    
    로컬 파일 시스템, S3, Azure Blob 등 구현체 교체 가능.
    """
    
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
```

**`backend/storage/local.py`**:
- `LocalStorage(StorageBackend)` 구현
- 환경변수 `MODELS_DIR` 기준 (`pathlib.Path` 사용)
- 키 형식: `{vehicle_id}/{filename}` (예: `vehicle_A/exterior.glb`)
- 모든 키는 소문자 강제

**`backend/storage/s3.py`**:
- 클래스 skeleton만 (모든 메서드 `raise NotImplementedError("Phase 6")`)
- Phase 6 진입 시 boto3로 구현

**`compress.py`와 `routers/vehicles.py`는 직접 파일 경로 조작 금지, 반드시 `StorageBackend` 인터페이스만 사용.**

---

### 3. pipeline/compress.py

UE5에서 export된 GLB 파일을 압축하는 스크립트.

**핵심 규칙:**
- `gltf-transform` CLI 도구 사용 (Node.js 기반)
- 기하학 압축: Meshopt
- 텍스처 압축: KTX2 + Basis Universal, **slot별로 UASTC/ETC1S 분리 적용 필수**
- Blender, Draco, `gltf-transform instance` 사용 금지 (instance는 Phase 4 이후 검토)
- 모든 경로는 `pathlib.Path` 사용 (`os.path` 금지)
- 모든 `subprocess.run()` 호출에 **`encoding='utf-8'` 명시** (한글 경로 호환)
- `gltf-transform` 호출은 `shutil.which("gltf-transform")`으로 절대 경로 해석
- `print()` 금지, `logging` 모듈 사용
- **CLI와 Python 모듈 양쪽 호출 지원**:
  - 핵심 로직: `def compress_glb(input_path, vehicle_id, zone, ...) -> dict`
  - CLI는 argparse로 함수를 호출하는 얇은 래퍼
- 파일 경로 접근은 반드시 `StorageBackend` 인터페이스 사용

**모든 저장 파일명 소문자 강제:**
```python
zone_lower = zone.lower()
output_filename = f"{zone_lower}.glb"
```

**KTX2 slot 분리 압축 (필수):**
| 텍스처 slot | 압축 모드 |
|---|---|
| baseColorTexture, emissiveTexture | ETC1S |
| normalTexture | UASTC |
| metallicRoughnessTexture, occlusionTexture | UASTC |

실행 순서:
```bash
# 1단계: Meshopt 기하학 압축
gltf-transform meshopt input.glb temp1.glb --level medium

# 2단계: UASTC (normal, metallicRoughness, occlusion)
gltf-transform uastc temp1.glb temp2.glb \
  --slots "normalTexture,metallicRoughnessTexture,occlusionTexture"

# 3단계: ETC1S (baseColor, emissive)
gltf-transform etc1s temp2.glb output.glb \
  --slots "baseColorTexture,emissiveTexture"
```

모든 subprocess 호출 예시:
```python
import subprocess
result = subprocess.run(
    [gltf_transform_path, "meshopt", str(input_path), str(output_path), "--level", "medium"],
    capture_output=True,
    text=True,
    encoding='utf-8',  # 한글 경로 호환 필수
    check=True,
)
```

**simplify 옵션:**
- `--simplify` 플래그 (기본값 비활성화)
- 활성화 시 경고 로그 출력: "simplify는 메시 형상 손상 가능, Phase 2 뷰어로 결과 검증 필수"
- 값 범위 0.0~1.0 (남길 비율)

**입력/출력 경로:**
- 입력: UE5에서 export된 원본 GLB 경로 (CLI 인자)
- 출력 임시: `{MODELS_DIR}/{vehicle_id}/.tmp/{zone}.glb`
- 출력 최종: `{MODELS_DIR}/{vehicle_id}/{zone}.glb`
- 모든 경로는 `StorageBackend`를 통해 접근

**입력 GLB 검증 (필수):**
- 파일 크기 0바이트 → 에러 로그 후 종료
- GLB magic number 검증: 첫 4바이트가 `0x46546C67` (`glTF` little-endian)
- 검증 실패 시 압축 시작 없이 종료

**락 파일 기반 중복 실행 방지 (필수):**
watchdog 디바운스만으로는 불충분. 여러 watch.py 인스턴스, 수동 CLI 실행, 이전 프로세스 잔존 등 대비.

```python
# 락 파일 경로: {MODELS_DIR}/{vehicle_id}/.{zone}.lock
# 락 파일 내용: "{pid},{iso_timestamp}"
```

로직:
1. compress.py 시작 시 해당 `(vehicle_id, zone)` 락 파일 존재 확인
2. 락 파일이 있으면:
   - PID가 살아있는지 확인 (`psutil.pid_exists()` 등)
   - 생성 시각이 10분 이상 경과했는지 확인
   - 둘 중 하나라도 stale하면 락 무시하고 진행
   - 아니면 에러 로그 후 종료 ("이미 압축 중")
3. 락 파일 생성 (현재 PID + ISO timestamp 기록)
4. 작업 완료 또는 실패 시 finally 블록에서 락 파일 삭제

**원자적 이동 (필수, 롤백 처리):**
1. `.tmp/` 폴더에 먼저 압축 결과 저장
2. 모든 단계 성공 시에만 `Path.replace()`로 최종 위치로 이동
3. 어느 단계든 실패 시 `.tmp/` 내 파일 전부 삭제, 기존 `{zone}.glb`는 그대로 유지

**압축 효율 역전 처리 (필수):**
- 압축 완료 후 최종 파일 크기가 원본보다 크면 원본 GLB를 그대로 `{zone}.glb`로 복사
- 로그: `"compression increased size ({original} → {compressed}), keeping original"`
- metadata.json에는 원본 기준 값 기록

**metadata.json 측정 (필수):**
`gltf-transform inspect --format json` subprocess 호출로 GLB 정보 추출 (pygltflib 대신 사용하여 메모리 효율 개선).

```python
result = subprocess.run(
    [gltf_transform_path, "inspect", str(glb_path), "--format", "json"],
    capture_output=True, text=True, encoding='utf-8', check=True,
)
info = json.loads(result.stdout)
# info에서 primitives 수, materials 수, vertex 수, textures 크기 추출
```

다음 값 계산하여 metadata.json에 기록:
- `file_size_bytes`: 최종 파일 크기
- `file_hash`: SHA-256 해시 (캐시 무효화 키)
- `draw_calls`: primitives 총 개수
- `material_count`: 유니크 머티리얼 수
- `vertex_count`: 전체 vertex 수
- `texture_memory_bytes`: 모든 텍스처를 RGBA8로 디코딩 시 예상 메모리 (`width * height * 4 * mipmap_factor`, 텍스처 메모리 예산 감시용)

**metadata.json 동시 쓰기 방지:**
- `{MODELS_DIR}/{vehicle_id}/.metadata.lock` 파일로 직렬화
- 읽기 → 업데이트 → 쓰기 사이클 atomic 처리
- 같은 vehicle_id 내 여러 zone 동시 압축 시 race condition 방지

**metadata.json 부분 업데이트:**
- 같은 vehicle_id + zone 재압축 시 해당 zone만 덮어쓰기
- 다른 zone 데이터는 보존
- `created_at`은 최초 생성 시에만, `updated_at`은 매번 갱신

**실행 방법:**
```bash
# 기본 압축
python pipeline/compress.py \
  --input "C:/UE5_Export/vehicle_a/exterior.glb" \
  --vehicle_id "vehicle_a" \
  --vehicle_name "Vehicle A" \
  --zone "exterior" \
  --ue_version "5.5.2"

# simplify 옵션 포함 (경고 출력됨)
python pipeline/compress.py \
  --input "C:/UE5_Export/vehicle_a/exterior.glb" \
  --vehicle_id "vehicle_a" \
  --vehicle_name "Vehicle A" \
  --zone "exterior" \
  --ue_version "5.5.2" \
  --simplify 0.8
```

**metadata.json 스키마 (CLAUDE.md 기준, 변경 금지):**
```json
{
  "vehicle_id": "vehicle_a",
  "vehicle_name": "Vehicle A",
  "created_at": "2025-04-09T10:00:00",
  "updated_at": "2025-04-09T10:30:00",
  "ue_version": "5.5.2",
  "zones": {
    "exterior": {
      "file": "exterior.glb",
      "file_size_bytes": 0,
      "file_hash": "sha256-hex-string",
      "draw_calls": 0,
      "material_count": 0,
      "vertex_count": 0,
      "texture_memory_bytes": 0
    }
  }
}
```

---

### 4. pipeline/watch.py

UE5 export 폴더를 감시하다가 GLB 파일이 추가/변경되면 `compress.compress_glb()` 함수 호출.

**핵심 규칙:**
- `watchdog` 라이브러리 사용
- config.json에서 경로 읽기 (하드코딩 금지)
- 모든 경로는 `pathlib.Path` 사용
- Windows 환경 기준
- GLB 파일만 감지 (확장자 `.glb` 체크, 대소문자 무관)
- `print()` 금지, `logging` 사용
- **관리자 권한 기본 실행 금지** — 네트워크 드라이브 필요 시 config.json에 UNC 경로(`\\server\share`) 직접 지정

**파일 안정화 판정 규칙 (CLAUDE.md 기준, 필수):**
다음 **모두 충족**해야 compress_glb 호출:

1. 파일 크기가 **5초 이상** 변화 없음
2. mtime이 **5초 이상** 변화 없음
3. Windows 파일 락 해제 확인 (`rb+` 모드, `rb` 금지)

**Windows 파일 락 체크 구현:**
```python
def is_file_unlocked(filepath: Path) -> bool:
    """Windows에서 파일이 다른 프로세스에 의해 락 걸려있는지 확인.
    
    반드시 쓰기 모드('rb+')로 열어야 정확한 체크 가능.
    읽기 모드('rb')는 UE5가 쓰는 중에도 성공할 수 있음.
    """
    try:
        with open(filepath, 'rb+') as f:
            pass
        return True
    except (PermissionError, OSError):
        return False
```

**watchdog 이벤트 디바운싱 (Windows 필수):**
- Windows에서 watchdog은 한 번의 파일 쓰기에 여러 `modified` 이벤트 발생
- 동일 파일 경로에 대한 이벤트는 **2초 디바운스**
- 디바운스 윈도우 내에서는 마지막 이벤트만 유효
- 디바운스 만료 후에 안정화 판정(5초) 시작
- (주의: 디바운스는 같은 이벤트 스트림 내에서만 동작. 중복 압축 차단의 최종 방어선은 compress.py의 락 파일)

**config.json 형식:**
```json
{
  "watch_folder": "C:/UE5_Export",
  "vehicle_id": "vehicle_a",
  "vehicle_name": "Vehicle A",
  "ue_version": "5.5.2"
}
```

네트워크 드라이브 사용 시 예시:
```json
{
  "watch_folder": "\\\\nas01\\design\\UE5_Export",
  ...
}
```

**zone 자동 감지:**
- 감지된 GLB 파일명이 `exterior.glb` / `interior.glb` / `chassis.glb` / `powertrain.glb` 중 하나인지 확인 (소문자 비교)
- 매치되지 않으면 경고 로그 후 스킵

---

### 5. backend/main.py + routers/vehicles.py

FastAPI 파일 서버 구축.

**API 엔드포인트:**
| Method | Path | 설명 | Cache-Control |
|--------|------|------|---|
| GET | `/vehicles` | 전체 차량 목록 | no-cache |
| GET | `/vehicles/{vehicle_id}` | 특정 차량 메타데이터 | no-cache |
| GET | `/vehicles/{vehicle_id}/{zone}` | 구역별 GLB 파일 서빙 | public, max-age=3600 |

**핵심 규칙:**

**GLB 서빙 방식 (CLAUDE.md 기준, 필수):**
- **`FileResponse` 사용 금지**, `StaticFiles` 마운트로 서빙
- 구현: `app.mount("/static", StaticFiles(directory=models_dir), name="models")`
- `/vehicles/{id}/{zone}` 라우터는 StaticFiles 경로로 리다이렉트 또는 재작성
- `StorageBackend.get_local_path()`로 실제 경로 해석
- Content-Type: `model/gltf-binary` (StaticFiles가 자동 처리 못 하면 미들웨어로 추가)

**Cache-Control 구분 서빙:**
- GLB (`/vehicles/{id}/{zone}`): `public, max-age=3600` (해시 기반 캐시 버스팅과 병행)
- metadata (`/vehicles`, `/vehicles/{id}`): `no-cache` (항상 최신)

**CORS 규칙 (CLAUDE.md 기준, 필수):**
- **CORS 전체 허용 금지** (`allow_origins=["*"]` 금지)
- 사내 도메인 화이트리스트만 허용
- `.env`에서 `ALLOWED_ORIGINS` 환경변수로 읽기 (쉼표 구분)
```python
allowed_origins = [o.strip() for o in os.getenv("ALLOWED_ORIGINS", "").split(",") if o.strip()]
app.add_middleware(
    CORSMiddleware,
    allow_origins=allowed_origins,
    allow_credentials=False,
    allow_methods=["GET"],
    allow_headers=["*"],
)
```

**인증 미들웨어 skeleton (Phase 6 대비):**
`backend/middleware/auth.py`:
```python
from fastapi import Request

async def auth_middleware(request: Request, call_next):
    """인증 미들웨어. Phase 1~5: 통과. Phase 6: JWT 검증 추가."""
    # Phase 6에서 Authorization 헤더 검증 로직 추가
    response = await call_next(request)
    return response
```
`main.py`에서 미들웨어 등록. Phase 1에서는 no-op이지만 등록 구조는 갖춰두기.

**경로 관리 규칙:**
- 파일 경로는 환경변수 `MODELS_DIR`로 관리 (하드코딩 금지)
- `MODELS_DIR` 해석 기준: `Path(__file__).parent`를 기준으로 상대 경로 해석, 또는 절대 경로 직접 지정
- `os.getcwd()` 기반 해석 금지
- `os.path` 사용 금지 (`pathlib.Path`만)

**에러 처리 규칙:**
- `models_dir`에 차량 폴더가 없을 때 `/vehicles` → `[]` 반환 (500 금지)
- `/vehicles/{vehicle_id}`에 없는 차량 요청 → 404 + `{"detail": "Vehicle not found", "available_vehicles": [...]}`
- `/vehicles/{vehicle_id}/{zone}`에 없는 zone 요청 → 404 + `{"detail": "Zone not found", "available_zones": [...]}`
- `metadata.json` 파싱 실패 → 500 + 명확한 에러 메시지

**로깅:**
- `print()` 금지
- `logging.getLogger("vehicle_viewer")` 기반
- 콘솔 + 파일 로그 둘 다 (파일 경로는 환경변수)

**실행 방법:**
```bash
cd backend
uvicorn main:app --host 0.0.0.0 --port 8000 --reload
```

---

### 6. 의존성 파일

`backend/requirements.txt`:
```
fastapi
uvicorn[standard]
python-dotenv
watchdog
psutil
```

(주의: `pygltflib`는 사용하지 않음. `gltf-transform inspect --format json` 호출로 대체)

`backend/.env.example`:
```
MODELS_DIR=./models_dir
ALLOWED_ORIGINS=http://localhost:5173,http://localhost:3000
LOG_FILE=./logs/vehicle_viewer.log
```

**Node.js 의존성:**
```bash
npm install -g @gltf-transform/cli
```

**KTX-Software 사전 설치 (필수, Windows):**
`gltf-transform uastc` / `etc1s` 커맨드는 내부적으로 **KTX-Software의 `toktx` 바이너리**를 호출함. `npm install`만으로는 동작하지 않음.

- GitHub Releases에서 Windows 설치 파일 다운로드: https://github.com/KhronosGroup/KTX-Software/releases
- 설치 후 `toktx.exe`가 있는 경로를 시스템 PATH에 추가
- 확인: `toktx --version` 정상 출력
- 미설치 시 compress.py가 KTX2 단계에서 "toktx not found" 에러로 종료됨

---

### 7. README.md

프로젝트 루트에 README.md 작성 (한국어).

**필수 섹션:**
- 전체 구조 설명
- 사전 설치 항목:
  - Python 3.10+
  - Node.js 18+
  - `npm install -g @gltf-transform/cli`
  - **KTX-Software (toktx) Windows 설치 및 PATH 등록** (필수)
  - `pip install -r backend/requirements.txt`
- **프로젝트 경로 깊이 주의사항** (Windows MAX_PATH 260자 제한, 루트 경로 깊이 80자 권장)
- compress.py 실행 방법
- watch.py 실행 방법 + UNC 경로 예시
- FastAPI 서버 실행 방법
- `.env` 파일 설정 방법
- API 사용 예시 (해시 기반 캐시 버스팅 포함)
- Windows 운영 가이드:
  - NSSM 서비스 등록 방법
  - Windows 방화벽 인바운드 규칙 (포트 8000)
  - 전원 설정 (절전 모드 해제)
- 문제 해결:
  - `toktx not found` 에러 대처
  - 긴 경로 에러 대처 (`LongPathsEnabled` 레지스트리)
  - 한글 경로 인코딩 에러

---

## 성공 기준 (전부 충족해야 Phase 2 진행 가능)

### 기본 동작 검증
- [ ] `python pipeline/watch.py` 실행 시 폴더 감시 시작됨
- [ ] GLB 파일 추가 시 파일 크기 안정화 후 자동 압축 시작됨
- [ ] Meshopt + KTX2 압축 정상 동작 확인됨
- [ ] `uvicorn main:app` 실행 후 오류 없이 서버 시작됨
- [ ] `GET http://localhost:8000/vehicles` 차량 목록 JSON 반환됨
- [ ] `GET http://localhost:8000/vehicles/sample_vehicle/exterior` GLB 파일 다운로드 됨
- [ ] GLB 응답 헤더에 `Cache-Control: public, max-age=3600` 포함
- [ ] `/vehicles`, `/vehicles/{id}` 응답 헤더에 `Cache-Control: no-cache` 포함
- [ ] metadata.json 자동 생성됨

### CLAUDE.md 규칙 준수 검증
- [ ] compress.py가 normal/metallicRoughness/occlusion을 **UASTC**로, baseColor/emissive를 **ETC1S**로 구분 압축
- [ ] metadata.json이 CLAUDE.md 스키마(`file_hash`, `texture_memory_bytes`, `ue_version`, `draw_calls`, `material_count`, `vertex_count`) 대로 생성
- [ ] CORS가 사내 도메인 화이트리스트로 설정 (전체 허용 아님)
- [ ] GLB 서빙이 **StaticFiles 마운트**로 구현 (FileResponse 아님)
- [ ] watch.py 안정화 판정이 **5초 크기 + 5초 mtime + 파일 락(rb+)** 셋 다 적용
- [ ] 스토리지 추상화 레이어 (`backend/storage/base.py`, `local.py`, `s3.py skeleton`) 배치
- [ ] `compress.compress_glb()` 함수로 호출 가능, CLI는 래퍼
- [ ] 모든 코드에서 `print()` 대신 `logging` 사용
- [ ] 모든 경로가 `pathlib.Path` (`os.path` 없음)
- [ ] 모든 `subprocess.run()`에 `encoding='utf-8'` 명시
- [ ] 인증 미들웨어 skeleton 등록 (Phase 1은 no-op)

### 엣지 케이스 검증
- [ ] 압축 실패 시 `.tmp/` 임시 파일 삭제, 기존 최종 파일 보존
- [ ] GLB magic number 검증 동작 (0바이트, 잘못된 바이너리 거부)
- [ ] **락 파일 기반 중복 실행 방지 동작** (같은 vehicle_id/zone 동시 요청 시 하나만 실행)
- [ ] **stale 락 감지 동작** (PID 없거나 10분 경과 시 무시)
- [ ] watchdog 중복 이벤트 **2초 디바운스** 동작
- [ ] 빈 `models_dir`에서 `/vehicles` → `[]` 반환
- [ ] 존재하지 않는 vehicle_id/zone 요청 시 404 + 사용 가능 목록 반환
- [ ] 같은 zone 재압축 시 해당 zone만 덮어쓰기, 다른 zone 데이터 보존
- [ ] `created_at`은 최초 생성 시에만, `updated_at`은 매번 갱신
- [ ] **압축 결과가 원본보다 클 때 원본 유지 fallback 동작** (로그 확인)
- [ ] **파일 해시 기반 캐시 무효화 동작** (metadata 업데이트 시 hash 변경 확인)

### Windows / 유니코드 특이사항 검증
- [ ] 모든 경로 처리가 `pathlib.Path` 기반
- [ ] `gltf-transform` 호출이 `shutil.which()` 기반 절대 경로 해석
- [ ] 파일 락 체크가 `rb+` 모드 사용
- [ ] `MODELS_DIR` 해석이 `Path(__file__).parent` 기준 (cwd 의존 아님)
- [ ] **모든 저장 파일명 소문자 통일** (`Exterior.glb` → `exterior.glb`)
- [ ] **한글 폴더/파일명 포함 경로 압축 테스트 통과** (subprocess 인코딩 에러 없음)
- [ ] UNC 경로(`\\server\share`)를 config.json에 지정해도 정상 동작
- [ ] **200MB 원본 GLB 압축 시 서버 메모리 임계치 이내 유지** (gltf-transform inspect 사용으로 pygltflib 대비 개선)

---

## 주의사항 (CLAUDE.md 기준, 변경 금지)
- Blender 사용 금지
- Draco 사용 금지
- Three.js 사용 금지
- `gltf-transform instance` 사용 금지 (Phase 4 이후 검토)
- 파일 경로 하드코딩 금지 (환경변수 사용)
- `os.path` 사용 금지 (`pathlib.Path` 사용)
- 파일명 대문자 금지 (소문자 강제)
- 관리자 권한 기본 실행 금지 (UNC 경로 사용)
- CORS 전체 허용 금지 (화이트리스트만)
- `FileResponse` 사용 금지 (`StaticFiles` 마운트 사용)
- `print()` 금지 (`logging` 사용)
- `simplify` 옵션 기본 활성화 금지 (수동 플래그만)
- AI 관련 주석 금지 ("Generated by Claude" 등)
- 모든 주석 한국어 작성
- 저작권 표시: `# Copyright (c) 2025 GM Technical Center Korea — PQDQ Team`
