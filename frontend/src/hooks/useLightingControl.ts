// Copyright (c) 2025 Philip Choi

/**
 * 조명 제어 훅.
 * Azimuth/Elevation/Intensity 슬라이더 → DirectionalLight 실시간 반영.
 * 차량 전환 시 resync로 조명 상태 유지.
 */

import { useCallback, useEffect, useState } from 'react'
import { Vector3 } from '@babylonjs/core/Maths/math.vector'
import type { SceneManager } from './useScene'
import { fetchEnvironments, type EnvironmentItem } from '../services/api'
import { logger } from '../utils/logger'
import { loadEnvironmentChoice, saveEnvironmentChoice } from '../utils/preferences'

const DEFAULT_ENV_ID = 'studio'

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

export type PresetId = 'morning' | 'noon' | 'evening' | 'night' | 'studio'

export interface LightingPreset {
  id: PresetId
  label: string
  azimuth: number
  elevation: number
  intensity: number
}

export const LIGHTING_PRESETS: LightingPreset[] = [
  { id: 'morning',  label: '아침',     azimuth: 90,  elevation: 25, intensity: 1.5 },
  { id: 'noon',     label: '정오',     azimuth: 180, elevation: 80, intensity: 3.0 },
  { id: 'evening',  label: '저녁',     azimuth: 270, elevation: 20, intensity: 1.8 },
  { id: 'night',    label: '밤',       azimuth: 0,   elevation: 60, intensity: 0.4 },
  { id: 'studio',   label: '스튜디오', azimuth: 135, elevation: 45, intensity: 4.0 },
]

/** Azimuth(0=북=+Z)/Elevation(0=수평,90=정수리) → Babylon direction (빛 진행 방향) */
export function azElToDirection(azimuthDeg: number, elevationDeg: number): Vector3 {
  const azRad = (azimuthDeg * Math.PI) / 180
  const elRad = (elevationDeg * Math.PI) / 180
  const x = -Math.sin(azRad) * Math.cos(elRad)
  const y = -Math.sin(elRad)
  const z = -Math.cos(azRad) * Math.cos(elRad)
  return new Vector3(x, y, z).normalize()
}

export function useLightingControl(sceneManager: SceneManager, currentVehicleId: string | null) {
  const [state, setState] = useState<LightingState>(DEFAULT_LIGHTING)
  const [activePreset, setActivePreset] = useState<PresetId | null>(null)
  const [shadowsEnabled, setShadowsEnabledState] = useState<boolean>(true)
  const [environments, setEnvironments] = useState<EnvironmentItem[]>([])
  // 저장된 선택 읽기: undefined(저장 없음) → 'studio' 기본값
  const [currentEnvId, setCurrentEnvId] = useState<string | null>(() => {
    const saved = loadEnvironmentChoice()
    return saved === undefined ? DEFAULT_ENV_ID : saved
  })

  // 환경 목록만 먼저 fetch + 저장값 검증 (적용은 별도 useEffect에서)
  useEffect(() => {
    fetchEnvironments()
      .then((envs) => {
        setEnvironments(envs)

        // 저장된 envId가 서버 목록에 없으면 기본값으로 fallback
        if (currentEnvId !== null && !envs.some((e) => e.id === currentEnvId)) {
          logger.warn('[환경] 저장된 선택 서버에 없음 → studio fallback:', currentEnvId)
          setCurrentEnvId(DEFAULT_ENV_ID)
          saveEnvironmentChoice(DEFAULT_ENV_ID)
        }
      })
      .catch((err) => logger.error('[환경 목록 실패]', err))
    // 최초 마운트 1회만
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // 차량 로드 완료 + 환경 목록 준비 완료 시점에 환경 적용.
  // PBR 머티리얼이 환경 없이 1회 컴파일된 후 환경을 추가 → WebGPU bind group 충돌 회피.
  // deps에서 currentEnvId 제외 — 사용자 토글은 changeEnvironment 콜백이 직접 처리.
  useEffect(() => {
    if (!currentVehicleId) return
    if (environments.length === 0) return

    requestAnimationFrame(() => {
      if (currentEnvId === null) {
        void sceneManager.changeEnvironment(null)
        return
      }
      const env = environments.find((e) => e.id === currentEnvId)
      if (env) void sceneManager.changeEnvironment(env.url)
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentVehicleId, environments])

  const setAzimuth = useCallback((azimuth: number) => {
    const sun = sceneManager.sunRef.current
    if (!sun) return
    setActivePreset(null)
    setState((prev) => {
      const next = { ...prev, azimuth }
      sun.direction = azElToDirection(next.azimuth, next.elevation)
      sceneManager.updateSunPosition()
      return next
    })
  }, [sceneManager])

  const setElevation = useCallback((elevation: number) => {
    const sun = sceneManager.sunRef.current
    if (!sun) return
    setActivePreset(null)
    setState((prev) => {
      const next = { ...prev, elevation }
      sun.direction = azElToDirection(next.azimuth, next.elevation)
      sceneManager.updateSunPosition()
      return next
    })
  }, [sceneManager])

  const setIntensity = useCallback((intensity: number) => {
    const sun = sceneManager.sunRef.current
    if (!sun) return
    setActivePreset(null)
    sun.intensity = intensity
    setState((prev) => ({ ...prev, intensity }))
  }, [sceneManager])

  const applyPreset = useCallback((preset: LightingPreset) => {
    const sun = sceneManager.sunRef.current
    if (!sun) return
    const next: LightingState = {
      azimuth: preset.azimuth,
      elevation: preset.elevation,
      intensity: preset.intensity,
    }
    sun.direction = azElToDirection(next.azimuth, next.elevation)
    sun.intensity = next.intensity
    sceneManager.updateSunPosition()
    setState(next)
    setActivePreset(preset.id)
  }, [sceneManager])

  const setShadowsEnabled = useCallback((enabled: boolean) => {
    sceneManager.setShadowsEnabled(enabled)
    setShadowsEnabledState(enabled)
  }, [sceneManager])

  const changeEnvironment = useCallback(async (envId: string | null) => {
    if (envId === null) {
      await sceneManager.changeEnvironment(null)
      setCurrentEnvId(null)
      saveEnvironmentChoice(null)
      return
    }
    const env = environments.find((e) => e.id === envId)
    if (!env) return
    await sceneManager.changeEnvironment(env.url)
    setCurrentEnvId(envId)
    saveEnvironmentChoice(envId)
  }, [environments, sceneManager])

  /** 차량 전환 후 조명 재동기화 (환경은 별도 useEffect가 처리). */
  const resync = useCallback(() => {
    const sun = sceneManager.sunRef.current
    if (!sun) return
    sun.direction = azElToDirection(state.azimuth, state.elevation)
    sun.intensity = state.intensity
    sceneManager.updateSunPosition()
    sceneManager.setShadowsEnabled(shadowsEnabled)
  }, [sceneManager, state, shadowsEnabled])

  return {
    state, activePreset, shadowsEnabled, environments, currentEnvId,
    setAzimuth, setElevation, setIntensity,
    setShadowsEnabled, changeEnvironment, applyPreset, resync,
  }
}
