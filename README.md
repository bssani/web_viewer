# Vehicle Web Viewer

UE5 없이 일반 노트북 브라우저에서 차량 3D 모델을 확인할 수 있는 웹 뷰어.

## 프로젝트 구조

```
vehicle-web-viewer/
├── CLAUDE.md
├── backend/
│   ├── main.py                  ← FastAPI 서버 진입점
│   ├── routers/
│   │   └── vehicles.py          ← 차량 API 라우터
│   ├── middleware/
│   │   └── auth.py              ← 인증 미들웨어 (Phase 1: no-op)
│   ├── storage/
│   │   ├── base.py              ← StorageBackend 추상 인터페이스
│   │   ├── local.py             ← 로컬 파일 시스템 구현
│   │   └── s3.py                ← S3 skeleton (Phase 6)
│   ├── config/
│   │   ├── base.py              ← 공통 설정 (로깅 등)
│   │   └── local.py             ← Windows 데스크탑 설정
│   ├── models_dir/              ← GLB 파일 저장소
│   │   └── sample_vehicle/
│   │       └── metadata.json
│   ├── requirements.txt
│   └── .env.example
├── frontend/                    ← React + Babylon.js (Phase 2)
└── pipeline/
    ├── compress.py              ← Meshopt + KTX2 압축 스크립트
    ├── watch.py                 ← UE5 export 폴더 감시
    └── config.json              ← 감시 설정
```

## 사전 설치 항목 (Windows)

### 필수 소프트웨어

1. **Python 3.10+**
2. **Node.js 18+**
3. **gltf-transform CLI**
   ```bash
   npm install -g @gltf-transform/cli
   ```
