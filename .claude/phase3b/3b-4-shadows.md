# Phase 3b-4: 실시간 그림자 (ShadowGenerator) — v2

🟡 **Plan Mode 필수** | 위험도: **⚠️ 최고** | 수정 파일: 5개 + Viewer 2줄

> **v2 변경**: registerShadowCasters에 `renderList.length = 0` 방어 클리어 1줄 추가 (자체 검토 발견). Gemini 검토는 신규 발견 0건, 4개 핵심 항목 모두 사후 추인.

## ⚠️ 위험 경고

- GPU 텍스처(shadow map) 수동 dispose 필요 — 누락 시 GPU 누수
- 차량 전환마다 ShadowGenerator 재생성 — dispose 순서 1개라도 틀리면 누적
- PBR 셰이더 shadow variant 재컴파일 — Effect +10~20 정상
- sun.position 유동 배치 — bounding box 계산 잘못 시 그림자 잘림
- 5개 파일 변경, 3b-2와 동급 규모

검증 실패 시 즉시 rollback. 임계치 하나라도 초과하면 진행 중단.

## 사전 작업
```bash
git status && git log --oneline -1   # 3b-3 commit 위
git checkout -b phase3b-4-shadows
```

## 결정사항 (사전 합의됨)
| 항목 | 결정 |
|---|---|
| Shadow map 해상도 | **1024** (~16MB GPU) |
| 필터링 | **PCF Medium** (`usePercentageCloserFiltering=true`, `filteringQuality=QUALITY_MEDIUM`) |
| 토글 UI | LightingPanel 체크박스 추가 |
| sun.position | sceneManager 내부 차량 bounding box 기준 유동 배치 |
| Caster 등록 | `useScene.registerShadowCasters(meshes)` 메서드 |
| Receiver | `ground` + 차량 mesh self-shadowing |

## 수정 파일

| # | 파일 | 작업 | 규모 |
|---|---|---|---|
| 1 | `frontend/src/hooks/useScene.ts` | ShadowGenerator + registerShadowCasters + updateSunPosition + setShadowsEnabled | ~70 LOC |
| 2 | `frontend/src/hooks/useVehicleLoader.ts` | registerShadowCasters 호출 | ~5 LOC |
| 3 | `frontend/src/hooks/useLightingControl.ts` | shadowsEnabled state + updateSunPosition 호출 | ~20 LOC |
| 4 | `frontend/src/components/LightingPanel.tsx` | 체크박스 props + JSX | ~15 LOC |
| 5 | `frontend/src/components/LightingPanel.module.css` | 체크박스 스타일 | ~20 LOC |
| (6) | `frontend/src/components/Viewer.tsx` | props 2줄 (예외 허용) | ~2 LOC |

❌ 그 외 수정 금지. 신규 파일 금지.

---

## 1. useScene.ts

### 1-1. import
```ts
import { ShadowGenerator } from '@babylonjs/core/Lights/Shadows/shadowGenerator'
import type { AbstractMesh } from '@babylonjs/core/Meshes/abstractMesh'
```

### 1-2. SceneManager 인터페이스 확장
```ts
export interface SceneManager {
  sceneRef: React.MutableRefObject<Scene | null>
  cameraRef: React.MutableRefObject<ArcRotateCamera | null>
  sunRef: React.MutableRefObject<DirectionalLight | null>
  shadowGeneratorRef: React.MutableRefObject<ShadowGenerator | null>  // ← 추가
  createScene: () => Scene
  fitCameraToScene: (scene: Scene) => void
  createGround: (minY: number) => void
  registerShadowCasters: (meshes: AbstractMesh[]) => void              // ← 추가
  setShadowsEnabled: (enabled: boolean) => void                        // ← 추가
  updateSunPosition: () => void                                        // ← 추가
}
```

### 1-3. ref 추가
```ts
const shadowGeneratorRef = useRef<ShadowGenerator | null>(null)
const vehicleBoundsRef = useRef<{ center: Vector3; diagonal: number } | null>(null)
```

### 1-4. createScene — sun 생성 직후 ShadowGenerator
**기존 sun 생성 코드 직후:**
```ts
sunRef.current = sun

// === ShadowGenerator 생성 ===
const shadowGenerator = new ShadowGenerator(1024, sun)
shadowGenerator.usePercentageCloserFiltering = true
shadowGenerator.filteringQuality = ShadowGenerator.QUALITY_MEDIUM
shadowGenerator.bias = 0.001          // shadow acne 방지 (acne 발생 시 0.005까지)
shadowGenerator.normalBias = 0.02     // self-shadow artifact 방지
shadowGenerator.darkness = 0.3        // 그림자 농도 (0=완전검정, 1=투명)
shadowGeneratorRef.current = shadowGenerator

// GPU 텍스처(shadow map) dispose 보장 — Light와 달리 ownedResources 등록 필수
ownedResourcesRef.current.push(shadowGenerator)
```

