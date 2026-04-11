// Copyright (c) 2025 Philip Choi

/**
 * Babylon.js 씬 관리 훅.
 * 차량 전환 시 scene.dispose()만 호출, engine.dispose() 금지.
 * dispose 전후 메모리 계측 로그 출력.
 */

import { useCallback, useRef } from 'react'
import { Scene } from '@babylonjs/core/scene'
import { HemisphericLight } from '@babylonjs/core/Lights/hemisphericLight'
import { ArcRotateCamera } from '@babylonjs/core/Cameras/arcRotateCamera'
import { DirectionalLight } from '@babylonjs/core/Lights/directionalLight'
import { Vector3 } from '@babylonjs/core/Maths/math.vector'
import { CubeTexture } from '@babylonjs/core/Materials/Textures/cubeTexture'
import { MeshBuilder } from '@babylonjs/core/Meshes/meshBuilder'
import { PBRMaterial } from '@babylonjs/core/Materials/PBR/pbrMaterial'
import { Color3 } from '@babylonjs/core/Maths/math.color'
import { DefaultRenderingPipeline } from '@babylonjs/core/PostProcesses/RenderPipeline/Pipelines/defaultRenderingPipeline'
import { ImageProcessingConfiguration } from '@babylonjs/core/Materials/imageProcessingConfiguration'
import '@babylonjs/core/Helpers/sceneHelpers'
import type { IDisposable } from '@babylonjs/core/scene'
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
  /** 기존 씬 dispose 후 새 씬 생성 */
  createScene: () => Scene
  /** 카메라를 모델 바운딩 박스에 맞춤 */
  fitCameraToScene: (scene: Scene) => void
  /** 반사 바닥 생성 (차량 최저점 기준) */
  createGround: (minY: number) => void
}

export function useScene(engine: Engine | WebGPUEngine | null): SceneManager {
  const sceneRef = useRef<Scene | null>(null)
  const cameraRef = useRef<ArcRotateCamera | null>(null)
  const sunRef = useRef<DirectionalLight | null>(null)
  const ownedResourcesRef = useRef<IDisposable[]>([])
  const skyboxRef = useRef<Mesh | null>(null)

  const createScene = useCallback(() => {
    // 기존 씬 dispose (메모리 계측)
    if (sceneRef.current) {
      const before = {
        meshes: sceneRef.current.meshes.length,
        materials: sceneRef.current.materials.length,
        textures: sceneRef.current.textures.length,
        cachedTextures: engine?.getLoadedTexturesCache().length ?? 0,
      }

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

      // 엔진 텍스처 캐시 강제 정리 (scene.dispose가 남기는 잔여 텍스처 제거)
      const cache = engine?.getLoadedTexturesCache()
      if (cache) {
        while (cache.length > 0) {
          cache.pop()?.dispose()
        }
      }

      logger.info('[dispose 검증]', before, '→', {
        cachedTextures: engine?.getLoadedTexturesCache().length ?? 0,
      })
    }

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

    // IBL 환경 텍스처 (PBR 반사용)
    const envTexture = CubeTexture.CreateFromPrefilteredData(
      `${import.meta.env.BASE_URL}env/studio.env`,
      scene,
    )
    scene.environmentTexture = envTexture
    scene.environmentIntensity = 1.0

    // 스카이박스 (환경 배경)
    const skybox = scene.createDefaultSkybox(envTexture, true, 100)

    // 후처리 파이프라인 (ACES 톤매핑 + FXAA)
    const pipeline = new DefaultRenderingPipeline('default', true, scene, [camera])
    pipeline.imageProcessingEnabled = true
    pipeline.imageProcessing.toneMappingEnabled = true
    pipeline.imageProcessing.toneMappingType = ImageProcessingConfiguration.TONEMAPPING_ACES
    pipeline.fxaaEnabled = true
    // Phase 3b에서 활성화 예정
    pipeline.bloomEnabled = false
    pipeline.depthOfFieldEnabled = false
    pipeline.chromaticAberrationEnabled = false
    pipeline.grainEnabled = false
    pipeline.sharpenEnabled = false

    // 수동 추적 리소스 등록 (dispose 시 명시적 해제)
    ownedResourcesRef.current.push(envTexture, pipeline)
    skyboxRef.current = skybox ?? null

    logger.debug('[후처리] ACES 톤매핑 + FXAA 활성화')
    logger.debug('[조명] DirectionalLight intensity=2.0, ambient=0.4')

    return scene
  }, [engine])

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

    logger.info('[카메라 fit]', {
      center: center.toString(),
      diagonal: diagonal.toFixed(1),
      radius: camera.radius.toFixed(1),
    })
  }, [])

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

    // dispose 시 일괄 해제
    ownedResourcesRef.current.push(ground, groundMat)

    logger.debug(`[바닥] y=${ground.position.y.toFixed(3)}`)
  }, [])

  return { sceneRef, cameraRef, sunRef, createScene, fitCameraToScene, createGround }
}