4. **KTX-Software (toktx)**
   - [KTX-Software Releases](https://github.com/KhronosGroup/KTX-Software/releases)에서 Windows 설치 파일 다운로드
   - 설치 후 `toktx.exe`가 있는 경로를 시스템 PATH에 추가
   - 확인: `toktx --version` 정상 출력
   - **미설치 시 compress.py가 KTX2 단계에서 실패합니다**

### 프로젝트 경로 주의사항

Windows MAX_PATH 260자 제한에 주의하세요.
- 프로젝트 루트 경로 깊이 **최대 80자 권장** (예: `C:\gmtck\vwv\`)
- 긴 경로 에러 발생 시: 레지스트리에서 `HKLM\SYSTEM\CurrentControlSet\Control\FileSystem\LongPathsEnabled` 값을 `1`로 설정

## 설치

```bash
# Python 의존성 설치
cd backend
pip install -r requirements.txt

# 환경변수 설정
copy .env.example .env
```

`.env` 파일을 환경에 맞게 수정:
```
MODELS_DIR=./models_dir
ALLOWED_ORIGINS=http://localhost:5173,http://192.168.1.100:5173
LOG_FILE=./logs/vehicle_viewer.log
```

## 실행 방법

### FastAPI 서버 실행

```bash
cd backend
uvicorn main:app --host 0.0.0.0 --port 8000 --reload
```

### GLB 수동 압축

```bash
python pipeline/compress.py \
  --input "C:/UE5_Export/vehicle_a/exterior.glb" \
  --vehicle_id "vehicle_a" \
  --vehicle_name "Vehicle A" \
  --zone "exterior" \
  --ue_version "5.5.2"
```

simplify 옵션 (형상 손상 주의):
```bash
python pipeline/compress.py \
  --input "C:/UE5_Export/vehicle_a/exterior.glb" \
  --vehicle_id "vehicle_a" \
  --vehicle_name "Vehicle A" \
  --zone "exterior" \
  --simplify 0.8
```

### UE5 export 폴더 자동 감시

`pipeline/config.json`을 환경에 맞게 수정:
```json
{
  "watch_folder": "C:/UE5_Export",
  "vehicle_id": "vehicle_a",
  "vehicle_name": "Vehicle A",
  "ue_version": "5.5.2"
}
```

네트워크 드라이브 사용 시 (UNC 경로):
```json
{
  "watch_folder": "\\\\nas01\\design\\UE5_Export",
  "vehicle_id": "vehicle_a",
  "vehicle_name": "Vehicle A",
  "ue_version": "5.5.2"
}
```

실행:
```bash
python pipeline/watch.py
```

## API 사용 예시

### 전체 차량 목록

```bash
curl http://localhost:8000/vehicles
```

### 특정 차량 메타데이터

```bash
curl http://localhost:8000/vehicles/sample_vehicle
```

### 구역별 GLB 파일 다운로드

```bash
# /vehicles/{id}/{zone} → /static/{id}/{zone}.glb 리다이렉트
curl -L -O http://localhost:8000/vehicles/sample_vehicle/exterior
```

해시 기반 캐시 버스팅 (프론트엔드 사용 패턴):
```javascript
const metadata = await fetch('/vehicles/vehicle_a').then(r => r.json());
const hash = metadata.zones.exterior.file_hash.slice(0, 8);
const glbUrl = `/vehicles/vehicle_a/exterior?v=${hash}`;
```

## 압축 파이프라인

gltf-transform CLI를 사용하여 3단계 압축:

1. **Meshopt** — 기하학 압축 (`EXT_meshopt_compression`)
2. **UASTC** — normal, metallicRoughness, occlusion 텍스처 (고품질)
3. **ETC1S** — baseColor, emissive 텍스처 (고압축)

### 텍스처 slot별 압축 모드

| 텍스처 slot | 압축 모드 | 이유 |
|---|---|---|
| baseColorTexture, emissiveTexture | ETC1S | 작고 빠름, 퀄리티 손실 허용 |
| normalTexture | UASTC | ETC1S는 노멀 왜곡 심함 |
| metallicRoughnessTexture, occlusionTexture | UASTC | PBR 품질 유지 필요 |

## Windows 운영 가이드

### NSSM 서비스 등록

[NSSM](https://nssm.cc/)을 사용하여 서버를 Windows 서비스로 등록:

```bash
# FastAPI 서버 등록
nssm install VehicleViewer "C:\Python312\python.exe" "-m uvicorn main:app --host 0.0.0.0 --port 8000"
nssm set VehicleViewer AppDirectory "C:\gmtck\vwv\backend"

# 파일 감시 등록
nssm install VehicleWatcher "C:\Python312\python.exe" "pipeline\watch.py"
nssm set VehicleWatcher AppDirectory "C:\gmtck\vwv"
```

### Windows 방화벽

```bash
netsh advfirewall firewall add rule name="VehicleViewer" dir=in action=allow protocol=TCP localport=8000
```

### 전원 설정

절전 모드 해제 (서버 중단 방지):
```bash
powercfg /setactive 8c5e7fda-e8bf-4a96-9a85-a6e23a8c635c
```

## 문제 해결

### `toktx not found` 에러

KTX-Software가 설치되지 않았거나 PATH에 등록되지 않았습니다.
1. [KTX-Software Releases](https://github.com/KhronosGroup/KTX-Software/releases)에서 Windows 버전 다운로드
2. 설치 후 `toktx.exe` 경로를 시스템 PATH에 추가
3. 터미널을 재시작하고 `toktx --version` 확인

### 긴 경로 에러

Windows MAX_PATH 260자 제한:
1. 레지스트리 편집기 → `HKLM\SYSTEM\CurrentControlSet\Control\FileSystem`
2. `LongPathsEnabled` 값을 `1`로 설정
3. 재부팅

### 한글 경로 인코딩 에러

모든 `subprocess.run()` 호출에 `encoding='utf-8'`이 명시되어 있습니다.
에러가 발생하면 Windows 시스템 로캘 설정에서 "베타: UTF-8을 사용..." 옵션을 활성화하세요.

## 라이선스

Copyright (c) 2025 GM Technical Center Korea — PQDQ Team
