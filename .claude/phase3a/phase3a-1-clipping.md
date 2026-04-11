# Phase 3a-1: near/far 자동 + logarithmicDepth

## 전제 조건
- CLAUDE.md 규칙 준수, 주석 한국어, 저작권 `// Copyright (c) 2025 Philip Choi`
- console.log 금지 → `utils/logger.ts` 사용
- Phase 2 메모리 누수(+77MB)는 건드리지 말 것
- 시작 전 `git commit -am "phase3a-1 시작 전 스냅샷"` 필수
- 검증 실패 시 즉시 `git reset --hard`

## 목표
카메라 클리핑 문제를 IBL 도입 전에 선제 해결.

## 수정 대상 파일 (2개만)
1. `frontend/src/hooks/useEngine.ts`
2. `frontend/src/hooks/useVehicleLoader.ts`

## 작업 1: useEngine.ts
- WebGPU: `new WebGPUEngine(canvas, { useLogarithmicDepth: true })`
- WebGL fallback: `new Engine(canvas, true, { useLogarithmicDepth: true })`

## 작업 2: useVehicleLoader.ts
GLB 로드 완료 직후 호출. **빈 meshes 방어 필수**:

```typescript
function adjustCameraClipping(camera: ArcRotateCamera, meshes: AbstractMesh[]) {
  if (meshes.length === 0) {
    logger.warn("[clipping] meshes 비어있음, 기본값 유지");
    return;
  }
  let min = new Vector3(Infinity, Infinity, Infinity);
  let max = new Vector3(-Infinity, -Infinity, -Infinity);
  meshes.forEach((m) => {
    const bb = m.getBoundingInfo().boundingBox;
    min = Vector3.Minimize(min, bb.minimumWorld);
    max = Vector3.Maximize(max, bb.maximumWorld);
  });
  const diagonal = Vector3.Distance(min, max);
  camera.minZ = diagonal * 0.001;
  camera.maxZ = diagonal * 100;
  logger.dev(`[clipping] minZ=${camera.minZ.toFixed(3)} maxZ=${camera.maxZ.toFixed(1)}`);
}
```

## 금지사항
- 카메라 radius/alpha/beta/target 자동 조정 금지
- scene.createDefaultCameraOrLight 호출 금지
- 다른 파일 수정 금지

## 검증 체크리스트
- [ ] porsche_911 포함 3대 차량 로드 시 클리핑 없음
- [ ] **내장 근접 확인**: 버튼/대시보드 근접 시 클리핑 없음
- [ ] FPS 117~120 유지
- [ ] 10회 전환 후 Heap 265MB 이내
- [ ] minZ/maxZ 로그 출력
