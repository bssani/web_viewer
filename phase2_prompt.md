# Phase 2 프롬프트 — 기본 뷰어 (React + Babylon.js) [v2 — Gemini 리뷰 반영]

## 목표
FastAPI 서버의 GLB 파일을 브라우저에서 Babylon.js로 로딩하여 차량 3D 모델을 표시한다.
Phase 4(v1.0)까지의 확장을 고려한 프론트엔드 골격을 구축한다.

> **중요**: 이 프롬프트는 CLAUDE.md의 규칙을 전제로 한다. 충돌 시 **CLAUDE.md가 우선**.

---

## 프로젝트 현황

- Phase 1 완료, FastAPI 서버 동작 중 (port 8000)
- 테스트 차량: `porsche_911` (exterior.glb)
- 프로젝트 경로: `C:\Git\Web_Viewer`
- API: `GET /vehicles`, `/vehicles/{id}`, `/vehicles/{id}/{zone}` (307 → /static/)
- ⚠️ Phase 1 후속 수정 중: `compress.py`의 메트릭 추출 (`gltf-transform inspect --format json` 미지원). metadata `draw_calls` 등이 0일 수 있음 → 뷰어는 0이어도 정상 동작 필수.

---

## 확정 기술 스택 (변경 금지)

| 항목 | 기술 |
|---|---|
| 빌드 도구 | Vite |
| 언어 | TypeScript (strict) |
| UI | React + Tailwind CSS |
| 3D | Babylon.js (순수, react-babylonjs 금지) |
| 렌더러 | WebGPU 우선, WebGL 2.0 fallback |
| 카메라 | ArcRotateCamera |
| 상태 | useState / useContext |

---

## 작업 내용

### 1. 프로젝트 초기화

```bash
cd C:\Git\Web_Viewer
npm create vite@latest frontend -- --template react-ts
cd frontend
npm install
npm install @babylonjs/core @babylonjs/loaders
npm install -D tailwindcss postcss autoprefixer
npx tailwindcss init -p
```

**`vite.config.ts` (Gemini 리뷰 반영 — 307 리다이렉트 + Windows MAX_PATH 회피):**
```typescript
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  server: {
    proxy: {
      '/vehicles': {
        target: 'http://localhost:8000',
        changeOrigin: true,
        followRedirects: true,  // Phase 1 307 리다이렉트 대응
      },
      '/static': {
        target: 'http://localhost:8000',
        followRedirects: true,
      },
    }
  },
  build: {
    // Windows MAX_PATH 260자 회피 — 빌드 결과 폴더/파일명 평탄화
    assetsDir: 'a',
    rollupOptions: {
      output: {
        entryFileNames: 'a/[hash:8].js',
        chunkFileNames: 'a/[hash:8].js',
        assetFileNames: 'a/[hash:8][extname]',
      }
    }
  }
});
```

### 2. 타입 정의 (`src/types/vehicle.ts`)

`VehicleMetadata`, `ZoneInfo`, `VehicleListItem`, `RendererType` 정의. metadata.json 스키마와 일치.

### 3. API 서비스 (`src/services/api.ts`) — 지수 백오프 포함

**핵심 규칙:**
- `fetchVehicles()`, `fetchVehicleMetadata(id)`: **메타데이터 API에만 지수 백오프 재시도** (1s, 2s, 4s, 최대 3회)
- `getGlbUrl(id, zone, fileHash)`: 해시 기반 캐시 버스팅 URL (`?v={hash[0:8]}`)
- GLB 다운로드는 큰 파일이라 자동 재시도 안 함 → 사용자 재시도 버튼만
- 4xx는 재시도 안 함, 5xx와 네트워크 에러만 재시도
- AbortController signal 인자 지원

### 4. Babylon.js 엔진 — 모듈 싱글톤 + Strict Mode 가드 (`src/hooks/useEngine.ts`)

