# Phase 3b-5: Bloom 후처리

🟡 **Plan Mode 권장** | 위험도: 중간 | 수정 파일: 4개 + Viewer 2줄

## 목표
DefaultRenderingPipeline의 bloom을 활성화하고 LightingPanel에 토글 추가. 차량 평가용으로 절제된 파라미터(threshold 0.8 / weight 0.3 / kernel 64 / scale 0.5). 사용자가 ON/OFF 가능.

## 핵심 설계 원칙

**3b-4 setShadowsEnabled 패턴 그대로 적용**: 
- Bloom 파라미터는 createScene에서 한 번만 설정
- 토글은 `pipeline.bloomEnabled = true/false`만 변경
- pipeline 자체는 dispose하지 않음 (이미 ownedResourcesRef로 추적 중)

이 패턴이 RenderTargetTexture 누수 방지의 핵심입니다.

## 사전 작업
```bash
git status && git log --oneline -1   # 3b-4 commit 위
git checkout -b phase3b-5-bloom
```

## 결정사항 (사전 합의됨)

| 항목 | 결정 |
|---|---|
| 토글 UI | LightingPanel 체크박스 (그림자 토글 아래) |
| bloomThreshold | 0.8 |
| bloomWeight | 0.3 |
| bloomKernel | 64 |
| bloomScale | 0.5 |
| 슬라이더 노출 | 안 함 (토글만) |

## 수정 파일

| # | 파일 | 작업 | 규모 |
|---|---|---|---|
| 1 | `frontend/src/hooks/useScene.ts` | bloom 파라미터 설정 (createScene 내부) | ~6 LOC |
| 2 | `frontend/src/hooks/useLightingControl.ts` | bloomEnabled state + setter, 차량 전환 직접 처리 불가 (sceneManager 경유) | ~15 LOC |
| 3 | `frontend/src/components/LightingPanel.tsx` | 토글 props + JSX | ~10 LOC |
| 4 | `frontend/src/components/LightingPanel.module.css` | 변경 없음 (기존 toggleRow/toggleLabel/checkbox 재사용) |
| (5) | `frontend/src/components/Viewer.tsx` | props 2줄 | ~2 LOC |

⚠️ CSS는 변경 없음. 3b-4의 toggleRow 클래스를 그대로 재사용.

❌ 그 외 수정 금지. 신규 파일/의존성 금지.

---

## 1. useScene.ts — Bloom 파라미터 설정

### 1-1. SceneManager 인터페이스에 메서드 추가
```ts
export interface SceneManager {
  // ... 기존 ...
  setBloomEnabled: (enabled: boolean) => void   // ← 추가
}
```

### 1-2. pipelineRef 추가 (필요 시)
**확인 필요**: 기존 useScene.ts에서 pipeline이 ownedResourcesRef에만 있고 별도 ref 없을 가능성. setBloomEnabled에서 pipeline 접근하려면 ref 필요:

```ts
import type { DefaultRenderingPipeline } from '@babylonjs/core/PostProcesses/RenderPipeline/Pipelines/defaultRenderingPipeline'

const pipelineRef = useRef<DefaultRenderingPipeline | null>(null)
```

### 1-3. createScene — pipeline 생성 직후 bloom 파라미터 설정
**기존 pipeline 생성 코드 (3a-4):**
```ts
const pipeline = new DefaultRenderingPipeline('default', true, scene, [camera])
pipeline.imageProcessingEnabled = true
pipeline.imageProcessing.toneMappingEnabled = true
pipeline.imageProcessing.toneMappingType = ImageProcessingConfiguration.TONEMAPPING_ACES
pipeline.fxaaEnabled = true
// Phase 3b에서 활성화 예정
pipeline.bloomEnabled = false
// ...
```

