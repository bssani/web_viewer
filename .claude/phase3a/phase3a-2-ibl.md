# Phase 3a-2: IBL 환경 적용 ⚠️ 최고 위험 구간

## 전제 조건
- CLAUDE.md 규칙 준수, 주석 한국어, 저작권 Philip Choi, logger 사용
- 시작 전 `git commit -am "phase3a-2 시작 전 스냅샷"`
- Phase 2 메모리 누수는 건드리지 말 것

## ⚠️ 경고
env 텍스처는 GPU 메모리 점유가 크고 `scene.dispose()`로 자동 해제되지 않음.
완료 후 반드시 Heap 측정. +10MB 이상 악화 시 즉시 롤백.

## 사전 작업 (수동)
`frontend/public/env/studio.env` 배치 필수. 없으면 중단.

## 수정 대상 파일 (1개만)
`frontend/src/hooks/useScene.ts`

## 작업
```typescript
const envTexture = CubeTexture.CreateFromPrefilteredData(
  `${import.meta.env.BASE_URL}env/studio.env`,
  scene
);
scene.environmentTexture = envTexture;
scene.environmentIntensity = 1.0;

const skybox = scene.createDefaultSkybox(envTexture, true, 1000);

ownedResources.push(envTexture);
if (skybox) ownedResources.push(skybox);
```

## dispose 루틴 (기본 포함, 트러블슈팅 아님)
Phase 2 누수 패턴(`WebGPUBindGroupCacheNode` 누적) 대응.
**참조 끊기는 기본값**:

```typescript
// scene dispose 직전
envTexture.dispose();
scene.environmentTexture = null;
logger.dev(`[dispose] env texture: ${envTexture.isDisposed()}`);
```

## 금지사항
- scene.reflectionTexture 직접 할당 금지
- DefaultRenderingPipeline 금지 (3a-4)
- 바닥 금지 (3a-3)
- environmentIntensity 1.0 외 값 금지

## 검증 체크리스트 (핵심)
- [ ] 차량 표면에 환경 반사 시각 확인
- [ ] DevPanel Textures +2~4 증가
- [ ] **10회 전환 후 Heap 275MB 이내 (+10MB 이내)**
- [ ] dispose 로그 `isDisposed: true`
- [ ] 실패 시 → `git reset --hard`, 3a-3 진입 금지

## 트러블슈팅
Heap 악화 시 `.env` 파일 자체 의심 (prefiltered mipmap 내부 참조 이슈).
다른 HDR 소스로 변환 재시도.