**Gemini 리뷰 반영 — React Strict Mode 중복 초기화 방지:**
```typescript
// 모듈 레벨 싱글톤
let _engineInstance: BABYLON.Engine | BABYLON.WebGPUEngine | null = null;
let _initPromise: Promise<EngineState> | null = null;
let _rendererType: RendererType | null = null;

async function initializeEngine(canvas: HTMLCanvasElement): Promise<EngineState> {
  if (_engineInstance) return { engine: _engineInstance, rendererType: _rendererType! };
  if (_initPromise) return _initPromise;

  _initPromise = (async () => {
    // 단계별 try-catch (Gemini 리뷰)
    try {
      const supported = await BABYLON.WebGPUEngine.IsSupportedAsync;
      if (supported) {
        try {
          const engine = new BABYLON.WebGPUEngine(canvas);
          await engine.initAsync();  // initAsync 완료 검증
          _engineInstance = engine;
          _rendererType = 'webgpu';
          return { engine, rendererType: 'webgpu' as const };
        } catch (gpuErr) {
          logger.warn('WebGPU 초기화 실패, WebGL fallback', gpuErr);
        }
      }
      // WebGL fallback
      const engine = new BABYLON.Engine(canvas, true);
      _engineInstance = engine;
      _rendererType = 'webgl2';
      return { engine, rendererType: 'webgl2' as const };
    } catch (err) {
      _initPromise = null;  // 재시도 가능하게
      throw err;
    }
  })();
  return _initPromise;
}
```

훅 내부:
- `useRef`로 isMounted 플래그 관리 → cleanup 후 setState 차단
- `engine.dispose()`는 `beforeunload`에서만, 컴포넌트 unmount 시 호출 금지
- 차량 전환 시에도 절대 dispose 금지

### 5. Meshopt / KTX2 디코더 등록

`frontend/public/libs/`에 디코더 정적 파일 배치. 엔진 초기화 직후 등록. Babylon.js 7.x API 기준 (실제 import 경로는 공식 문서 확인).

**🚨 절대 경로 필수 (Gemini 2차 리뷰):**
- `BABYLON.KhronosTextureContainer2.URLConfig` 경로는 **반드시 절대 경로** 사용 (`/libs/babylon.ktx2Decoder.js`)
- 상대 경로(`./libs/...`) 사용 금지 — Vite base path, React Router 구조에 따라 404 발생
- Vite 빌드 시 `public/` 폴더는 해시 처리 없이 그대로 복사되므로 절대 경로가 안전

### 6. 씬 관리 (`src/hooks/useScene.ts`) — initAsync 완료 후만 동작

- `engine && isReady` 조건일 때만 씬 생성 가능
- 차량 전환 시 dispose 검증:
  ```typescript
  const before = { 
    meshes: scene.meshes.length, 
    materials: scene.materials.length,
    textures: scene.textures.length 
  };
  scene.dispose();
  logger.info('[dispose 검증]', before, '→', { 
    cachedTextures: engine.getLoadedTexturesCache().length 
  });
  ```
- 새 씬 생성 전 기존 씬 dispose 완료 보장

### 7. 차량 로더 (`src/hooks/useVehicleLoader.ts`) — AbortController 레이스 방지

