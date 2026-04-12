# CLAUDE.md 업데이트 패치 (Phase 3a 완료 반영)

이 파일은 CLAUDE.md에 추가/수정할 내용을 모은 패치입니다. 아래 섹션별로 해당 위치에 적용하세요.

---

## 📍 1. "절대 하면 안 되는 것" 섹션에 추가

기존 목록 끝에 다음 항목 추가:

```markdown
- **차량 전환 경로(loadVehicle 흐름)에서 logger.info/warn 호출 최소화** — Phase 3a-3 측정에서 logger 호출이 dev console retention buffer에 누적되어 +79MB 누수 가설 확인됨. 매 mesh 순회 안 logger.debug 절대 금지.
- **Babylon.js 클래스 import 시 instanceof 체크 주의** — `instanceof PBRMaterial` 같은 패턴은 클래스 메타데이터 캐싱을 일으킬 수 있음. 대신 `material.getClassName() === "PBRMaterial"` 사용.
- **createDefaultSkybox(envTexture, true, size) 사용 시 size를 차량 단위에 맞춰야 함** — size 인자는 mesh의 실제 박스 크기. 차량 AABB 계산 함수에서 반드시 필터링 필요. Phase 3a-2에서 size=1000(미터)으로 설정해 차량(7m)을 가리는 사고 발생.
- **scene.meshes 전체를 카메라 fit/clipping 계산에 그대로 넘기지 말 것** — 스카이박스(`hdrSkyBox`), 루트 헬퍼 노드(`__root__`), 반사 바닥(`ground`), bbSize 0인 mesh 모두 제외 필요.
- **차량 전환 진단 로그는 검증 후 즉시 제거, 커밋 금지** — 진단 로그가 logger retention 누적의 큰 기여자.
```

---

## 📍 2. "차량 GLB 단위" 섹션 신규 추가

"차량 구조 (GLB 분리 기준)" 섹션 위 또는 아래에 신규 추가:

```markdown
## 차량 GLB 단위 (확정)
- 단위: **미터(m)**
- porsche_911 가장 큰 부품(Object_140) bbSize = 7.0
- 평균 차량 diagonal: 7~10m
- 모든 거리 기반 계산(스카이박스 size, 카메라 minZ/maxZ, 조명 위치, 카메라 프리셋 거리)은 미터 가정
- Sketchfab 등 외부 GLB는 단위 다를 수 있음 — Phase 3a 검증용으로만 사용, 실제 GMTCK 차량 검증은 Phase 4 후
```

---

## 📍 3. "메모리 관리 규칙" 섹션 강화

기존 메모리 관리 규칙 아래에 다음 추가:

```markdown
### Phase 3a 학습 — dispose 패턴

**ownedResources 추적 vs 별도 ref 선택 기준:**
- 단순 `dispose()` 호출로 충분 → `ownedResourcesRef` (envTexture, ground, groundMat, pipeline)
- dispose 인자가 필요 → 별도 ref (skybox는 `dispose(false, true)` 필요 → `skyboxRef`)

**dispose 순서 (검증된 패턴):**
```typescript
// useScene.ts dispose 루틴
1. engine.stopRenderLoop()                          // 렌더 중지
2. ownedResourcesRef.current.forEach(r => r.dispose())  // envTexture, pipeline, ground, groundMat
3. ownedResourcesRef.current = []                   // 배열 리셋
4. skyboxRef.current?.dispose(false, true)          // 머티리얼+텍스처 동시 해제
5. skyboxRef.current = null
6. scene.environmentTexture = null                  // 참조 끊기
7. scene.dispose()
8. cameraRef.current = null
9. engine.getLoadedTexturesCache() 강제 정리
```

**검증된 사실 (Phase 3a-3 격리 테스트):**
- `DefaultRenderingPipeline`은 environmentTexture 직접 의존 없음 → ownedResources에 envTexture와 함께 push 안전
- `pipeline.dispose()`는 인자 없이 호출 가능
- `createDefaultSkybox`는 PBR 머티리얼 자동 생성 → 명시적 `dispose(false, true)` 필수
```

---

## 📍 4. "벤치마크 기록" 섹션에 append

