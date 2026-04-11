# Phase 3a-3: PBR 검증 + 반사 바닥

## 전제 조건
- CLAUDE.md 규칙 준수, 주석 한국어, 저작권 Philip Choi, logger 사용
- 시작 전 `git commit -am "phase3a-3 시작 전 스냅샷"`
- **3a-2 검증 통과 필수**: env 없으면 반사 바닥이 검게 나옴
- Phase 2 메모리 누수는 건드리지 말 것

## 목표
GLB PBR 적합성 검증 + 반사 바닥 추가.

## 수정 대상 파일 (2개)
1. `frontend/src/hooks/useVehicleLoader.ts` — PBR 검증
2. `frontend/src/hooks/useScene.ts` — 바닥

## 작업 1: PBR 검증 (useVehicleLoader.ts)
비PBR 있으면 경고만, **변환 금지**:
```typescript
const total = scene.materials.length;
const pbrCount = scene.materials.filter((m) => m instanceof PBRMaterial).length;
logger.dev(`[pbr] ${pbrCount}/${total}`);
if (pbrCount < total) {
  logger.warn(`[pbr] 비PBR ${total - pbrCount}개 - UE5 export 점검 필요`);
}
```
DevPanel에 `PBR: N/N` 형식 표시.

## 작업 2: 반사 바닥 (useScene.ts)
```typescript
const ground = MeshBuilder.CreateGround("ground", { width: 20, height: 20 }, scene);
const groundMat = new PBRMaterial("groundMat", scene);
groundMat.albedoColor = new Color3(0.1, 0.1, 0.1);
groundMat.metallic = 0;
groundMat.roughness = 0.2;
ground.material = groundMat;
ground.position.y = vehicleMinY - 0.01; // z-fighting 방지, 타이어 묻힘 방지

ownedResources.push(ground, groundMat);
```

## 금지사항
- 비PBR 자동 변환 금지
- 바닥 크기 20×20 외 값 금지
- 바닥에 텍스처 금지 (단색 PBR만)

## 검증 체크리스트
- [ ] 바닥에 IBL 기반 흐릿한 차량 반사 보임
- [ ] **바닥이 새까맣지 않음** (새까맣다면 3a-2 재검토)
- [ ] DevPanel `PBR: N/N` 표시
- [ ] 드로우콜 78 이내 (+3 예상)
- [ ] Heap 285MB 이내
- [ ] FPS 115 이상