**Gemini 리뷰 핵심 — 차량 빠른 전환 시 레이스 컨디션 차단:**
```typescript
const abortRef = useRef<AbortController | null>(null);
const loadGenerationRef = useRef(0);

const loadVehicle = async (vehicleId: string, zone: string) => {
  // 이전 로딩 취소
  abortRef.current?.abort();
  abortRef.current = new AbortController();
  const signal = abortRef.current.signal;
  const generation = ++loadGenerationRef.current;

  try {
    const metadata = await fetchVehicleMetadata(vehicleId, { signal });
    if (signal.aborted || generation !== loadGenerationRef.current) return;

    const glbUrl = getGlbUrl(vehicleId, zone, metadata.zones[zone].file_hash);
    
    // 🚨 씬 생명주기 (Gemini 2차 리뷰 - Critical):
    // scene.dispose() 후 같은 변수로 ImportMeshAsync 호출하면 100% 크래시.
    // 반드시 dispose 직후 새 Scene 인스턴스를 생성하고, 그 새 씬에 GLB를 로드해야 함.
    if (sceneRef.current) {
      const before = {
        meshes: sceneRef.current.meshes.length,
        materials: sceneRef.current.materials.length,
        textures: sceneRef.current.textures.length,
      };
      sceneRef.current.dispose();
      sceneRef.current = null;
      logger.info('[dispose 검증]', before);
    }
    
    // 즉시 새 씬 인스턴스 생성
    const newScene = new BABYLON.Scene(engine);
    sceneRef.current = newScene;
    
    // 카메라/조명 설정 (새 씬 대상)
    setupCamera(newScene);
    setupLighting(newScene);
    
    // SceneLoader 진행률 콜백 (새 씬에 로드)
    await BABYLON.SceneLoader.ImportMeshAsync('', '', glbUrl, newScene, (event) => {
      if (signal.aborted) return;
      setProgress((event.loaded / event.total) * 100);
    });
    
    if (signal.aborted || generation !== loadGenerationRef.current) {
      // 늦게 도착한 결과는 dispose
      newScene.dispose();
      if (sceneRef.current === newScene) sceneRef.current = null;
      return;
    }
    
    // 카메라 자동 fit (바운딩 박스 기준)
    fitCameraToScene(newScene, camera);
  } catch (err) {
    if (err.name === 'AbortError') return;  // 정상 취소
    setError(err);
  }
};
```

### 8. 카메라 (ArcRotateCamera)
- alpha: π/2, beta: π/2.5
- radius: 바운딩 박스 대각선 × 1.5 자동 계산
- target: 모델 중심 자동
- lowerRadiusLimit / upperRadiusLimit / wheelDeltaPercentage 적절히 설정
- attachControl로 마우스 자동 연결

### 9. UI 레이아웃 (`src/App.tsx`)
사이드바 280px 좌측 고정 + 뷰어 flex-1. 로딩/에러는 뷰어 중앙 오버레이. DevPanel은 우하단 (?dev=1).

### 10. 사이드바 (`src/components/Sidebar.tsx`)
- 차량 목록 fetch + 표시 + 선택 강조
- 빈 목록 안내 / fetch 실패 시 인라인 에러 + 재시도
- Phase 4 zone 토글, 인터랙션 패널 확장 공간 확보

### 11. 뷰어 (`src/components/Viewer.tsx`) — ResizeObserver + rAF 디바운싱

**Gemini 리뷰 반영 — window resize 대신 ResizeObserver:**
**🚨 Gemini 2차 리뷰 — requestAnimationFrame 디바운싱 필수:**
사이드바 토글 애니메이션 등으로 ResizeObserver가 1초에 수십~수백 번 콜백 발생 → `engine.resize()` 폭주 → 렌더링 stuttering. rAF로 호출 빈도 제한.

```typescript
useEffect(() => {
  if (!canvasRef.current?.parentElement || !engine) return;
  
  let rafId: number | null = null;
  const observer = new ResizeObserver(() => {
    if (rafId !== null) return;  // 이미 예약됨
    rafId = requestAnimationFrame(() => {
      engine.resize();
      rafId = null;
    });
  });
  
  observer.observe(canvasRef.current.parentElement);
  return () => {
    observer.disconnect();
    if (rafId !== null) cancelAnimationFrame(rafId);
  };
}, [engine]);
```
사이드바 토글, Phase 4 패널 추가 등 레이아웃 변화 자동 감지 + 부드러운 리사이즈 보장.

### 12. 로딩 진행률 (`src/components/LoadingBar.tsx`) — 빈 화면 차단 필수

중앙 오버레이, 0~100%, "차량 로딩 중... 42%" 텍스트.