```markdown
### Phase 3a 완료 (2026-04-12)

**개발 환경 (개인 데스크탑):**
- AMD Ryzen 9 7950X / RTX 3060 / 64GB / Win11 / Chrome WebGPU
- porsche_911 / exterior
- FPS: 120
- Meshes: 78, Materials: 17, Textures: 36, Vertices: 156,325
- Draw Calls: 75
- 초기 JS Heap: 116MB
- 10회 전환 + GC 후: 265MB (Delta +149MB)

**작업자 노트북 (참고):**
- Intel i7-13850HX / NVIDIA RTX 5000 Ada / 64GB / Win11 / Chrome WebGPU
- FPS: 60 (60Hz 모니터 cap)
- 초기 JS Heap: 110MB
- 10회 전환 + GC 후: 260MB (Delta +150MB)
- 누수 패턴 RTX 3060과 거의 일치 → JS 레벨 누수 확정 (GPU 무관)

**기준 기기 (Intel Iris Xe 일반 사무용 노트북):**
- ⏸ **검증 미완료** — 진짜 타겟 기기 확보 불가
- v1.0 출시 전 통합 테스트 단계로 이연

**기능 추가:**
- logarithmicDepth + 동적 near/far (AABB 기반)
- IBL (studio.env) + skybox (size=100m)
- mesh 필터링 (hdrSkyBox, __root__, ground 제외)
- 반사 바닥 (PBR 단색)
- ToneMapping ACES + FXAA

**커밋 히스토리:**
- 642f6a6 3a-1: logarithmicDepth + 동적 near/far
- fb5cc29 3a-2: IBL + 스카이박스 + AABB 필터
- 852ac23 3a-3: 반사 바닥 + 진단 로그/PBR 검증 제거
- 29b5599 3a-4: DefaultRenderingPipeline (ACES + FXAA)
```

---

## 📍 5. "측정 환경별 의미" 섹션 신규 추가

벤치마크 기록 섹션 바로 위에 신규 추가:

```markdown
## 측정 환경별 의미 (혼동 방지)
- **개인 데스크탑 (RTX 3060)**: 개발 환경 회귀 감지용. 절대 성능 측정 의미 없음.
- **작업자 노트북 (RTX 5000 Ada)**: 개발 환경 보조 측정. 진짜 타겟 아님 (워크스테이션급 GPU).
- **기준 기기 (Intel Iris Xe 일반 노트북)**: 진짜 타겟. CLAUDE.md 성능 목표(30fps 이상)의 검증 대상. **확보 어려움 → v1.0 출시 전 통합 테스트로 이연**.

성능 목표 30fps는 위 세 번째 환경 기준. 첫 두 환경에서 60+/120+ 나오는 건 참고치일 뿐 보장 아님.
```

---

## 📍 6. "실패 기록" 섹션에 append

```markdown
### Phase 3a-2 (2026-04-11)
- **스카이박스 AABB 오염**: createDefaultSkybox(size=1000) 호출 후 차량 안 보임. 원인: adjustCameraClipping과 fitCameraToScene이 hdrSkyBox mesh(bbSize=1732)를 AABB에 포함시켜 카메라 maxZ가 173205로 폭주, 카메라가 차량에서 2598m 떨어진 곳으로 배치됨. 해결: 인라인 mesh 필터(`hdrSkyBox`, `__root__`, BB size 0 제외) + skybox size 1000 → 100.
- **차량 단위 오해**: 디버깅 중 한때 차량을 밀리미터 단위로 추측했으나 실제는 미터. Object_140 bbSize=7.0 기준 확정.

### Phase 3a-3 (2026-04-11) — 5번 측정 디버깅 사이클
- **누수 폭증 +157MB**: 반사 바닥 추가 후 첫 측정 Snapshot B 279MB. 마지노선 226MB 크게 초과.
- **가설 1 (폐기)**: PBRMaterial import side-effect → 측정 X(PBR 검증 비활성, ground 유지)에서 208MB로 정상화. ground 무죄 확인.
- **가설 2 (폐기)**: getClassName() 우회 → 측정 Y에서 289MB로 오히려 악화. instanceof와 동일 결과.
- **가설 3 (확정)**: logger.info/warn dev console retention → 측정 Z(filter 호출 유지, logger 호출 비활성)에서 210MB로 정상화. logger가 진범 확정. (concatenated string) delta 비교: 측정 Y +51,932 vs 측정 Z +41,146 → -10,786.
- **교훈**: 진단 로그 5개(mesh별 출력 포함)가 logger retention 누적의 큰 기여자. 검증 후 즉시 제거 원칙 추가.
- **최종 해결**: PBR 검증 코드 완전 제거(Phase 4 진입 전 수동 1회 검증으로 이관) + 진단 로그 5개 일괄 제거.

### Phase 3a-4 (2026-04-12)
- 큰 사고 없이 통과. dispose 순서 검토 단계에서 pipeline → envTexture 의존성 grep으로 사전 확인.
- 결과적으로 3a-3 측정 변동성(±30MB)이 컸음을 확인 — 3a-4에서 누수 핵심 지표(WebGPUBindGroupCacheNode -62%, concatenated string -79%)가 오히려 개선됨.
```

---

## 📍 7. "Phase 현황" 섹션 업데이트

