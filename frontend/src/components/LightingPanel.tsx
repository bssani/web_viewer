// Copyright (c) 2025 Philip Choi

/**
 * 조명 제어 패널.
 * Azimuth/Elevation/Intensity 슬라이더.
 * Phase 3c Accordion 슬롯 형태.
 */

import type { LightingPreset, PresetId } from '../hooks/useLightingControl'
import { LIGHTING_PRESETS } from '../hooks/useLightingControl'
import type { EnvironmentItem } from '../services/api'
import styles from './LightingPanel.module.css'

export interface LightingPanelProps {
  azimuth: number
  elevation: number
  intensity: number
  activePreset: PresetId | null
  onAzimuthChange: (value: number) => void
  onElevationChange: (value: number) => void
  onIntensityChange: (value: number) => void
  onPresetSelect: (preset: LightingPreset) => void
  shadowsEnabled: boolean
  onShadowsToggle: (enabled: boolean) => void
  environments: EnvironmentItem[]
  currentEnvId: string | null
  onChangeEnvironment: (envId: string | null) => void
}

export function LightingPanel({
  azimuth, elevation, intensity, activePreset,
  onAzimuthChange, onElevationChange, onIntensityChange, onPresetSelect,
  shadowsEnabled, onShadowsToggle,
  environments, currentEnvId, onChangeEnvironment,
}: LightingPanelProps) {
  return (
    <div className={styles.panel}>
      <h3 className={styles.title}>조명</h3>

      {/* 프리셋 (슬라이더 위) */}
      <div className={styles.presets}>
        {LIGHTING_PRESETS.map((preset) => (
          <button
            key={preset.id}
            type="button"
            className={`${styles.presetBtn} ${activePreset === preset.id ? styles.presetBtnActive : ''}`}
            onClick={() => onPresetSelect(preset)}
          >
            {preset.label}
          </button>
        ))}
      </div>

      <div className={styles.row}>
        <label className={styles.label}>
          <span>방위각 (Azimuth)</span>
          <span className={styles.value}>{azimuth.toFixed(0)}&deg;</span>
        </label>
        <input type="range" min={0} max={360} step={1} value={azimuth}
          onChange={(e) => onAzimuthChange(Number(e.target.value))}
          className={styles.slider} />
      </div>

      <div className={styles.row}>
        <label className={styles.label}>
          <span>고도 (Elevation)</span>
          <span className={styles.value}>{elevation.toFixed(0)}&deg;</span>
        </label>
        <input type="range" min={0} max={90} step={1} value={elevation}
          onChange={(e) => onElevationChange(Number(e.target.value))}
          className={styles.slider} />
      </div>

      <div className={styles.row}>
        <label className={styles.label}>
          <span>강도 (Intensity)</span>
          <span className={styles.value}>{intensity.toFixed(1)}</span>
        </label>
        <input type="range" min={0} max={5} step={0.1} value={intensity}
          onChange={(e) => onIntensityChange(Number(e.target.value))}
          className={styles.slider} />
      </div>

      {/* 그림자 토글 (3b-4) */}
      <div className={styles.toggleRow}>
        <label className={styles.toggleLabel}>
          <input
            type="checkbox"
            checked={shadowsEnabled}
            onChange={(e) => onShadowsToggle(e.target.checked)}
            className={styles.checkbox}
          />
          <span>그림자</span>
        </label>
      </div>

      {/* 환경 드롭다운 (IBL 토글 대체) */}
      <div className={styles.row}>
        <label className={styles.label}>
          <span>환경</span>
        </label>
        <select
          value={currentEnvId ?? ''}
          onChange={(e) => onChangeEnvironment(e.target.value || null)}
          className={styles.select}
        >
          <option value="">없음</option>
          {environments.map((env) => (
            <option key={env.id} value={env.id}>{env.name}</option>
          ))}
        </select>
      </div>
    </div>
  )
}