**🚨 Gemini 2차 리뷰 — 빈 화면(Black Screen) 노출 방지:**
새 차량 클릭 즉시 기존 씬이 dispose되고 30MB 다운로드(5~8초)가 시작됨. 그 동안 사용자가 검은 캔버스만 보면 "깨졌나?" 오해.

**해결책 — 로딩 오버레이가 캔버스를 100% 완전히 차단:**
- 로딩 시작 시 캔버스 영역 전체를 **불투명 배경**으로 덮음 (Tailwind: `absolute inset-0 bg-slate-900 z-10`)
- 중앙에 진행률 바 + "차량 로딩 중... XX%" 텍스트
- 로딩 완료 후 오버레이 제거
- 이전 차량 유지 방식(메모리 2배)은 **사용 금지** — 텍스처 메모리 1GB 예산 초과 위험

```typescript
{isLoading && (
  <div className="absolute inset-0 bg-slate-900 z-10 flex items-center justify-center">
    <div className="text-white">
      <div className="mb-2">차량 로딩 중... {Math.round(progress)}%</div>
      <div className="w-64 h-2 bg-slate-700 rounded">
        <div className="h-full bg-blue-500 rounded transition-all" 
             style={{width: `${progress}%`}} />
      </div>
    </div>
  </div>
)}
```

### 13. 에러 메시지 (`src/components/ErrorMessage.tsx`)
에러 종류별 구분 메시지 + 재시도 버튼. 네트워크/404/GLB 파싱/엔진 초기화 실패 구분.

### 14. 개발자 모드 패널 (`src/components/DevPanel.tsx`) — 메모리 추적 강화

**?dev=1일 때만 표시. Gemini 리뷰 반영 — 메시/머티리얼/텍스처 모두 추적:**

표시 항목 (실시간):
- 렌더러 종류, FPS
- **`scene.meshes.length`** (메모리 누수 핵심 지표)
- **`scene.materials.length`**
- **`scene.textures.length`**
- `engine.getLoadedTexturesCache().length`
- `scene.getTotalVertices()`
- JS Heap (Chrome `performance.memory`)
- 현재 차량/zone, metadata draw_calls (런타임 비교용)
- **차량 전환 직전 값 저장 → 누수 시 빨간색 경고**
- "Copy to Clipboard" 버튼 (벤치마크 기록용)

### 15. 로깅 유틸 (`src/utils/logger.ts`)
isDev 조건부 출력. 에러는 항상 출력.

### 16. FastAPI 정적 호스팅 (빌드 후)
`backend/main.py`에 `frontend/dist` 마운트 추가. 다른 라우터 아래에 배치.

---

## 성공 기준 (Phase 3 진행 전 모두 충족)

### 빌드/설정
- [ ] `npm run dev` 정상 시작, 프록시로 `/vehicles` 호출 성공
- [ ] `npm run build` TypeScript strict 통과
- [ ] 빌드 결과물 경로 평탄화 (`a/` 폴더, 8자 해시)
- [ ] 307 리다이렉트가 dev/prod 모두 정상 처리

### 엔진 (Gemini 리뷰)
- [ ] **React Strict Mode에서 엔진 한 번만 생성** (싱글톤 동작)
- [ ] WebGPU/WebGL fallback 자동 동작
- [ ] WebGPU 초기화 실패 시 WebGL로 자연스럽게 전환
- [ ] `initAsync` 완료 전 씬 생성 시도 차단
- [ ] 단계별 try-catch로 부분 실패 복구
- [ ] DevPanel에 현재 렌더러 표시

### GLB 로딩
- [ ] Meshopt + KTX2 디코더 등록 확인 (압축 GLB 정상 표시)
- [ ] 해시 기반 캐시 버스팅 URL 동작
- [ ] 진행률 바 0→100%
- [ ] 메타데이터 API 5xx 에러 시 지수 백오프 재시도 (1s/2s/4s)
- [ ] GLB 자체는 자동 재시도 안 함, 사용자 재시도 버튼만

