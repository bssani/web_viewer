// Copyright (c) 2025 Philip Choi

/**
 * Babylon.js 씬 관리 훅.
 * 차량 전환 시 scene.dispose()만 호출, engine.dispose() 금지.
 * Viewer 언마운트 시 disposeCurrentScene으로 고아 scene 차단 (engine 영속화 대응).
 */

import { useCallback, useEffect, useRef } from 'react'
import { Scene } from '@babylonjs/core/scene'
import { HemisphericLight } from '@babylonjs/core/Lights/hemisphericLight'
import { ArcRotateCamera } from '@babylonjs/core/Cameras/arcRotateCamera'
import { DirectionalLight } from '@babylonjs/core/Lights/directionalLight'
import { Vector3 } from '@babylonjs/core/Maths/math.vector'
import { CubeTexture } from '@babylonjs/core/Materials/Textures/cubeTexture'
import { MeshBuilder } from '@babylonjs/core/Meshes/meshBuilder'
import { PBRMaterial } from '@babylonjs/core/Materials/PBR/pbrMaterial'
import { Material } from '@babylonjs/core/Materials/material'
import { Color3 } from '@babylonjs/core/Maths/math.color'
import { ShadowGenerator } from '@babylonjs/core/Lights/Shadows/shadowGenerator'
import '@babylonjs/core/Lights/Shadows/shadowGeneratorSceneComponent'
import { DefaultRenderingPipeline } from '@babylonjs/core/PostProcesses/RenderPipeline/Pipelines/defaultRenderingPipeline'
import { ImageProcessingConfiguration } from '@babylonjs/core/Materials/imageProcessingConfiguration'
import '@babylonjs/core/Helpers/sceneHelpers'
import type { IDisposable } from '@babylonjs/core/scene'
import type { AbstractMesh } from '@babylonjs/core/Meshes/abstractMesh'
import type { Mesh } from '@babylonjs/core/Meshes/mesh'
import type { Engine } from '@babylonjs/core/Engines/engine'
import type { WebGPUEngine } from '@babylonjs/core/Engines/webgpuEngine'
import { logger } from '../utils/logger'

export interface SceneManager {
  /** 현재 씬 참조 */
  sceneRef: React.MutableRefObject<Scene | null>
  /** 현재 카메라 참조 */
  cameraRef: React.MutableRefObject<ArcRotateCamera | null>
  /** 현재 주광 참조 (3b-2 슬라이더 제어용) */
  sunRef: React.MutableRefObject<DirectionalLight | null>
  /** 현재 ShadowGenerator 참조 (3b-4) */
  shadowGeneratorRef: React.MutableRefObject<ShadowGenerator | null>
  /** 기존 씬 dispose 후 새 씬 생성 */
  createScene: () => Scene
  /** 카메라를 모델 바운딩 박스에 맞춤 */
  fitCameraToScene: (scene: Scene) => void
  /** 반사 바닥 생성 (차량 최저점 기준) */
  createGround: (minY: number) => void
  /** 차량 mesh를 shadow caster로 등록 (3b-4) */
  registerShadowCasters: (meshes: AbstractMesh[]) => void
  /** 그림자 ON/OFF 토글 (3b-4) */
  setShadowsEnabled: (enabled: boolean) => void
  /** sun.position을 차량 bounding box 기준 유동 배치 (3b-4) */
  updateSunPosition: () => void
  /** IBL 환경 교체 — null이면 환경 제거 (3c-5 IBL 토글 대체) */
  changeEnvironment: (envUrl: string | null) => Promise<void>
}

