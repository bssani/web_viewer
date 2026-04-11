# Phase 3a-4: DefaultRenderingPipeline (ToneMapping + FXAA)

## 전제 조건
- CLAUDE.md 규칙 준수, 주석 한국어, 저작권 Philip Choi, logger 사용
- 시작 전 `git commit -am "phase3a-4 시작 전 스냅샷"`
- Phase 2 메모리 누수는 건드리지 말 것

## 목표
후처리 파이프라인 도입. **Bloom/SSR/SSAO/DOF는 금지** (Phase 3b 이월).

## 수정 대상 파일 (1개만)
`frontend/src/hooks/useScene.ts`

## 작업
```typescript
const pipeline = new DefaultRenderingPipeline("default", true, scene, [camera]);

// 활성화 (이 2개만)
pipeline.imageProcessingEnabled = true;
pipeline.imageProcessing.toneMappingEnabled = true;
pipeline.imageProcessing.toneMappingType = ImageProcessingConfiguration.TONEMAPPING_ACES;
pipeline.fxaaEnabled = true;

// 명시적 비활성화 (Phase 3b에서 켬)
pipeline.bloomEnabled = false;
pipeline.depthOfFieldEnabled = false;
pipeline.chromaticAberrationEnabled = false;
pipeline.grainEnabled = false;
pipeline.sharpenEnabled = false;

ownedResources.push(pipeline);
```

dispose 시 `pipeline.isDisposed` 로그 추가.

## 금지사항
- bloomEnabled = true 절대 금지
- SSR/SSAO 금지
- samples(MSAA) 값 변경 금지
- 카메라 추가 금지

## 검증 체크리스트
- [ ] ACES 톤매핑 시각 확인 (하이라이트 클리핑 감소)
- [ ] FXAA 에지 개선 확인
- [ ] **FPS 110 이상 유지** (Phase 2 대비 -10 이내 허용)
- [ ] 10회 전환 후 Heap 295MB 이내
- [ ] pipeline isDisposed 로그 true
- [ ] **회사 노트북(Intel Iris Xe) 재측정 시 WebGPU/WebGL 렌더 결과 시각 대조**

## Phase 3a 완료 작업
CLAUDE.md에 벤치마크 append:
```
### Phase 3a 완료 (YYYY-MM-DD)
개발 환경 (RTX 3060):
- FPS: __ / Meshes: __ / Materials: __ / Textures: __ / Draw Calls: __
- 초기 Heap: __ MB / 10회 전환 후: __ MB
- 단계별 Heap 증가폭: 3a-1 __ / 3a-2 __ / 3a-3 __ / 3a-4 __
- logarithmicDepth ON, IBL studio.env, PBR ground, ACES + FXAA

기준 기기 (Intel Iris Xe): [재측정 결과]
```

**누적 효과 판정**: 단계별 Heap 증가폭 중 하나라도 +15MB 초과 시
Phase 4 진입 전 메모리 누수 해결 우선순위 재조정 (CLAUDE.md 실패 기록 append).

Phase 현황 체크박스 업데이트 후 Phase 3b 진입.