**변경 후:**
```ts
const pipeline = new DefaultRenderingPipeline('default', true, scene, [camera])
pipeline.imageProcessingEnabled = true
pipeline.imageProcessing.toneMappingEnabled = true
pipeline.imageProcessing.toneMappingType = ImageProcessingConfiguration.TONEMAPPING_ACES
pipeline.fxaaEnabled = true

// Bloom (3b-5) — 차량 평가용 절제된 파라미터
pipeline.bloomThreshold = 0.8       // PBR HDR specular highlight만 빛나게
pipeline.bloomWeight = 0.3          // 절제된 강도
pipeline.bloomKernel = 64           // 부드러운 빛 번짐
pipeline.bloomScale = 0.5           // 절반 해상도 RT (성능/품질 균형)
pipeline.bloomEnabled = true        // 기본 ON

// 다른 후처리는 비활성 유지 (별도 phase 예정)
pipeline.depthOfFieldEnabled = false
pipeline.chromaticAberrationEnabled = false
pipeline.grainEnabled = false
pipeline.sharpenEnabled = false

pipelineRef.current = pipeline      // ← setBloomEnabled에서 사용
```

⚠️ **주의**: bloomScale은 **한 번만 설정**. 변경 시 내부 RenderTargetTexture가 재생성되어 누수 위험. 토글에서는 bloomEnabled만 만진다.

### 1-4. setBloomEnabled 메서드 신규
```ts
const setBloomEnabled = useCallback((enabled: boolean) => {
  const pipeline = pipelineRef.current
  if (!pipeline) return
  // bloomScale/threshold/weight/kernel은 변경 안 함 (RTT 재생성 방지)
  pipeline.bloomEnabled = enabled
}, [])
```

### 1-5. dispose 블록 — pipelineRef nullify
기존 dispose 블록에서 sceneRef/cameraRef/sunRef/shadowGeneratorRef nullify 그룹에 추가:
```ts
pipelineRef.current = null
```

⚠️ pipeline 자체 dispose는 ownedResourcesRef에서 처리됨 (변경 금지).

### 1-6. return
```ts
return {
  // ... 기존 ...
  setBloomEnabled,   // ← 추가
}
```

---

## 2. useLightingControl.ts

### 2-1. state 추가
shadowsEnabled state 직후:
```ts
const [bloomEnabled, setBloomEnabledState] = useState<boolean>(true)
```

### 2-2. setBloomEnabled 콜백
setShadowsEnabled 직후:
```ts
const setBloomEnabled = useCallback((enabled: boolean) => {
  sceneManager.setBloomEnabled(enabled)
  setBloomEnabledState(enabled)
}, [sceneManager])
```

### 2-3. resync에 bloom 토글 복원 추가
```ts
const resync = useCallback(() => {
  const sun = sceneManager.sunRef.current
  if (!sun) return
  sun.direction = azElToDirection(state.azimuth, state.elevation)
  sun.intensity = state.intensity
  sceneManager.updateSunPosition()
  sceneManager.setShadowsEnabled(shadowsEnabled)
  sceneManager.setBloomEnabled(bloomEnabled)        // ← 추가
}, [sceneManager, state, shadowsEnabled, bloomEnabled])  // ← deps에 bloomEnabled 추가
```

### 2-4. return 확장
```ts
return {
  state, activePreset, shadowsEnabled, bloomEnabled,
  setAzimuth, setElevation, setIntensity,
  setShadowsEnabled, setBloomEnabled,
  applyPreset, resync,
}
```

**금지**: setBloomEnabled / 콜백 내 logger 호출.

---

## 3. LightingPanel.tsx

### 3-1. Props 확장
```tsx
export interface LightingPanelProps {
  // ... 기존 ...
  bloomEnabled: boolean
  onBloomToggle: (enabled: boolean) => void
}
```