⚠️ ShadowGenerator는 **GPU 텍스처 소유**. ownedResourcesRef 등록 누락 시 GPU 누수.

### 1-5. createGround — receiver 등록
기존 createGround 본문 마지막에 추가:
```ts
ground.receiveShadows = true
```

### 1-6. registerShadowCasters 메서드 신규
```ts
const registerShadowCasters = useCallback((meshes: AbstractMesh[]) => {
  const sg = shadowGeneratorRef.current
  if (!sg) return

  const renderList = sg.getShadowMap()?.renderList
  if (!renderList) return

  // 방어적 클리어 — ShadowGenerator 재사용 시 이전 차량 mesh dangling 방지
  renderList.length = 0

  for (const m of meshes) {
    if (m.name === 'hdrSkyBox' || m.name === '__root__' || m.name === 'ground') continue
    if (m.getTotalVertices() === 0) continue
    renderList.push(m)
    m.receiveShadows = true  // self-shadowing
  }
}, [])
```

### 1-7. setShadowsEnabled 메서드 신규
```ts
const setShadowsEnabled = useCallback((enabled: boolean) => {
  const sg = shadowGeneratorRef.current
  if (!sg) return
  // dispose 안 함 (재생성 비용 + Effect 재컴파일 회피)
  // shadow map 갱신만 끔 + darkness로 시각적 OFF
  const shadowMap = sg.getShadowMap()
  if (shadowMap) {
    shadowMap.refreshRate = enabled ? 1 : 0
  }
  sg.darkness = enabled ? 0.3 : 1.0
}, [])
```

### 1-8. updateSunPosition 메서드 신규
```ts
const updateSunPosition = useCallback(() => {
  const sun = sunRef.current
  const bounds = vehicleBoundsRef.current
  if (!sun || !bounds) return
  // sun.direction의 반대 방향으로 diagonal*1.5만큼 떨어진 위치 = 빛의 출발점
  const offset = bounds.diagonal * 1.5
  sun.position = bounds.center.subtract(sun.direction.scale(offset))
}, [])
```

### 1-9. fitCameraToScene 수정 — bounds 저장 + 초기 sun 배치
fitCameraToScene 본문 끝, 기존 `logger.info('[카메라 fit]', ...)` 직전에 추가:
```ts
// vehicle bounds 저장 (updateSunPosition에서 재사용)
vehicleBoundsRef.current = { center, diagonal }

// 초기 sun.position 배치 + shadow frustum 크기
const sun = sunRef.current
if (sun) {
  updateSunPosition()
  sun.shadowMinZ = 0.1
  sun.shadowMaxZ = diagonal * 5
}
```

⚠️ updateSunPosition을 같은 useCallback 내에서 참조하므로 deps 추가 필요. fitCameraToScene의 useCallback deps에 `updateSunPosition` 추가.

### 1-10. dispose 블록 — ref nullify
기존 `sunRef.current = null` 직후 추가:
```ts
shadowGeneratorRef.current = null
vehicleBoundsRef.current = null
```

**dispose 순서는 변경 금지.** ShadowGenerator는 ownedResourcesRef에 들어가 있어 자동으로 올바른 순서.

### 1-11. return
```ts
return {
  sceneRef, cameraRef, sunRef, shadowGeneratorRef,
  createScene, fitCameraToScene, createGround,
  registerShadowCasters, setShadowsEnabled, updateSunPosition,
}
```

---

## 2. useVehicleLoader.ts — registerShadowCasters 호출

기존 `sceneManager.fitCameraToScene(newScene)` 직후, adjustCameraClipping 다음에 추가:
```ts
sceneManager.fitCameraToScene(newScene)
if (sceneManager.cameraRef.current) {
  adjustCameraClipping(sceneManager.cameraRef.current, newScene.meshes)
}

// === 그림자 caster 등록 (3b-4) ===
sceneManager.registerShadowCasters(newScene.meshes)
```

이외 수정 금지.

---

## 3. useLightingControl.ts

### 3-1. state 추가
```ts
const [shadowsEnabled, setShadowsEnabledState] = useState<boolean>(true)
```

### 3-2. setShadowsEnabled 콜백
```ts
const setShadowsEnabled = useCallback((enabled: boolean) => {
  sceneManager.setShadowsEnabled(enabled)
  setShadowsEnabledState(enabled)
}, [sceneManager])
```

