// Copyright (c) 2025 Philip Choi

/**
 * Babylon.js 캔버스 래퍼.
 * ResizeObserver + requestAnimationFrame 디바운싱으로 리사이즈 처리.
 * 로딩/에러 오버레이는 캔버스 위에 표시.
 */

import { useCallback, useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useEngine, resetEngine } from '../hooks/useEngine'
import { useScene } from '../hooks/useScene'
import { useVehicleLoader } from '../hooks/useVehicleLoader'
import { useLightingControl } from '../hooks/useLightingControl'
import { usePartAnimations } from '../hooks/usePartAnimations'
import { LoadingBar } from './LoadingBar'
import { ErrorMessage } from './ErrorMessage'
import { DevPanel } from './DevPanel'
import { LeftPanel } from './LeftPanel'
import { RightPanel } from './RightPanel'
import { logger } from '../utils/logger'

interface ViewerProps {
  selectedVehicleId: string | null
  isDevMode: boolean
}

export function Viewer({ selectedVehicleId, isDevMode }: ViewerProps) {
  const navigate = useNavigate()
  const [canvas, setCanvas] = useState<HTMLCanvasElement | null>(null)
  const canvasRef = useCallback((el: HTMLCanvasElement | null) => {
    setCanvas(el)
  }, [])

  const { engine, rendererType, error: engineError } = useEngine(canvas)
  const sceneManager = useScene(engine ?? null)
  const loader = useVehicleLoader(engine ?? null, sceneManager)
  const lighting = useLightingControl(sceneManager, loader.currentVehicleId)
  const anim = usePartAnimations(sceneManager.sceneRef.current, loader.currentVehicleId)

  // 차량 선택 변경 시 로드 (engine 준비 후에만 prevRef 갱신)
  const prevVehicleRef = useRef<string | null>(null)
  useEffect(() => {
    if (!engine) return
    if (selectedVehicleId && selectedVehicleId !== prevVehicleRef.current) {
      prevVehicleRef.current = selectedVehicleId
      loader.loadVehicle(selectedVehicleId)
    }
  }, [selectedVehicleId, loader.loadVehicle, engine])

  // 차량 전환 후 조명 재동기화
  useEffect(() => {
    if (loader.currentVehicleId) {
      lighting.resync()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loader.currentVehicleId])

  // dev 모드: scene을 콘솔에서 접근 가능하도록 노출
  useEffect(() => {
    if (!isDevMode) return
    ;(window as any).__SCENE__ = sceneManager.sceneRef.current
    return () => { (window as any).__SCENE__ = null }
  }, [isDevMode, sceneManager.sceneRef.current])

  // unmount 시 engine + scene 정리 (페이지 이탈 대비)
  // 라우팅으로 canvas DOM이 제거되므로 engine 싱글톤도 리셋 필요
  useEffect(() => {
    return () => {
      logger.info('[scene disposed]')
      resetEngine()
    }
  }, [])

  // ResizeObserver + rAF 디바운싱
  useEffect(() => {
    const parent = canvas?.parentElement
    if (!parent || !engine) return

    let rafId: number | null = null
    const observer = new ResizeObserver(() => {
      if (rafId !== null) return
      rafId = requestAnimationFrame(() => {
        engine.resize()
        rafId = null
      })
    })

    observer.observe(parent)
    return () => {
      observer.disconnect()
      if (rafId !== null) cancelAnimationFrame(rafId)
    }
  }, [engine, canvas])

  return (
    <div className="flex h-full w-full bg-slate-900">
      {/* 좌측 고정 패널 */}
      <LeftPanel
        parts={anim.parts}
        onTogglePart={anim.togglePart}
        onBackToSelect={() => navigate('/vehicles')}
      />

      {/* 캔버스 영역 — min-w-0 필수 (flex item 기본 min-width: auto가 캔버스를 밀어냄) */}
      <div className="relative flex-1 min-w-0 overflow-hidden">
        <canvas
          ref={canvasRef}
          className="w-full h-full block outline-none"
          touch-action="none"
        />

        {!selectedVehicleId && !loader.isLoading && (
          <div className="absolute inset-0 flex items-center justify-center z-10 pointer-events-none">
            <p className="text-slate-500 text-sm">차량을 선택하세요</p>
          </div>
        )}

        {loader.isLoading && <LoadingBar progress={loader.progress} />}

        {loader.error && (
          <ErrorMessage
            error={loader.error}
            onRetry={loader.retry}
            onDismiss={loader.clearError}
          />
        )}

        {engineError && (
          <ErrorMessage
            error={engineError}
            onRetry={() => window.location.reload()}
            onDismiss={() => {}}
          />
        )}

        {isDevMode && (
          <DevPanel
            engine={engine ?? null}
            scene={sceneManager.sceneRef.current}
            rendererType={rendererType ?? null}
            vehicleId={loader.currentVehicleId}
            metadata={loader.metadata}
          />
        )}
      </div>

      {/* 우측 고정 패널 (접기/펼치기) */}
      <RightPanel
        azimuth={lighting.state.azimuth}
        elevation={lighting.state.elevation}
        intensity={lighting.state.intensity}
        activePreset={lighting.activePreset}
        onAzimuthChange={lighting.setAzimuth}
        onElevationChange={lighting.setElevation}
        onIntensityChange={lighting.setIntensity}
        onPresetSelect={lighting.applyPreset}
        shadowsEnabled={lighting.shadowsEnabled}
        onShadowsToggle={lighting.setShadowsEnabled}
        environments={lighting.environments}
        currentEnvId={lighting.currentEnvId}
        onChangeEnvironment={lighting.changeEnvironment}
      />
    </div>
  )
}
