# Phase 3b-1: DirectionalLight 기본 추가 (v2)

🟡 **Plan Mode 필수** | 위험도: 낮음 | 수정 파일: useScene.ts 1개

## 목표
`createScene()`에 DirectionalLight 1개 추가. HemisphericLight는 앰비언트 역할로 약화. 슬라이더는 3b-2 작업이므로 본 단계는 하드코딩 고정값만.

## 사전 작업
```bash
git status && git log --oneline -1   # 29b5599 위 확인
git checkout -b phase3b-1-directional-light
```

## 구현 사양

### 1. import 추가
```ts
import { DirectionalLight } from '@babylonjs/core/Lights/directionalLight'
```

### 2. createScene() — HemisphericLight 블록 교체
```ts
// 앰비언트 (DirectionalLight 도입으로 약화)
const ambient = new HemisphericLight('ambient', new Vector3(0, 1, 0), scene)
ambient.intensity = 0.4

// 주광 (3b-2 슬라이더 제어 예정)
// position은 DirectionalLight 계산엔 무관(무한원점)이나 3b-4 ShadowGenerator frustum 기준점
const sun = new DirectionalLight('sun', new Vector3(-0.5, -1, -0.5).normalize(), scene)
sun.intensity = 2.0
sun.position = new Vector3(5, 10, 5) // TODO(3b-4): (15,30,15) 재조정 검토
```

### 3. 로그 (1줄만)
기존 `[후처리]` debug 직후:
```ts
logger.debug('[조명] DirectionalLight intensity=2.0, ambient=0.4')
```

## 절대 금지
- ❌ `ownedResourcesRef.push(sun/ambient)` — Light는 scene.dispose() 자동 해제, 이중 dispose 시 런타임 에러
- ❌ 신규 `logger.info/warn` 추가
- ❌ 반복문 내 logger 호출
- ❌ Material `instanceof` (반드시 `getClassName() === 'PBRMaterial'`)
- ❌ skybox size 변경 (100 고정)
- ❌ dispose 순서 변경
- ❌ useScene.ts 외 파일 수정

## 검증

### A. 빌드/타입
```bash
npm run typecheck && npm run build
```
WebGPU 셰이더 에러는 런타임에 발생 — 첫 차량 로드 후 콘솔에서 `WGSL` / `shader compilation` 키워드 검색.

### B. 시각
- 명암 대비 생성 (이전 flat IBL → 우상단 하이라이트 + 좌하단 음영)
- 방향벡터 (-0.5,-1,-0.5) → 빛이 +X,+Y,+Z 방향에서 옴
- 그림자 없음 (3b-4 예정) — 정상

### C. 메모리 (작업 노트북 RTX 5000 Ada, A↔B 10회 + GC)
- ✅ **≤ 275MB**: 통과 (기존 260MB + 셰이더 variant +15MB 허용)
- ⚠️ **275~290MB**: warn, 셰이더 캐시 의심
- 🔴 **> 290MB**: 즉시 `git reset --hard 29b5599`

### D. 셰이더 캐시 (Gemini 핵심 지적)
DirectionalLight 추가 시 PBR 머티리얼이 새 light variant 셰이더 컴파일 → 차량 전환 시 Effect 객체 누적 여부:

1. Chrome DevTools → Memory → Heap snapshot (A 직후)
2. A↔B 10회 + GC
3. Heap snapshot (B 직후)
4. Comparison → `Effect` 클래스 필터
5. **판정: Delta ≤ +5** (variant 1~2개 신규는 정상, 10개+는 누수)

> 코드 로그 검증 불가 — 반드시 DevTools Heap diff

### E. 회귀
- 빠른 차량 전환 3회 → AbortController 콘솔 에러 0
- `[dispose 검증]` cachedTextures 0→0 유지
- FPS 60 유지

## 완료 체크리스트
- [ ] 분기 생성
- [ ] useScene.ts 수정 (1개 파일)
- [ ] typecheck + build 통과
- [ ] WebGPU 셰이더 에러 없음
- [ ] 시각 검증 (명암 + specular 방향)
- [ ] Snapshot B ≤ 275MB
- [ ] Effect Delta ≤ +5
- [ ] AbortController/dispose/FPS 회귀 없음
- [ ] 임시 로그 제거
- [ ] git commit
- [ ] Phase 3b 누적 메모 갱신

## 커밋 메시지
```
3b-1: DirectionalLight 주광 추가

- intensity 2.0, dir (-0.5,-1,-0.5).normalize()
- HemisphericLight → ambient(0.4)로 약화
- Light는 scene.dispose() 자동 해제 (ownedResources 미등록)
- 그림자 비활성 (3b-4 예정)

검증:
- Snapshot B: ___MB (목표 ≤275)
- Effect Delta: +___ (목표 ≤5)
```

## Rollback
```bash
git reset --hard 29b5599
git branch -D phase3b-1-directional-light
```

## 다음
**3b-2**: LightingPanel.tsx 신규 + Azimuth/Elevation/Intensity 슬라이더. Phase 3c Accordion 통합 고려 props 설계.