### 3-3. setAzimuth/setElevation에 updateSunPosition 호출 추가
**기존 setAzimuth:**
```ts
const setAzimuth = useCallback((azimuth: number) => {
  const sun = sceneManager.sunRef.current
  if (!sun) return
  setActivePreset(null)
  setState((prev) => {
    const next = { ...prev, azimuth }
    sun.direction = azElToDirection(next.azimuth, next.elevation)
    sceneManager.updateSunPosition()  // ← 추가
    return next
  })
}, [sceneManager])
```
setElevation도 동일. **setIntensity는 direction 변경 없으므로 추가 불필요.**

### 3-4. applyPreset에 updateSunPosition 추가
```ts
const applyPreset = useCallback((preset: LightingPreset) => {
  const sun = sceneManager.sunRef.current
  if (!sun) return
  const next: LightingState = {
    azimuth: preset.azimuth,
    elevation: preset.elevation,
    intensity: preset.intensity,
  }
  sun.direction = azElToDirection(next.azimuth, next.elevation)
  sun.intensity = next.intensity
  sceneManager.updateSunPosition()  // ← 추가
  setState(next)
  setActivePreset(preset.id)
}, [sceneManager])
```

### 3-5. resync에 updateSunPosition + 토글 상태 복원 추가
```ts
const resync = useCallback(() => {
  const sun = sceneManager.sunRef.current
  if (!sun) return
  sun.direction = azElToDirection(state.azimuth, state.elevation)
  sun.intensity = state.intensity
  sceneManager.updateSunPosition()                    // ← 추가
  sceneManager.setShadowsEnabled(shadowsEnabled)      // ← 추가: 토글 상태 유지
}, [sceneManager, state, shadowsEnabled])
```

### 3-6. return
```ts
return {
  state, activePreset, shadowsEnabled,
  setAzimuth, setElevation, setIntensity,
  setShadowsEnabled, applyPreset, resync,
}
```

**금지**: setShadowsEnabled / updateSunPosition 호출부 / registerShadowCasters 내 logger 호출.

---

## 4. LightingPanel.tsx — 체크박스

### 4-1. Props 확장
```tsx
export interface LightingPanelProps {
  // ... 기존 ...
  shadowsEnabled: boolean
  onShadowsToggle: (enabled: boolean) => void
}
```

### 4-2. JSX — 마지막 슬라이더 row 직후
```tsx
<div className={styles.row}>
  {/* 기존 강도 슬라이더 */}
</div>

{/* 그림자 토글 (3b-4) */}
<div className={styles.toggleRow}>
  <label className={styles.toggleLabel}>
    <input
      type="checkbox"
      checked={shadowsEnabled}
      onChange={(e) => onShadowsToggle(e.target.checked)}
      className={styles.checkbox}
    />
    <span>그림자</span>
  </label>
</div>
```

---

## 5. LightingPanel.module.css

기존 CSS 끝에 추가:
```css
.toggleRow {
  display: flex;
  align-items: center;
  margin-top: 4px;
  padding-top: 12px;
  border-top: 1px solid rgba(255, 255, 255, 0.08);
}

.toggleLabel {
  display: flex;
  align-items: center;
  gap: 8px;
  cursor: pointer;
  user-select: none;
  font-size: 13px;
}

.checkbox {
  width: 16px;
  height: 16px;
  cursor: pointer;
  accent-color: var(--panel-accent);
}
```

---

## 6. Viewer.tsx — props 2줄 (예외)

```tsx
<LightingPanel
  // ... 기존 props ...
  shadowsEnabled={lighting.shadowsEnabled}
  onShadowsToggle={lighting.setShadowsEnabled}
/>
```

⚠️ 그 외 Viewer.tsx 수정 금지.

---

## 절대 금지

- ❌ ShadowGenerator를 ownedResourcesRef push 누락 (GPU 누수 직격)
- ❌ dispose 순서 변경
- ❌ shadow map 해상도 변경 (1024 고정)
- ❌ usePoissonSampling, useContactHardeningShadow 등 다른 필터링 모드
- ❌ 토글 OFF 시 ShadowGenerator dispose (재생성 비용 + Effect 누적)
- ❌ registerShadowCasters의 `renderList.length = 0` 방어 클리어 생략
- ❌ setAz/El/applyPreset/resync 4곳 중 하나라도 updateSunPosition 호출 누락
- ❌ 슬라이더/setter/registerShadowCasters/updateSunPosition 내 logger
- ❌ 신규 logger.info/warn
- ❌ Material `instanceof` 사용
- ❌ skybox size 변경 (100 고정)
- ❌ 신규 의존성
- ❌ 명시 외 파일 수정 (Viewer.tsx props 2줄만 예외)

---

## 검증 절차

### A. 빌드/타입
```bash
npx tsc --noEmit
```