```markdown
## Phase 현황
- [x] Phase 1: GLB 압축 파이프라인 + FastAPI 파일 서버 ✅
- [x] Phase 2: 기본 뷰어 (React + Babylon.js + WebGPU + 차량 선택/전환) ✅
  - ⚠️ 메모리 누수 잔존 — Phase 4 진입 전 해결 필수
- [x] **Phase 3a 완료** (2026-04-12): IBL + PBR + 반사 바닥 + ToneMapping + FXAA ✅
- [ ] Phase 3b: 태양광 컨트롤 (Azimuth/Elevation/Intensity) + 실시간 그림자 + Bloom
- [ ] Phase 3c: 환경 프리셋 + 카메라 프리셋 + 사이드바 Accordion
- [ ] **Phase 4: 인터랙션 + v1.0 출시**
  - [ ] 메모리 누수 본진 해결 (logger retention 1순위)
  - [ ] 기준 기기(Intel Iris Xe) 통합 측정
- [ ] Phase 5: WebXR VR 연동 (선택적)
- [ ] Phase 6: 인증(SSO) + Cloud 이전 검토
```

---

## 📍 8. "Phase 4 사전 검토 항목" 섹션 신규 추가

Phase 현황 섹션 아래에 신규 추가:

```markdown
## Phase 4 사전 검토 항목 (Phase 3a 학습 누적)

진입 시 반드시 검토할 8가지:

1. **logger 호출 retention 누수 (1순위)**: dev console message buffer 누적 가설. Phase 3a-3 측정 Y vs Z에서 +79MB 차이 확인. 매 차량 전환마다 호출되는 logger.info/warn이 dispose되지 않음.
2. **이벤트 리스너 / 클로저 누수 점검 (2순위)**: window.addEventListener 해제 여부, 외부 변수 캡처 클로저 검토. Phase 3a 종료 시 미점검 영역.
3. **Babylon.js 9.2.0 → 최신 비교 (3순위)**: 버전 업그레이드로 Phase 2 누수 해결 가능성.
4. **Sample Vehicle dispose 경로**: 차량이 placeholder인 경우 일반 차량과 다른 dispose 경로 가능성.
5. **ArcRotateCamera lowerRadiusLimit**: 차량 내부 진입 불가. interior.glb 로드 UX 확정 후 결정. 옵션: UniversalCamera 전환 vs lowerRadiusLimit=0.
6. **비PBR 머티리얼 1개 (porsche_911)**: UE5 export 점검. Sketchfab GLB 특성 가능성.
7. **Heap 측정 변동성 ±30MB**: 동일 코드 반복 측정 시 변동 폭. 측정 신뢰도 향상 방법 검토.
8. **WebGL 2.0 모드 비교 (후순위)**: GPU 무관 누수 확인됨 (RTX 3060 vs RTX 5000 Ada 패턴 일치). 우선순위 낮춤.

### Sketchfab GLB 사용 시 주의 (검증 환경 한정)
- 단위 들쭉날쭉 (모델러별 차이)
- 머티리얼 비표준 (PBR 변환 누락 가능)
- 메시 이름 들쭉날쭉 (Phase 4 파츠 클릭 영향)
- 머티리얼 병합 안 됨 (50개 상한 위반 가능)
- **결론**: Sketchfab 차량은 Phase 3a/3b/3c 검증용으로만 사용. 실제 GMTCK 차량(UE5 → Datasmith) 검증은 Phase 4 후 v1.0 출시 전.
```

---

## 📍 9. "코드 작성 규칙" 섹션 강화 (Frontend)

Frontend 규칙에 추가:

```markdown
- **차량 전환 경로 logger 사용 제약** (Phase 3a-3 학습):
  - loadVehicle, dispose, scene 생성 흐름에서 호출되는 logger.info/warn은 1단계당 1~2개로 제한
  - 반복문 내부 logger.debug 절대 금지 (mesh 76개 × N회 = 즉시 retention 누적)
  - 진단 로그는 검증 직후 별도 커밋으로 제거 (커밋에 남기지 말 것)
  - 운영 로그는 1회당 정보 가치 명확히
- **Babylon.js Material 클래스 instanceof 사용 금지**: `material.getClassName() === "ClassName"` 사용
- **scene.meshes / scene.materials 전체 순회 시 필터 필수**: hdrSkyBox, __root__, ground, bbSize 0 등 비차량 mesh 제외 인라인 필터 적용
```

---

## 적용 방법

1. CLAUDE.md를 텍스트 에디터로 열기
2. 위 섹션별로 표시된 위치에 내용 추가/수정
3. 저장
4. 커밋:
```bash
git add CLAUDE.md
git commit -m "docs: CLAUDE.md Phase 3a 완료 반영

- 절대 금지 항목 5개 추가 (logger, instanceof, skybox size, mesh 필터, 진단 로그)
- 차량 GLB 단위 미터 확정 명시
- dispose 패턴 검증 결과 추가
- Phase 3a 벤치마크 기록 (RTX 3060 + RTX 5000 Ada)
- 측정 환경별 의미 명시 (기준 기기 v1.0 출시 전 이연)
- Phase 3a-2/3/4 실패 기록 (5번 측정 디버깅 사이클 포함)
- Phase 현황 3a 완료 체크
- Phase 4 사전 검토 항목 8개 정리
- Frontend 코드 규칙 강화 (logger 제약, instanceof 금지)"
```
