# Phase 3b-3: 조명 프리셋 5개

🟢 **Edit auto OK** | 위험도: 매우 낮음 | 수정 파일: 3개 | 신규: 0

## 목표
LightingPanel에 프리셋 버튼 5개 추가 (아침/정오/저녁/밤/스튜디오). 클릭 시 Az/El/Intensity 일괄 적용. 활성 프리셋 시각 표시. azElToDirection 재사용.

## 사전 작업
```bash
git status && git log --oneline -1   # 3b-2 commit 위
git checkout -b phase3b-3-presets
```

## 수정 파일 (엄격 제한)

| # | 파일 | 작업 |
|---|---|---|
| 1 | `frontend/src/hooks/useLightingControl.ts` | applyPreset + activePreset state |
| 2 | `frontend/src/components/LightingPanel.tsx` | 프리셋 버튼 5개 |
| 3 | `frontend/src/components/LightingPanel.module.css` | 버튼 스타일 |

❌ 그 외 수정 금지. 신규 파일 금지.

---

## 1. useLightingControl.ts 수정

### 1-1. 프리셋 정의 추가 (파일 상단, DEFAULT_LIGHTING 직후)
```ts
export type PresetId = 'morning' | 'noon' | 'evening' | 'night' | 'studio'

export interface LightingPreset {
  id: PresetId
  label: string
  azimuth: number
  elevation: number
  intensity: number
}

export const LIGHTING_PRESETS: LightingPreset[] = [
  { id: 'morning',  label: '아침',     azimuth: 90,  elevation: 25, intensity: 1.5 },
  { id: 'noon',     label: '정오',     azimuth: 180, elevation: 80, intensity: 3.0 },
  { id: 'evening',  label: '저녁',     azimuth: 270, elevation: 20, intensity: 1.8 },
  { id: 'night',    label: '밤',       azimuth: 0,   elevation: 60, intensity: 0.4 },
  { id: 'studio',   label: '스튜디오', azimuth: 135, elevation: 45, intensity: 4.0 },
]
```

### 1-2. activePreset state 추가
```ts
const [activePreset, setActivePreset] = useState<PresetId | null>(null)
```

### 1-3. setAzimuth/setElevation/setIntensity 콜백에 activePreset 리셋 추가
**기존 setAzimuth 본문에 1줄 추가:**
```ts
const setAzimuth = useCallback((azimuth: number) => {
  const sun = sceneManager.sunRef.current
  if (!sun) return
  setActivePreset(null)  // ← 추가: 슬라이더 조작 시 프리셋 해제
  setState((prev) => {
    const next = { ...prev, azimuth }
    sun.direction = azElToDirection(next.azimuth, next.elevation)
    return next
  })
}, [sceneManager])
```
setElevation, setIntensity도 동일하게 `setActivePreset(null)` 추가.

### 1-4. applyPreset 메서드 신규
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
  setState(next)
  setActivePreset(preset.id)
}, [sceneManager])
```

### 1-5. resync에 activePreset 무관 처리 (state만 보면 됨, 변경 없음)
resync는 그대로 둡니다. activePreset은 차량 전환과 무관 (UI state).

### 1-6. return에 activePreset, applyPreset 추가
```ts
return {
  state, activePreset,
  setAzimuth, setElevation, setIntensity,
  applyPreset, resync
}
```

**금지**: applyPreset / setActivePreset 내 logger 호출 금지.

---

## 2. LightingPanel.tsx 수정

### 2-1. Props 확장
```tsx
import type { LightingPreset, PresetId } from '../hooks/useLightingControl'
import { LIGHTING_PRESETS } from '../hooks/useLightingControl'

export interface LightingPanelProps {
  azimuth: number
  elevation: number
  intensity: number
  activePreset: PresetId | null              // ← 추가
  onAzimuthChange: (value: number) => void
  onElevationChange: (value: number) => void
  onIntensityChange: (value: number) => void
  onPresetSelect: (preset: LightingPreset) => void  // ← 추가
}
```

### 2-2. JSX — 제목 직후, 슬라이더 row들 직전에 프리셋 섹션 삽입
```tsx
<h3 className={styles.title}>조명</h3>

{/* 프리셋 (슬라이더 위) */}
<div className={styles.presets}>
  {LIGHTING_PRESETS.map((preset) => (
    <button
      key={preset.id}
      type="button"
      className={`${styles.presetBtn} ${activePreset === preset.id ? styles.presetBtnActive : ''}`}
      onClick={() => onPresetSelect(preset)}
    >
      {preset.label}
    </button>
  ))}
</div>

{/* 기존 슬라이더 row들 그대로 */}
<div className={styles.row}>
  {/* ... 기존 방위각 ... */}
```

---

## 3. LightingPanel.module.css 추가

기존 CSS 끝에 추가:
```css
.presets {
  display: grid;
  grid-template-columns: repeat(5, 1fr);
  gap: 4px;
  margin-bottom: 14px;
}

