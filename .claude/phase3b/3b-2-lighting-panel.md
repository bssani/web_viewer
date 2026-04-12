# Phase 3b-2: LightingPanel + 슬라이더 (순수 React) — v2

🟡 **Plan Mode 필수** | 위험도: 낮음~중간 | 수정/신규 파일: 5개 | 신규 의존성: 0

> **v2 변경점**: App.tsx resync useEffect deps 좁힘 (Gemini 검토 #4 반영). 나머지 Gemini 조언(throttling/sun.position 유동/blur 부하)은 비동의로 미반영.

## 목표
3b-1 DirectionalLight를 Azimuth/Elevation/Intensity 슬라이더로 실시간 제어. 순수 React + CSS module. LightingPanel은 Phase 3c Accordion 슬롯 형태.

## 핵심 설계 (UI ↔ 로직 분리)
```
LightingPanel.tsx          ← UI/스타일 (교체 가능)
  ↓ props
useLightingControl.ts      ← Babylon 조작 + Azimuth/Elevation→Vector3
  ↓ ref
useScene.ts (sunRef)       ← Babylon DirectionalLight
```

## 사전 작업
```bash
git status && git log --oneline -1   # 3b-1 commit 위
git checkout -b phase3b-2-lighting-panel
```

## 수정/신규 파일

| # | 파일 | 작업 |
|---|---|---|
| 1 | `frontend/src/hooks/useScene.ts` | sunRef 노출 (~5 LOC) |
| 2 | `frontend/src/hooks/useLightingControl.ts` | 신규 (~80 LOC) |
| 3 | `frontend/src/components/LightingPanel.tsx` | 신규 (~100 LOC) |
| 4 | `frontend/src/components/LightingPanel.module.css` | 신규 (~60 LOC) |
| 5 | `frontend/src/App.tsx` | 임시 마운트 (~10 LOC) |

❌ 그 외 수정 금지. 신규 의존성 금지.

---

## 1. useScene.ts — sunRef 노출

**SceneManager 인터페이스에 추가:**
```ts
import type { DirectionalLight } from '@babylonjs/core/Lights/directionalLight'

export interface SceneManager {
  sceneRef: React.MutableRefObject<Scene | null>
  cameraRef: React.MutableRefObject<ArcRotateCamera | null>
  sunRef: React.MutableRefObject<DirectionalLight | null>  // ← 추가
  createScene: () => Scene
  fitCameraToScene: (scene: Scene) => void
  createGround: (minY: number) => void
}
```

**본문:**
- `const sunRef = useRef<DirectionalLight | null>(null)` 추가
- 기존 `const sun = new DirectionalLight(...)` 직후: `sunRef.current = sun`
- dispose 블록 sceneRef 정리 직후: `sunRef.current = null`
- return: `{ sceneRef, cameraRef, sunRef, createScene, fitCameraToScene, createGround }`

**금지**: sun을 ownedResourcesRef에 push 금지.

---

## 2. useLightingControl.ts 신규

```ts
// Copyright (c) 2025 Philip Choi

import { useCallback, useState } from 'react'
import { Vector3 } from '@babylonjs/core/Maths/math.vector'
import type { SceneManager } from './useScene'

export interface LightingState {
  azimuth: number     // 0-360°
  elevation: number   // 0-90°
  intensity: number   // 0-5
}

export const DEFAULT_LIGHTING: LightingState = {
  azimuth: 225,
  elevation: 63,
  intensity: 2.0,
}

/** Azimuth(0=북=+Z)/Elevation(0=수평,90=정수리) → Babylon direction (빛 진행 방향) */
export function azElToDirection(azimuthDeg: number, elevationDeg: number): Vector3 {
  const azRad = (azimuthDeg * Math.PI) / 180
  const elRad = (elevationDeg * Math.PI) / 180
  const x = -Math.sin(azRad) * Math.cos(elRad)
  const y = -Math.sin(elRad)
  const z = -Math.cos(azRad) * Math.cos(elRad)
  return new Vector3(x, y, z).normalize()
}

export function useLightingControl(sceneManager: SceneManager) {
  const [state, setState] = useState<LightingState>(DEFAULT_LIGHTING)

  const setAzimuth = useCallback((azimuth: number) => {
    const sun = sceneManager.sunRef.current
    if (!sun) return
    setState((prev) => {
      const next = { ...prev, azimuth }
      sun.direction = azElToDirection(next.azimuth, next.elevation)
      return next
    })
  }, [sceneManager])

  const setElevation = useCallback((elevation: number) => {
    const sun = sceneManager.sunRef.current
    if (!sun) return
    setState((prev) => {
      const next = { ...prev, elevation }
      sun.direction = azElToDirection(next.azimuth, next.elevation)
      return next
    })
  }, [sceneManager])

  const setIntensity = useCallback((intensity: number) => {
    const sun = sceneManager.sunRef.current
    if (!sun) return
    sun.intensity = intensity
    setState((prev) => ({ ...prev, intensity }))
  }, [sceneManager])

  /** 차량 전환 후 재동기화. App.tsx의 useEffect에서 호출. */
  const resync = useCallback(() => {
    const sun = sceneManager.sunRef.current
    if (!sun) return
    sun.direction = azElToDirection(state.azimuth, state.elevation)
    sun.intensity = state.intensity
  }, [sceneManager, state])

  return { state, setAzimuth, setElevation, setIntensity, resync }
}
```

**금지**: 슬라이더 콜백/azElToDirection/setter 내 logger 호출 (60Hz onChange).

---

## 3. LightingPanel.tsx 신규

```tsx
// Copyright (c) 2025 Philip Choi

import styles from './LightingPanel.module.css'

export interface LightingPanelProps {
  azimuth: number
  elevation: number
  intensity: number
  onAzimuthChange: (value: number) => void
  onElevationChange: (value: number) => void
  onIntensityChange: (value: number) => void
}

export function LightingPanel({
  azimuth, elevation, intensity,
  onAzimuthChange, onElevationChange, onIntensityChange,
}: LightingPanelProps) {
  return (
    <div className={styles.panel}>
      <h3 className={styles.title}>조명</h3>

      <div className={styles.row}>
        <label className={styles.label}>
          <span>방위각 (Azimuth)</span>
          <span className={styles.value}>{azimuth.toFixed(0)}°</span>
        </label>
        <input type="range" min={0} max={360} step={1} value={azimuth}
          onChange={(e) => onAzimuthChange(Number(e.target.value))}
          className={styles.slider} />
      </div>

      <div className={styles.row}>
        <label className={styles.label}>
          <span>고도 (Elevation)</span>
          <span className={styles.value}>{elevation.toFixed(0)}°</span>
        </label>
        <input type="range" min={0} max={90} step={1} value={elevation}
          onChange={(e) => onElevationChange(Number(e.target.value))}
          className={styles.slider} />
      </div>

      <div className={styles.row}>
        <label className={styles.label}>
          <span>강도 (Intensity)</span>
          <span className={styles.value}>{intensity.toFixed(1)}</span>
        </label>
        <input type="range" min={0} max={5} step={0.1} value={intensity}
          onChange={(e) => onIntensityChange(Number(e.target.value))}
          className={styles.slider} />
      </div>
    </div>
  )
}
```

---

## 4. LightingPanel.module.css

```css
.panel {
  --panel-bg: rgba(20, 20, 25, 0.85);
  --panel-fg: #e0e0e0;
  --panel-accent: #4a9eff;
  --panel-padding: 16px;
  --panel-radius: 8px;
  --panel-gap: 14px;

  position: fixed;
  top: 16px;
  right: 16px;
  width: 240px;
  padding: var(--panel-padding);
  background: var(--panel-bg);
  color: var(--panel-fg);
  border-radius: var(--panel-radius);
  backdrop-filter: blur(8px);
  font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
  font-size: 13px;
  z-index: 1000;
  user-select: none;
}

.title { margin: 0 0 12px 0; font-size: 14px; font-weight: 600; }
.row { display: flex; flex-direction: column; gap: 6px; margin-bottom: var(--panel-gap); }
.row:last-child { margin-bottom: 0; }
.label { display: flex; justify-content: space-between; align-items: center; }
.value { color: var(--panel-accent); font-variant-numeric: tabular-nums; font-size: 12px; }
.slider { width: 100%; cursor: pointer; accent-color: var(--panel-accent); }
```

**디자인 변경**: 상단 `--panel-*` 변수만 수정.

---

## 5. App.tsx — 임시 마운트 ⚠️ v2 패치 핵심

```tsx
import { useEffect } from 'react'
import { useLightingControl } from './hooks/useLightingControl'
import { LightingPanel } from './components/LightingPanel'

// sceneManager 사용 가능 위치에:
const lighting = useLightingControl(sceneManager)

// ⚠️ deps는 currentVehicleId만. lighting 객체 전체 넣으면 매 렌더 새 참조라 무한 재실행.
useEffect(() => {
  if (vehicleLoader.currentVehicleId) {
    lighting.resync()
  }
  // eslint-disable-next-line react-hooks/exhaustive-deps
}, [vehicleLoader.currentVehicleId])

// JSX:
<>
  <canvas ref={canvasRef} ... />
  <LightingPanel
    azimuth={lighting.state.azimuth}
    elevation={lighting.state.elevation}
    intensity={lighting.state.intensity}
    onAzimuthChange={lighting.setAzimuth}
    onElevationChange={lighting.setElevation}
    onIntensityChange={lighting.setIntensity}
  />
</>
```

**Plan에서 확정 필요**: App.tsx 정확한 sceneManager/vehicleLoader 변수명, 기존 useEffect 충돌 여부, canvas 컨테이너 구조.

---

## 절대 금지
- ❌ 슬라이더/azElToDirection/setter/반복문 내 logger 호출
- ❌ 신규 logger.info/warn 추가
- ❌ ownedResourcesRef에 sun 등록
- ❌ Material `instanceof` 사용 (`getClassName()` 사용)
- ❌ skybox size 변경 (100 고정)
- ❌ dispose 순서 변경
- ❌ 신규 의존성 (`npm install` 금지)
- ❌ 명시된 5개 외 파일 수정
- ❌ 글로벌 CSS 추가 (CSS module만)
- ❌ resync useEffect deps에 lighting 객체 넣기 (무한 재실행)

## 검증

### A. 빌드/타입
```bash
npm run typecheck && npm run build   # 기존 useEngine.ts 에러 외 신규 에러 없을 것
```

### B. 시각/UI
1. 우측 상단 LightingPanel 표시
2. 방위각 드래그 → 하이라이트 좌우 이동
3. 고도 드래그 → 0(수평)↔90(정수리) 음영 변화
4. 강도 드래그 → 0(어둠)↔5(과노출)
5. **드래그 중 FPS 60+ 유지**

### C. 차량 전환 회귀 (resync 검증 핵심)
1. 강도 4.5로 조정
2. 차량 A → B 전환
3. **B 로드 후에도 강도 4.5 유지** 확인
4. default(2.0) 리셋되면 → resync 미동작, Plan 재검토

### D. resync 무한 재실행 방지 검증 (v2 신규)
1. 차량 1대 로드 후 슬라이더 조작
2. 콘솔에서 `[조명]` 또는 resync 관련 로그가 슬라이더 조작 시마다 찍히지 않는지 확인
3. React DevTools Profiler로 LightingPanel 렌더 횟수 확인 — 슬라이더 1회 조작 = 1회 렌더

### E. 메모리
- A↔B 10회 + GC
- Snapshot B ≤ **285MB** (3b-1 264MB + React +20MB 여유)
- > 295MB → rollback

### F. Effect 누적
- A↔B 10회 후 Effect Delta ≤ +5
- 슬라이더 조작은 셰이더 재컴파일 안 함, Effect 증가 없어야 함

### G. 회귀
- 빠른 차량 전환 3회 → 콘솔 에러 0
- `[dispose 검증]` cachedTextures 0→0
- AbortController 정상

## 완료 체크리스트
- [ ] 분기 생성
- [ ] 5개 파일 작업
- [ ] typecheck 통과
- [ ] LightingPanel 표시 + 슬라이더 3개 동작
- [ ] 드래그 중 FPS 60+
- [ ] 차량 전환 후 슬라이더 값 유지
- [ ] resync 무한 재실행 없음 (v2)
- [ ] Snapshot B ≤ 285MB
- [ ] Effect Delta ≤ +5
- [ ] 회귀 없음
- [ ] git commit

## 커밋 메시지
```
3b-2: LightingPanel + Az/El/Intensity 슬라이더

- 순수 React + CSS module (의존성 0)
- LightingPanel(UI) ↔ useLightingControl(로직) 분리
- SceneManager에 sunRef 노출
- azElToDirection 변환 (3b-3 프리셋, 3b-4 그림자 재사용)
- 차량 전환 시 resync로 조명 상태 유지
- resync useEffect deps는 currentVehicleId만 (무한 재실행 방지)
- Phase 3c Accordion 슬롯 형태 props 설계

검증 (데스크탑 RTX 3060):
- Snapshot B: ___MB (목표 ≤285)
- Effect Delta: +___ (목표 ≤5)
- 슬라이더 드래그 FPS 60+
- 차량 전환 후 조명 상태 유지
- resync 무한 재실행 없음
```

## Rollback
```bash
git reset --hard <3b-1 commit hash>
git branch -D phase3b-2-lighting-panel
```

## 다음
**3b-3**: 프리셋 (아침/정오/저녁) — LightingPanel에 버튼 3개, useLightingControl에 `applyPreset()`. azElToDirection 재사용. 🟢 Edit auto OK.