### B. 시각 (가장 중요)
1. 차량 로드 → **바닥에 그림자 렌더링** 확인
2. 슬라이더 조작 시 **그림자 위치/방향 실시간 추적**
3. 5개 프리셋 그림자:
   - 정오(elevation 80°): 짧은 그림자
   - 아침/저녁(elevation 20-25°): 긴 그림자
   - 밤(intensity 0.4): 약한 그림자
4. 그림자 토글 OFF → 사라짐
5. 그림자 토글 ON → 다시 나타남
6. **그림자 가장자리 부드러운지** (PCF Medium)
7. **Shadow acne 확인**: 차량 표면에 지지직거림 있으면 보고 (bias 0.005로 조정 필요 가능성)

### C. 차량 전환 회귀 — 핵심
1. 차량 A → B 전환 후 그림자 정상
2. **A↔B 5회 전환 후 그림자 잔재 없음** (renderList 방어 클리어 동작 확인)
3. 그림자 토글 OFF 상태로 차량 전환 → 새 차량도 OFF (resync 동작)
4. 콘솔 에러 0
5. `[dispose 검증]` cachedTextures 0→0

### D. 메모리
- A↔B 10회 + GC
- ✅ **≤ 300 MB**: 통과
- ⚠️ 300~320 MB: warn
- 🔴 **> 320 MB**: 즉시 rollback

### E. Effect 누적
- A↔B 10회 후 Delta
- ✅ **≤ +20**
- ⚠️ +20~+40
- 🔴 **> +40** rollback

### F. GPU 텍스처 누수 — 3b-4 핵심
- Heap snapshot Comparison, 클래스 필터 `RenderTargetTexture`
- ✅ **Delta ≤ +2** (1회성 신규)
- 🔴 **Delta > +5** rollback

### G. FPS
- 그림자 ON FPS
- ✅ ≥ 60
- 🔴 < 30 rollback 검토

### H. Frustum 검증
1. elevation 0에 가깝게 → 그림자가 옆으로 길게
2. **그림자 잘림 없는지** (sun.position 유동 동작 확인)
3. 큰 차량 모델 로드 → frustum 잘 맞는지

---

## 완료 체크리스트
- [ ] 분기 생성
- [ ] useScene.ts 수정 (ShadowGenerator + 4개 메서드 + bounds ref)
- [ ] **ownedResourcesRef.push(shadowGenerator) 확인**
- [ ] **registerShadowCasters의 renderList.length = 0 확인**
- [ ] useVehicleLoader.ts에 registerShadowCasters 호출
- [ ] useLightingControl.ts: shadowsEnabled state + updateSunPosition 4곳 호출
- [ ] LightingPanel.tsx 체크박스
- [ ] CSS
- [ ] Viewer.tsx props 2줄
- [ ] typecheck 통과
- [ ] B 시각 (그림자 + PCF 부드러움 + acne 없음)
- [ ] C 회귀 (5회 전환 후 잔재 없음)
- [ ] D 메모리 ≤ 300 MB
- [ ] E Effect ≤ +20
- [ ] F GPU 텍스처 ≤ +2
- [ ] G FPS ≥ 60
- [ ] H frustum 잘림 없음
- [ ] git commit

## 커밋 메시지
```
3b-4: 실시간 그림자 (ShadowGenerator + PCF Medium)

- ShadowGenerator 1024 해상도, PCF Medium 필터링
- registerShadowCasters: 차량 mesh 일괄 등록 + renderList 방어 클리어
- updateSunPosition: 차량 bounding box 기준 sun.position 유동 배치
- 슬라이더/프리셋/resync 시 sun.position 실시간 갱신 (frustum 잘림 방지)
- LightingPanel 그림자 토글 (OFF 시 refreshRate=0 + darkness=1.0, dispose 안 함)
- ShadowGenerator는 ownedResourcesRef 등록 (GPU 텍스처 dispose 보장)
- 차량 mesh self-shadowing + ground receiveShadows
- 차량 전환 시 토글 상태 resync로 유지

검증 (데스크탑 RTX 3060):
- Snapshot A ___MB → B ___MB (목표 ≤300)
- Effect Delta: +___ (목표 ≤20)
- RenderTargetTexture Delta: +___ (목표 ≤2)
- FPS ___ (목표 ≥60)
- 5개 프리셋 그림자 정상, 토글 동작, frustum 잘림 없음, acne 없음
```

## Rollback
```bash
git reset --hard <3b-3 commit hash>
git branch -D phase3b-4-shadows
```

## 다음
**3b-5**: Bloom (`pipeline.bloomEnabled = true`). 위험 중간. threshold/weight/scale 조정.
