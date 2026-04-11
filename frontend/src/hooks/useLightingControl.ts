// Copyright (c) 2025 Philip Choi

/**
 * 조명 제어 훅.
 * Azimuth/Elevation/Intensity 슬라이더 → DirectionalLight 실시간 반영.
 * 차량 전환 시 resync로 조명 상태 유지.
 */

import { useCallback, useState } from 'react'
import { Vector3 } from '@babylonjs/core/Maths/math.vector'
import type { SceneManager } from './useScene'

export interface LightingState {
  azimuth: number     // 0-360°
  elevation: number   // 0-90°
  intensity: number   // 0-5
}

export const DEFAULT_LIGHTING: LightingState = {
  azimuth: 225,
  elevation: 63,
  intensity: 2.0,
}

/** Azimuth(0=북=+Z)/Elevation(0=수평,90=정수리) → Babylon direction (빛 진행 방향) */
export function azElToDirection(azimuthDeg: number, elevationDeg: number): Vector3 {
  const azRad = (azimuthDeg * Math.PI) / 180
  const elRad = (elevationDeg * Math.PI) / 180
  const x = -Math.sin(azRad) * Math.cos(elRad)
  const y = -Math.sin(elRad)
  const z = -Math.cos(azRad) * Math.cos(elRad)
  return new Vector3(x, y, z).normalize()
}

export function useLightingControl(sceneManager: SceneManager) {
  const [state, setState] = useState<LightingState>(DEFAULT_LIGHTING)

  const setAzimuth = useCallback((azimuth: number) => {
    const sun = sceneManager.sunRef.current
    if (!sun) return
    setState((prev) => {
      const next = { ...prev, azimuth }
      sun.direction = azElToDirection(next.azimuth, next.elevation)
      return next
    })
  }, [sceneManager])

  const setElevation = useCallback((elevation: number) => {
    const sun = sceneManager.sunRef.current
    if (!sun) return
    setState((prev) => {
      const next = { ...prev, elevation }
      sun.direction = azElToDirection(next.azimuth, next.elevation)
      return next
    })
  }, [sceneManager])

  const setIntensity = useCallback((intensity: number) => {
    const sun = sceneManager.sunRef.current
    if (!sun) return
    sun.intensity = intensity
    setState((prev) => ({ ...prev, intensity }))
  }, [sceneManager])

  /** 차량 전환 후 재동기화. Viewer.tsx의 useEffect에서 호출. */
  const resync = useCallback(() => {
    const sun = sceneManager.sunRef.current
    if (!sun) return
    sun.direction = azElToDirection(state.azimuth, state.elevation)
    sun.intensity = state.intensity
  }, [sceneManager, state])

  return { state, setAzimuth, setElevation, setIntensity, resync }
}
