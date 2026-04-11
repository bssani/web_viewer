// Copyright (c) 2025 Philip Choi

/**
 * 차량 GLB 로딩 훅.
 * AbortController + generation 카운터로 레이스 컨디션 방지.
 * 빠른 차량 전환 시 마지막 선택만 반영.
 */

import { useCallback, useEffect, useRef, useState } from 'react'
import { ImportMeshAsync } from '@babylonjs/core/Loading/sceneLoader'
import { Vector3 } from '@babylonjs/core/Maths/math.vector'
import type { AbstractMesh } from '@babylonjs/core/Meshes/abstractMesh'
import type { ArcRotateCamera } from '@babylonjs/core/Cameras/arcRotateCamera'
import '@babylonjs/loaders/glTF'
import { fetchVehicleMetadata, getGlbUrl } from '../services/api'
import type { SceneManager } from './useScene'
import type { VehicleMetadata } from '../types/vehicle'
import type { Engine } from '@babylonjs/core/Engines/engine'
import type { WebGPUEngine } from '@babylonjs/core/Engines/webgpuEngine'
import { logger } from '../utils/logger'

/** 모델 바운딩 박스 기반으로 카메라 near/far 자동 설정 */
function adjustCameraClipping(camera: ArcRotateCamera, meshes: AbstractMesh[]) {
  // 스카이박스/루트노드/빈BB 제외
  const filtered = meshes.filter((m) => {
    if (m.name === 'hdrSkyBox' || m.name === '__root__' || m.name === 'ground') return false
    const bb = m.getBoundingInfo().boundingBox
    return Vector3.Distance(bb.minimumWorld, bb.maximumWorld) > 0
  })
  logger.debug(`[clipping] 전체 ${meshes.length}개 → 필터 후 ${filtered.length}개`)

  if (filtered.length === 0) {
    logger.warn('[clipping] 유효 mesh 없음, 기본값 유지')
    return
  }

  let min = new Vector3(Infinity, Infinity, Infinity)
  let max = new Vector3(-Infinity, -Infinity, -Infinity)

  for (const m of filtered) {
    const bb = m.getBoundingInfo().boundingBox
    min = Vector3.Minimize(min, bb.minimumWorld)
    max = Vector3.Maximize(max, bb.maximumWorld)
  }

  const diagonal = Vector3.Distance(min, max)
  camera.minZ = diagonal * 0.001
  camera.maxZ = diagonal * 100

  logger.debug(`[clipping] minZ=${camera.minZ.toFixed(3)} maxZ=${camera.maxZ.toFixed(1)}`)
}

export interface VehicleLoaderState {
  isLoading: boolean
  progress: number
  error: Error | null
  currentVehicleId: string | null
  currentZone: string | null
  metadata: VehicleMetadata | null
  loadVehicle: (vehicleId: string, zone?: string) => Promise<void>
  retry: () => void
  clearError: () => void
}