.presetBtn {
  padding: 6px 4px;
  background: rgba(255, 255, 255, 0.06);
  color: var(--panel-fg);
  border: 1px solid rgba(255, 255, 255, 0.1);
  border-radius: 4px;
  font-size: 11px;
  font-family: inherit;
  cursor: pointer;
  transition: background 0.15s, border-color 0.15s;
}

.presetBtn:hover {
  background: rgba(255, 255, 255, 0.12);
}

.presetBtnActive {
  background: rgba(74, 158, 255, 0.2);
  border-color: var(--panel-accent);
  color: var(--panel-accent);
}
```

---

## 4. Viewer.tsx — props 전달 추가

기존 LightingPanel 마운트에 2줄 추가:
```tsx
<LightingPanel
  azimuth={lighting.state.azimuth}
  elevation={lighting.state.elevation}
  intensity={lighting.state.intensity}
  activePreset={lighting.activePreset}              // ← 추가
  onAzimuthChange={lighting.setAzimuth}
  onElevationChange={lighting.setElevation}
  onIntensityChange={lighting.setIntensity}
  onPresetSelect={lighting.applyPreset}             // ← 추가
/>
```

⚠️ Viewer.tsx는 명시 파일에 없지만 **props 전달 2줄만** 추가하는 사소한 변경이라 허용. 이외 Viewer.tsx 수정 금지.

---

## 절대 금지
- ❌ applyPreset / setActivePreset 내 logger 호출
- ❌ 프리셋 값 하드코딩 위치 변경 (LIGHTING_PRESETS 한 곳에만)
- ❌ azElToDirection 재구현 (재사용 필수)
- ❌ 색온도/Color3 추가 (범위 밖)
- ❌ IBL environmentIntensity 변경 (범위 밖)
- ❌ 신규 파일 생성
- ❌ 명시 외 파일 수정

## 검증 절차

### A. 빌드/타입
```bash
npx tsc --noEmit
```

### B. 시각/UX
1. 우측 상단 LightingPanel에 프리셋 버튼 5개 가로 그리드로 표시
2. **각 프리셋 클릭 → 슬라이더 값 즉시 변경 + 차량 명암 변화**
3. **클릭한 프리셋 버튼이 파란 강조로 highlight**
4. 슬라이더 조작 → highlight 해제 (어느 버튼도 활성 아님)
5. 다른 프리셋 클릭 → 새 버튼이 highlight, 이전 버튼 해제
6. 5개 프리셋 모두 시각 변화 확인:
   - 아침: 동쪽 사이드 + 약간 위
   - 정오: 거의 정수리 강한 빛
   - 저녁: 서쪽 사이드 + 약간 위
   - 밤: 매우 어두움 (IBL만 보임 — 정상)
   - 스튜디오: 남동쪽 강한 빛

### C. 회귀
1. 차량 전환 후 슬라이더 값 유지 (3b-2 resync 그대로 동작)
2. 차량 전환 후 activePreset 상태도 유지 (state는 React state, sun과 무관)
3. 콘솔 에러 0
4. FPS 120 유지

### D. 메모리 (간이)
- 프리셋 5개 순차 클릭 후 콘솔 메모리 확인
- 측정 생략 가능 (변경량 매우 작음, useState 1개 + JSX 5개 버튼)
- 우려 시 Snapshot B ≤ 270MB 기준 (3b-2 267MB + 미미)

## 완료 체크리스트
- [ ] 분기 생성
- [ ] useLightingControl.ts: PRESETS/activePreset/applyPreset 추가
- [ ] setAz/El/Intensity에 setActivePreset(null) 추가
- [ ] LightingPanel.tsx: props + 프리셋 JSX
- [ ] LightingPanel.module.css: 버튼 스타일
- [ ] Viewer.tsx: props 2줄 전달
- [ ] typecheck 통과
- [ ] 5개 프리셋 시각 변화 확인
- [ ] 활성 프리셋 highlight 동작
- [ ] 슬라이더 조작 시 highlight 해제
- [ ] 회귀 없음
- [ ] git commit

## 커밋 메시지
```
3b-3: 조명 프리셋 5개 (아침/정오/저녁/밤/스튜디오)

- LIGHTING_PRESETS 상수 (Az/El/Intensity 값)
- applyPreset 메서드 (azElToDirection 재사용)
- activePreset state + 슬라이더 조작 시 자동 해제
- 활성 프리셋 시각 표시 (presetBtnActive)
- 5개 버튼 가로 그리드 배치 (슬라이더 위)

검증:
- 5개 프리셋 시각 변화 확인
- highlight 동작/해제 확인
- 차량 전환 후 조명 상태 유지 (3b-2 resync 정상)
```

## Rollback
```bash
git reset --hard <3b-2 commit hash>
git branch -D phase3b-3-presets
```

## 다음
**3b-4** ⚠️ **최고 위험**: 실시간 그림자 (ShadowGenerator). sun.position을 차량 bounding box 기준 유동 배치. shadow map 메모리 +10~20MB 예상. dispose 누락 시 GPU 텍스처 누수 위험.