### 3-2. JSX — 그림자 토글 row 직후
**기존 그림자 토글 row 그대로, 그 직후에 두 번째 row 추가:**
```tsx
{/* 그림자 토글 (3b-4) */}
<div className={styles.toggleRow}>
  <label className={styles.toggleLabel}>
    <input type="checkbox" checked={shadowsEnabled}
      onChange={(e) => onShadowsToggle(e.target.checked)}
      className={styles.checkbox} />
    <span>그림자</span>
  </label>
</div>

{/* 블룸 토글 (3b-5) */}
<div className={styles.toggleRow}>
  <label className={styles.toggleLabel}>
    <input type="checkbox" checked={bloomEnabled}
      onChange={(e) => onBloomToggle(e.target.checked)}
      className={styles.checkbox} />
    <span>블룸</span>
  </label>
</div>
```

⚠️ **CSS 주의**: 두 번째 toggleRow의 `border-top` + `padding-top: 12px`이 중복으로 보일 수 있음. 검증 시 확인하여 시각적으로 어색하면 두 번째 row만 border-top 제거하는 CSS 변경 필요.

→ **검증 단계 B에서 확인**, 어색하면 패치.

---

## 4. LightingPanel.module.css

**변경 없음.** 기존 `.toggleRow`, `.toggleLabel`, `.checkbox` 클래스 재사용.

(검증 후 두 토글 사이 시각적 분리 어색하면 1줄 패치 가능)

---

## 5. Viewer.tsx — props 2줄 추가

```tsx
<LightingPanel
  // ... 기존 props ...
  bloomEnabled={lighting.bloomEnabled}
  onBloomToggle={lighting.setBloomEnabled}
/>
```

---

## 절대 금지

- ❌ bloomScale 동적 변경 (createScene에서 한 번만 설정)
- ❌ bloomThreshold/weight/kernel 토글마다 변경
- ❌ pipeline 자체 dispose (ownedResourcesRef가 처리)
- ❌ pipeline 재생성
- ❌ setBloomEnabled / 콜백 / 반복문 내 logger 호출
- ❌ 신규 logger.info/warn
- ❌ 신규 의존성
- ❌ Material `instanceof` 사용
- ❌ skybox size 변경 (100 고정)
- ❌ dispose 순서 변경
- ❌ 명시 외 파일 수정 (Viewer.tsx props 2줄 예외)

---

## ⚠️ 함정 점검 (3b-4 학습 반영)

### 함정 1: useCallback 선언 순서 (TDZ 방지)
**setBloomEnabled가 다른 useCallback의 deps에 들어가지 않으므로 안전.** 단순 setter 패턴이라 TDZ 위험 없음.

### 함정 2: Babylon side-effect import
**확인 필요**: `DefaultRenderingPipeline`은 이미 3a-4에서 사용 중. side-effect import 누락으로 인한 에러는 이미 3a-4에서 해결되어 있을 것. **추가 import 불필요.**

만약 첫 차량 로드 시 "PostProcessRenderPipelineManagerSceneComponent needs to be imported" 같은 에러 발생하면:
```ts
import '@babylonjs/core/PostProcesses/RenderPipeline/postProcessRenderPipelineManagerSceneComponent'
```

### 함정 3: bloomEnabled 초기값 동기화
- useScene.ts: pipeline.bloomEnabled = true (기본 ON)
- useLightingControl.ts: useState<boolean>(true) (기본 ON)
- 두 값 일치 확인. 한쪽이 false면 첫 차량 로드 시 UI는 ON인데 실제 OFF되어 있는 불일치.

---

## 검증 절차

### A. 빌드/타입
```bash
npx tsc --noEmit
```

### B. 시각 (가장 중요)
1. 차량 로드 → 차량 헤드라이트/메탈 specular 부분에 **부드러운 빛 번짐(bloom)** 확인
2. 환경 IBL에서 밝은 영역(스튜디오 천창 등)에 약하게 bloom
3. **블룸 토글 OFF** → bloom 사라짐, 차량 표면 sharpness 증가
4. **블룸 토글 ON** → bloom 다시 나타남
5. 두 토글(그림자/블룸) 시각적으로 잘 구분되는지 확인 (CSS 패치 필요 여부 판단)
6. 조명 강도 슬라이더 5.0으로 올리면 → bloom 더 강해짐 (threshold 0.8 동작 확인)
7. 5개 프리셋 모두 bloom 정상 동작:
   - 정오/스튜디오: bloom 잘 보임 (강한 빛)
   - 밤(intensity 0.4): bloom 거의 안 보임 (threshold 미달)

