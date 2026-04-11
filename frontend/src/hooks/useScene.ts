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
import { Vector3 } from '@babylonjs/core/Maths/math.vector'
import type { Engine } from '@babylonjs/core/Engines/engine'
import type { WebGPUEngine } from '@babylonjs/core/Engines/webgpuEngine'
import { logger } from '../utils/logger'

export interface SceneManager {
  /** 현재 씬 참조 */
  sceneRef: React.MutableRefObject<Scene | null>
  /** 현재 카메라 참조 */
  cameraRef: React.MutableRefObject<ArcRotateCamera | null>
  /** 기존 씬 dispose 후 새 씬 생성 */
  createScene: () => Scene
  /** 카메라를 모델 바운딩 박스에 맞춤 */
  fitCameraToScene: (scene: Scene) => void
}

export function useScene(engine: Engine | WebGPUEngine | null): SceneManager {
  const sceneRef = useRef<Scene | null>(null)
  const cameraRef = useRef<ArcRotateCamera | null>(null)

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

      // 씬 완전 해제
      sceneRef.current.dispose()
      sceneRef.current = null
      cameraRef.current = null

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

    // 기본 조명
    const light = new HemisphericLight('light', new Vector3(0, 1, 0), scene)
    light.intensity = 1.0

    return scene
  }, [engine])

  const fitCameraToScene = useCallback((scene: Scene) => {
    const camera = cameraRef.current
    if (!camera) return

    // 전체 바운딩 박스 계산
    const meshes = scene.meshes.filter((m) => m.getTotalVertices() > 0)
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

  return { sceneRef, cameraRef, createScene, fitCameraToScene }
}
