// Copyright (c) 2025 Philip Choi

/**
 * 차량 GLB 로딩 훅.
 * AbortController + generation 카운터로 레이스 컨디션 방지.
 * 빠른 차량 전환 시 마지막 선택만 반영.
 */

import { useCallback, useEffect, useRef, useState } from 'react'
import { ImportMeshAsync } from '@babylonjs/core/Loading/sceneLoader'
import '@babylonjs/loaders/glTF'
import { fetchVehicleMetadata, getGlbUrl } from '../services/api'
import type { SceneManager } from './useScene'
import type { VehicleMetadata } from '../types/vehicle'
import type { Engine } from '@babylonjs/core/Engines/engine'
import type { WebGPUEngine } from '@babylonjs/core/Engines/webgpuEngine'
import { logger } from '../utils/logger'

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

        // 카메라 자동 fit
        sceneManager.fitCameraToScene(newScene)

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