### C. 차량 전환 회귀
1. 블룸 토글 OFF 상태로 차량 전환 → 새 차량도 OFF 유지 (resync 동작)
2. 차량 A↔B 5회 전환 → 콘솔 에러 0
3. `[dispose 검증]` cachedTextures 0→0

### D. 메모리
- A↔B 10회 + GC
- ✅ **≤ 290 MB**: 통과 (3b-4 278MB + bloom RT ~4MB + 여유)
- ⚠️ 290~310 MB: warn
- 🔴 **> 310 MB**: rollback

### E. Effect 누적
- A↔B 10회 후 Effect Delta
- ✅ ≤ +10 (bloom shader 1~3개 추가 정상)
- 🔴 > +20: rollback

### F. RenderTargetTexture 누수 — 핵심
- A↔B 10회 후 RTT Delta
- ✅ ≤ +3 (shadow map + bloom RT 1회성)
- 🔴 > +5: bloom RT 누수, rollback

### G. FPS
- bloom ON 상태에서 FPS
- ✅ ≥ 60
- 🔴 < 30: bloomScale 0.5에서 더 낮춰야 함, 성능 문제 보고

### H. 토글 무한 ON/OFF 테스트
- 블룸 토글을 빠르게 10회 ON/OFF
- RTT가 누적되지 않는지 확인 (bloomEnabled만 변경, pipeline 재생성 안 함)
- 콘솔 에러 0
- FPS 유지

---

## 완료 체크리스트
- [ ] 분기 생성
- [ ] useScene.ts: pipelineRef + bloom 파라미터 + setBloomEnabled
- [ ] **bloomEnabled 초기값 일치 확인** (useScene true / useLightingControl true)
- [ ] useLightingControl.ts: state + setter + resync 추가
- [ ] LightingPanel.tsx: props + 토글 JSX
- [ ] Viewer.tsx props 2줄
- [ ] typecheck 통과
- [ ] B 시각 (bloom 보이고 토글 동작)
- [ ] 두 토글 CSS 시각 OK (어색하면 패치)
- [ ] C 차량 전환 회귀
- [ ] D 메모리 ≤ 290 MB
- [ ] E Effect Delta ≤ +10
- [ ] F RTT Delta ≤ +3
- [ ] G FPS ≥ 60
- [ ] H 토글 10회 누수 없음
- [ ] git commit

## 커밋 메시지
```
3b-5: Bloom 후처리 + 토글

- DefaultRenderingPipeline bloomEnabled = true
- threshold 0.8 / weight 0.3 / kernel 64 / scale 0.5
  (차량 평가용 절제된 파라미터)
- LightingPanel 블룸 토글 (bloomEnabled만 변경, 파라미터 고정)
- pipelineRef 신규, setBloomEnabled 메서드
- 차량 전환 시 토글 상태 resync로 유지
- pipeline 자체는 ownedResourcesRef로 dispose 보장 (변경 없음)

검증 (데스크탑 RTX 3060, WebGPU):
- Snapshot A ___MB → B ___MB (목표 ≤290)
- Effect Delta: +___ (목표 ≤10)
- RenderTargetTexture Delta: +___ (목표 ≤3)
- FPS ___ (목표 ≥60)
- 5개 프리셋 bloom 정상, 토글 10회 누수 없음
```

## Rollback
```bash
git reset --hard <3b-4 commit hash>
git branch -D phase3b-5-bloom
```

## 다음
**Phase 3c**: Accordion 통합 (LightingPanel을 포함한 여러 패널을 Accordion으로 묶기). shadcn/ui 도입 여부 재평가 시점.
**또는** Phase 4 진입: logger retention 누수 (3a부터 추적된 +79MB 가설) 본진 해결.
