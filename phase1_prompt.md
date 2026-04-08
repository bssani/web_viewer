# Phase 1 프롬프트 — FBX → glTF 변환 파이프라인 + FastAPI 파일 서버

---

## 목표
FBX 파일을 glTF(.glb) + Draco 압축으로 자동 변환하고,
FastAPI로 브라우저에서 접근 가능한 파일 서버를 구축한다.

---

## 작업 내용

### 1. 프로젝트 초기 세팅
아래 구조로 프로젝트 폴더를 생성해줘:

```
vehicle-web-viewer/
├── CLAUDE.md
├── backend/
│   ├── main.py
│   ├── routers/
│   │   └── vehicles.py
│   └── models_dir/         ← glTF 파일이 저장될 폴더 (샘플 구조 포함)
│       └── sample_vehicle/
│           └── metadata.json
├── frontend/               ← 지금은 빈 폴더만 (Phase 2에서 구현)
└── pipeline/
    ├── convert.py
    ├── watch.py
    └── config.json
```

---

### 2. pipeline/convert.py
FBX → glTF 변환 스크립트 작성.

**조건:**
- Blender Python API (bpy) 사용
- Draco 압축 적용
- 입력: FBX 파일 경로, 출력 폴더, 차량 이름
- 출력: `{차량이름}/exterior.glb`, `interior.glb` 등 구역별로 분리 저장
- 구역 분리 기준: FBX 내부 object 이름에 "exterior", "interior", "chassis", "powertrain" 키워드 포함 여부로 자동 분류
- 매칭 안 되는 오브젝트는 "misc.glb"로 저장
- 변환 완료 후 metadata.json 자동 생성

**metadata.json 형식:**
```json
{
  "vehicle_id": "vehicle_A",
  "vehicle_name": "Sample Vehicle A",
  "updated_at": "2025-01-01T00:00:00",
  "zones": ["exterior", "interior", "chassis", "powertrain"],
  "files": {
    "exterior": "exterior.glb",
    "interior": "interior.glb"
  }
}
```

**실행 방법:**
```bash
blender --background --python pipeline/convert.py -- \
  --input path/to/vehicle.fbx \
  --output backend/models_dir \
  --name vehicle_A
```

---

### 3. pipeline/watch.py
파일 변경 감지 후 자동 변환 스크립트.

**조건:**
- `watchdog` 라이브러리 사용
- 지정 폴더에 FBX 파일이 추가/변경되면 convert.py 자동 실행
- config.json에서 감시 폴더 경로 읽기
- Windows 환경 기준

**config.json 형식:**
```json
{
  "watch_folder": "C:/VehicleAssets/FBX",
  "output_folder": "backend/models_dir",
  "blender_path": "C:/Program Files/Blender Foundation/Blender 4.x/blender.exe"
}
```

---

### 4. backend/main.py + routers/vehicles.py
FastAPI 파일 서버 구축.

**API 엔드포인트:**

| Method | Path | 설명 |
|--------|------|------|
| GET | `/vehicles` | 전체 차량 목록 반환 |
| GET | `/vehicles/{vehicle_id}` | 특정 차량 메타데이터 반환 |
| GET | `/vehicles/{vehicle_id}/{zone}` | 특정 구역 glb 파일 다운로드 |

**조건:**
- 파일 경로는 환경변수 `MODELS_DIR`로 관리 (하드코딩 금지)
- CORS 전체 허용 (사내 인트라넷 환경)
- glb 파일 서빙 시 Content-Type: `model/gltf-binary`
- uvicorn으로 실행, 포트 8000

**실행 방법:**
```bash
cd backend
uvicorn main:app --host 0.0.0.0 --port 8000 --reload
```

---

### 5. 의존성 파일 생성
`backend/requirements.txt`:
```
fastapi
uvicorn
python-dotenv
watchdog
```

`backend/.env.example`:
```
MODELS_DIR=./models_dir
```

---

### 6. README.md
프로젝트 루트에 README.md 작성.
- 전체 구조 설명
- 설치 방법 (Windows 기준)
- convert.py 실행 방법
- watch.py 실행 방법
- FastAPI 서버 실행 방법
- API 사용 예시

---

## 성공 기준
- [ ] `python pipeline/watch.py` 실행 시 FBX 폴더 감시 시작
- [ ] FBX 파일 추가 시 자동으로 glb 변환 + metadata.json 생성
- [ ] `uvicorn main:app` 실행 후 `http://localhost:8000/vehicles` 접속 시 차량 목록 JSON 반환
- [ ] `http://localhost:8000/vehicles/sample_vehicle/exterior` 접속 시 glb 파일 다운로드 됨

---

## 주의사항
- 일반 노트북 기준: 외장 glb는 30MB 이하 목표
- LOD 없이 전체 고해상도 로딩 금지
- 파일 경로 하드코딩 금지 (환경변수 사용)
- Cloud 이전 고려: 로컬 파일 서빙 구조를 나중에 S3로 교체 가능하게 추상화