export function useScene(engine: Engine | WebGPUEngine | null): SceneManager {
  const sceneRef = useRef<Scene | null>(null)
  const cameraRef = useRef<ArcRotateCamera | null>(null)
  const sunRef = useRef<DirectionalLight | null>(null)
  const shadowGeneratorRef = useRef<ShadowGenerator | null>(null)
  const vehicleBoundsRef = useRef<{ center: Vector3; diagonal: number } | null>(null)
  const ownedResourcesRef = useRef<IDisposable[]>([])
  const skyboxRef = useRef<Mesh | null>(null)
  const pipelineRef = useRef<DefaultRenderingPipeline | null>(null)
  const envTextureRef = useRef<CubeTexture | null>(null)

  // 씬 + 수동 추적 리소스 공통 dispose. createScene(새 씬 직전) + unmount cleanup 양쪽에서 호출.
  // sceneRef.current가 null이면 no-op이므로 Strict Mode false cleanup에도 안전.
  const disposeCurrentScene = useCallback(() => {
    if (!sceneRef.current) return

    // 렌더 루프 중지 (dispose 중 렌더 방지)
    engine?.stopRenderLoop()

    // 수동 추적 리소스 명시적 해제 (envTexture 등)
    for (const res of ownedResourcesRef.current) {
      res.dispose()
    }
    ownedResourcesRef.current = []

    // 스카이박스 dispose (머티리얼+텍스처 포함)
    skyboxRef.current?.dispose(false, true)
    skyboxRef.current = null

    // env 텍스처 참조 끊기 (dispose 후 null — 재평가 트리거 방지)
    sceneRef.current.environmentTexture = null

    // 씬 완전 해제
    sceneRef.current.dispose()
    sceneRef.current = null
    cameraRef.current = null
    sunRef.current = null
    shadowGeneratorRef.current = null
    vehicleBoundsRef.current = null
    pipelineRef.current = null
    envTextureRef.current = null

    // 엔진 텍스처 캐시 강제 정리 (scene.dispose가 남기는 잔여 텍스처 제거)
    const cache = engine?.getLoadedTexturesCache()
    if (cache) {
      while (cache.length > 0) {
        cache.pop()?.dispose()
      }
    }
  }, [engine])

  const createScene = useCallback(() => {
    // 기존 씬 dispose (있으면)
    disposeCurrentScene()

    // 새 씬 생성
    const scene = new Scene(engine!)
    sceneRef.current = scene

    // 카메라 설정
    const camera = new ArcRotateCamera(
      'camera',
      Math.PI / 2,       // alpha
      Math.PI / 2.5,     // beta
      10,                 // radius (fitCameraToScene에서 재조정)
      Vector3.Zero(),
      scene,
    )
    camera.lowerRadiusLimit = 1
    camera.upperRadiusLimit = 200
    camera.wheelDeltaPercentage = 0.01
    camera.attachControl(true)
    cameraRef.current = camera

    // 앰비언트 (DirectionalLight 도입으로 약화)
    const ambient = new HemisphericLight('ambient', new Vector3(0, 1, 0), scene)
    ambient.intensity = 0.4

    // 주광 (3b-2 슬라이더 제어 예정)
    // position은 DirectionalLight 계산엔 무관(무한원점)이나 3b-4 ShadowGenerator frustum 기준점
    const sun = new DirectionalLight('sun', new Vector3(-0.5, -1, -0.5).normalize(), scene)
    sun.intensity = 2.0
    sun.position = new Vector3(5, 10, 5)
    sunRef.current = sun

    // ShadowGenerator 생성 (3b-4)
    const shadowGenerator = new ShadowGenerator(1024, sun)
    shadowGenerator.usePercentageCloserFiltering = true
    shadowGenerator.filteringQuality = ShadowGenerator.QUALITY_MEDIUM
    shadowGenerator.bias = 0.001
    shadowGenerator.normalBias = 0.02
    shadowGenerator.darkness = 0.3
    shadowGeneratorRef.current = shadowGenerator

    // GPU 텍스처(shadow map) dispose 보장
    ownedResourcesRef.current.push(shadowGenerator)

    // IBL 환경은 자동 로드하지 않음 — useLightingControl이 차량 로드 완료 후 적용
    // (자동 로드 시 PBR 머티리얼 컴파일 중 envTexture swap → WebGPU bind group 실패)
    scene.environmentIntensity = 1.0

    // 후처리 파이프라인 (ACES 톤매핑 + FXAA)
    const pipeline = new DefaultRenderingPipeline('default', true, scene, [camera])
    pipeline.imageProcessingEnabled = true
    pipeline.imageProcessing.toneMappingEnabled = true
    pipeline.imageProcessing.toneMappingType = ImageProcessingConfiguration.TONEMAPPING_ACES
    pipeline.fxaaEnabled = true

    pipeline.depthOfFieldEnabled = false
    pipeline.chromaticAberrationEnabled = false
    pipeline.grainEnabled = false
    pipeline.sharpenEnabled = false

    pipelineRef.current = pipeline

    // 수동 추적 리소스 등록 (pipeline만 — envTexture/skybox는 changeEnvironment가 관리)
    ownedResourcesRef.current.push(pipeline)

    logger.debug('[후처리] ACES 톤매핑 + FXAA 활성화')
    logger.debug('[조명] DirectionalLight intensity=2.0, ambient=0.4')

    return scene
  }, [engine, disposeCurrentScene])

  /** sun.position을 차량 bounding box 기준 유동 배치 */
  const updateSunPosition = useCallback(() => {
    const sun = sunRef.current
    const bounds = vehicleBoundsRef.current
    if (!sun || !bounds) return
    // sun.direction의 반대 방향으로 diagonal*1.5만큼 떨어진 위치 = 빛의 출발점
    const offset = bounds.diagonal * 1.5
    sun.position = bounds.center.subtract(sun.direction.scale(offset))
  }, [])

  /** 차량 mesh를 shadow caster로 등록 (renderList 방어 클리어 포함) */
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

  /** 그림자 ON/OFF (dispose 안 함 — refreshRate + darkness로 시각적 토글) */
  const setShadowsEnabled = useCallback((enabled: boolean) => {
    const sg = shadowGeneratorRef.current
    if (!sg) return
    const shadowMap = sg.getShadowMap()
    if (shadowMap) {
      shadowMap.refreshRate = enabled ? 1 : 0
    }
    sg.darkness = enabled ? 0.3 : 1.0
  }, [])

  /**
   * IBL 환경 교체 — WebGPU bind group 안전 순서.
   * 1) 새 텍스처 먼저 로드 → 2) scene 적용 + PBR 머티리얼 markAsDirty
   *   → 3) 이전 텍스처/스카이박스 dispose.
   * 역순으로 하면 "Destroyed texture used in a submit" 에러 발생.
   */
  const changeEnvironment = useCallback(async (envUrl: string | null) => {
    const scene = sceneRef.current
    if (!scene) return

    const prev = envTextureRef.current
    const prevSkybox = skyboxRef.current

    // 1. 새 텍스처 먼저 로드 (있는 경우)
    let newTex: CubeTexture | null = null
    if (envUrl) {
      newTex = CubeTexture.CreateFromPrefilteredData(envUrl, scene)
      await new Promise<void>((resolve) => {
        newTex!.onLoadObservable.addOnce(() => resolve())
      })
    }

    // 2. scene 적용 (null 또는 새 텍스처)
    scene.environmentTexture = newTex

    // 3. PBR 머티리얼 bind group 무효화 — 다음 프레임에 새 reflection sampler로 재바인드
    for (const mat of scene.materials) {
      const cls = mat.getClassName()
      if (cls === 'PBRMaterial' || cls === 'PBRMetallicRoughnessMaterial') {
        mat.markAsDirty(Material.TextureDirtyFlag)
      }
    }

    // 4. 이제 안전하게 이전 리소스 해제
    if (prevSkybox) {
      prevSkybox.dispose(false, true)
      skyboxRef.current = null
    }
    if (prev) {
      ownedResourcesRef.current = ownedResourcesRef.current.filter((r) => r !== prev)
      prev.dispose()
    }

    // 5. 새 envTexture 추적 + 스카이박스 재생성
    envTextureRef.current = newTex
    if (newTex) {
      ownedResourcesRef.current.push(newTex)
      const sky = scene.createDefaultSkybox(newTex, true, 100)
      skyboxRef.current = sky ?? null
    }
  }, [])

  const fitCameraToScene = useCallback((scene: Scene) => {
    const camera = cameraRef.current
    if (!camera) return

    // 스카이박스/루트노드/빈BB 제외한 유효 mesh만 사용
    const allMeshes = scene.meshes.filter((m) => m.getTotalVertices() > 0)
    const meshes = allMeshes.filter((m) => {
      if (m.name === 'hdrSkyBox' || m.name === '__root__' || m.name === 'ground') return false
      const bb = m.getBoundingInfo().boundingBox
      return Vector3.Distance(bb.minimumWorld, bb.maximumWorld) > 0
    })
    logger.debug(`[fitCamera] 전체 ${allMeshes.length}개 → 필터 후 ${meshes.length}개`)
    if (meshes.length === 0) return

    let min = new Vector3(Infinity, Infinity, Infinity)
    let max = new Vector3(-Infinity, -Infinity, -Infinity)

    for (const mesh of meshes) {
      mesh.computeWorldMatrix(true)
      const bounds = mesh.getBoundingInfo().boundingBox
      const worldMin = bounds.minimumWorld
      const worldMax = bounds.maximumWorld
      min = Vector3.Minimize(min, worldMin)
      max = Vector3.Maximize(max, worldMax)
    }

    const center = Vector3.Center(min, max)
    const diagonal = max.subtract(min).length()

    camera.target = center
    camera.radius = diagonal * 1.5
    camera.lowerRadiusLimit = diagonal * 0.1
    camera.upperRadiusLimit = diagonal * 5

    // vehicle bounds 저장 (updateSunPosition에서 재사용)
    vehicleBoundsRef.current = { center, diagonal }

    // 초기 sun.position 배치 + shadow frustum 크기
    const sun = sunRef.current
    if (sun) {
      updateSunPosition()
      sun.shadowMinZ = 0.1
      sun.shadowMaxZ = diagonal * 5
    }

    logger.info('[카메라 fit]', {
      center: center.toString(),
      diagonal: diagonal.toFixed(1),
      radius: camera.radius.toFixed(1),
    })
  }, [updateSunPosition])

  const createGround = useCallback((minY: number) => {
    const scene = sceneRef.current
    if (!scene) return

    // 반사 바닥 (PBR — IBL 환경 반사)
    const ground = MeshBuilder.CreateGround('ground', { width: 20, height: 20 }, scene)
    const groundMat = new PBRMaterial('groundMat', scene)
    groundMat.albedoColor = new Color3(0.1, 0.1, 0.1)
    groundMat.metallic = 0
    groundMat.roughness = 0.2
    ground.material = groundMat
    ground.position.y = minY - 0.01 // z-fighting 방지
    ground.receiveShadows = true

    // dispose 시 일괄 해제
    ownedResourcesRef.current.push(ground, groundMat)

    logger.debug(`[바닥] y=${ground.position.y.toFixed(3)}`)
  }, [])

  // Viewer 언마운트 시 scene + 수동 리소스 dispose (engine 영속화로 발생하는 고아 scene 차단).
  // sceneRef null 검사 덕에 Strict Mode false cleanup에서도 no-op.
  useEffect(() => {
    return () => {
      disposeCurrentScene()
    }
  }, [disposeCurrentScene])

  return {
    sceneRef, cameraRef, sunRef, shadowGeneratorRef,
    createScene, fitCameraToScene, createGround,
    registerShadowCasters, setShadowsEnabled, updateSunPosition,
    changeEnvironment,
  }
}