export function useVehicleLoader(
  engine: Engine | WebGPUEngine | null,
  sceneManager: SceneManager,
): VehicleLoaderState {
  const [isLoading, setIsLoading] = useState(false)
  const [progress, setProgress] = useState(0)
  const [error, setError] = useState<Error | null>(null)
  const [currentVehicleId, setCurrentVehicleId] = useState<string | null>(null)
  const [currentZone, setCurrentZone] = useState<string | null>(null)
  const [metadata, setMetadata] = useState<VehicleMetadata | null>(null)

  const abortRef = useRef<AbortController | null>(null)
  const loadGenerationRef = useRef(0)

  // 마지막 요청 파라미터 (재시도용)
  const lastRequestRef = useRef<{ vehicleId: string; zone: string } | null>(null)

  // 언마운트 시 진행 중인 요청 취소
  useEffect(() => {
    return () => {
      abortRef.current?.abort()
      abortRef.current = null
    }
  }, [])

  const loadVehicle = useCallback(
    async (vehicleId: string, zone: string = 'exterior') => {
      if (!engine) return

      // 이전 로딩 취소
      abortRef.current?.abort()
      abortRef.current = new AbortController()
      const signal = abortRef.current.signal
      const generation = ++loadGenerationRef.current

      lastRequestRef.current = { vehicleId, zone }
      setIsLoading(true)
      setProgress(0)
      setError(null)

      let newScene: ReturnType<typeof sceneManager.createScene> | null = null

      try {
        // 메타데이터 조회 (지수 백오프 재시도 내장)
        const meta = await fetchVehicleMetadata(vehicleId, { signal })
        if (signal.aborted || generation !== loadGenerationRef.current) return

        const zoneInfo = meta.zones[zone]
        if (!zoneInfo) {
          throw new Error(
            `구역 '${zone}'을 찾을 수 없습니다. 사용 가능: ${Object.keys(meta.zones).join(', ')}`,
          )
        }

        const glbUrl = getGlbUrl(vehicleId, zone, zoneInfo.file_hash)
        logger.info('[로딩 시작]', vehicleId, zone, glbUrl)

        // 기존 씬 dispose + 새 씬 생성
        newScene = sceneManager.createScene()

        // GLB 로드 (pluginExtension 명시 — URL에 확장자 없으므로 필수)
        await ImportMeshAsync(glbUrl, newScene, {
          pluginExtension: '.glb',
          onProgress: (event) => {
            if (signal.aborted) return
            if (event.total > 0) {
              setProgress((event.loaded / event.total) * 100)
            }
          },
        })

        // 늦게 도착한 결과 폐기
        if (signal.aborted || generation !== loadGenerationRef.current) {
          newScene.dispose()
          newScene = null
          return
        }

        // 씬 준비 완료 대기 (vertex 수 등 정확한 측정 보장)
        await new Promise<void>((resolve) => {
          newScene!.executeWhenReady(() => resolve())
        })

        // 카메라 자동 fit + 클리핑 조정
        sceneManager.fitCameraToScene(newScene)
        if (sceneManager.cameraRef.current) {
          adjustCameraClipping(sceneManager.cameraRef.current, newScene.meshes)
        }

        // 차량 최저점 계산 (반사 바닥 배치용)
        let vehicleMinY = 0
        for (const m of newScene.meshes) {
          if (m.name === 'hdrSkyBox' || m.name === '__root__' || m.name === 'ground') continue
          if (m.getTotalVertices() === 0) continue
          m.computeWorldMatrix(true)
          vehicleMinY = Math.min(vehicleMinY, m.getBoundingInfo().boundingBox.minimumWorld.y)
        }
        sceneManager.createGround(vehicleMinY)

        // 렌더 루프 시작 (중복 방지)
        if (!engine.activeRenderLoops.length) {
          engine.runRenderLoop(() => {
            sceneManager.sceneRef.current?.render()
          })
        }

        setCurrentVehicleId(vehicleId)
        setCurrentZone(zone)
        setMetadata(meta)
        setIsLoading(false)
        setProgress(100)

        logger.info('[로딩 완료]', vehicleId, zone, {
          meshes: newScene.meshes.length,
          materials: newScene.materials.length,
          textures: newScene.textures.length,
          vertices: newScene.getTotalVertices(),
        })

        // 로딩 성공 — newScene 소유권이 sceneRef로 이전됨
        newScene = null
      } catch (err) {
        if ((err as DOMException).name === 'AbortError') return
        if (generation !== loadGenerationRef.current) return

        logger.error('[로딩 실패]', vehicleId, zone, err)
        setError(err as Error)
        setIsLoading(false)
      } finally {
        // 로딩 실패/취소 시 방치된 빈 씬 즉시 정리
        if (newScene) {
          logger.warn('[로딩 실패 — 빈 씬 dispose]')
          newScene.dispose()
        }

        // AbortController 참조 해제
        if (abortRef.current?.signal === signal) {
          abortRef.current = null
        }
      }
    },
    [engine, sceneManager],
  )

  const retry = useCallback(() => {
    if (lastRequestRef.current) {
      loadVehicle(lastRequestRef.current.vehicleId, lastRequestRef.current.zone)
    }
  }, [loadVehicle])

  const clearError = useCallback(() => setError(null), [])

  return {
    isLoading,
    progress,
    error,
    currentVehicleId,
    currentZone,
    metadata,
    loadVehicle,
    retry,
    clearError,
  }
}