### 레이스 컨디션 (Gemini 리뷰)
- [ ] **차량 빠른 연속 클릭 시 마지막 선택만 반영**
- [ ] AbortController로 이전 fetch 취소
- [ ] generation 카운터로 늦게 도착한 결과 폐기
- [ ] 취소된 씬 자동 dispose

### 카메라/인터랙션
- [ ] 회전/줌/패닝 정상
- [ ] 카메라 자동 fit

### 메모리 (Gemini 리뷰)
- [ ] 차량 A→B→A 전환 시 메모리 증가 없음
- [ ] **`scene.meshes.length` 추적** (단순 textures 카운트만으로 부족)
- [ ] DevPanel에 누수 시각 경고
- [ ] dispose 검증 로그 (전후 비교)
- [ ] `engine.dispose()` 호출 안 됨 (`beforeunload`에서만)

### UI/UX
- [ ] **ResizeObserver로 캔버스 크기 자동 조절** (window resize 아님)
- [ ] 빈 차량 목록 안내
- [ ] 에러 종류별 메시지 + 재시도
- [ ] 사이드바 차량 강조 표시

### 성능
- [ ] 기준 기기 30fps 이상
- [ ] DevPanel "Copy to Clipboard"로 벤치마크 복사 가능
- [ ] **벤치마크 결과 CLAUDE.md에 append**

### 코드 품질
- [ ] TypeScript strict 통과
- [ ] 모든 주석 한국어, 저작권 문구
- [ ] AI 관련 주석 없음
- [ ] logger 유틸 사용 (console 직접 사용 금지, 에러 제외)

---

## 주의사항 요약

**절대 금지:**
- Three.js, react-babylonjs, Electron
- `navigator.gpu` 직접 체크 → `IsSupportedAsync`
- 차량 전환 시 `engine.dispose()` → `scene.dispose()`만
- window resize 이벤트 → ResizeObserver
- console.log 직접 사용 → logger 유틸

**Phase 4 확장 고려:**
- 사이드바: zone 토글, 인터랙션 패널 공간
- useScene: 파츠 클릭, 색상 변경 인터페이스
- useVehicleLoader: 다중 zone 동시 로드 가능 구조
- api.ts: 인증 헤더 추가 시 한 곳만 수정

---

## 변경 이력

### v2 — Gemini 2차 리뷰 반영 (Critical)
4개 항목 보완:

1. **Scene 생명주기 (7번 항목, Critical)**: `scene.dispose()` 후 같은 변수로 `ImportMeshAsync` 호출 시 100% 크래시. dispose 직후 새 `Scene` 인스턴스 생성하는 패턴 명시. `sceneRef` 관리 + 카메라/조명 새 씬 대상 설정 + 늦게 도착한 결과의 새 씬도 안전하게 dispose.

2. **ResizeObserver 디바운싱 (11번 항목)**: 사이드바 토글 애니메이션 중 `engine.resize()` 폭주 방지. `requestAnimationFrame` 기반 디바운싱 패턴 추가.

3. **빈 화면 차단 (12번 항목)**: dispose 후 다운로드 5~8초 동안 검은 캔버스 노출 방지. LoadingBar가 캔버스를 100% 완전히 덮는 불투명 오버레이로 구현. 이전 차량 유지 방식은 메모리 2배 위험으로 금지.

4. **디코더 절대 경로 (5번 항목)**: KTX2/Meshopt 디코더 경로는 `/libs/...` 절대 경로 강제. 상대 경로는 Vite base path / React Router 구조에 따라 404 발생 가능.

### v1 — Gemini 1차 리뷰 반영
- Vite `followRedirects`, 빌드 경로 평탄화
- 모듈 싱글톤 + Strict Mode 가드
- AbortController 레이스 방지
- ResizeObserver 도입 (디바운싱 없음 → v2에서 보완)
- 지수 백오프 재시도 (메타데이터만)
- DevPanel 메모리 추적 강화 (`scene.meshes/materials/textures`)
