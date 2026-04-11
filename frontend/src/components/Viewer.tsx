// Copyright (c) 2025 Philip Choi

/**
 * Babylon.js 캔버스 래퍼.
 * ResizeObserver + requestAnimationFrame 디바운싱으로 리사이즈 처리.
 * 로딩/에러 오버레이는 캔버스 위에 표시.
 */

import { useCallback, useEffect, useRef, useState } from 'react'
import { useEngine } from '../hooks/useEngine'
import { useScene } from '../hooks/useScene'
import { useVehicleLoader } from '../hooks/useVehicleLoader'
import { useLightingControl } from '../hooks/useLightingControl'
import { LoadingBar } from './LoadingBar'
import { ErrorMessage } from './ErrorMessage'
import { DevPanel } from './DevPanel'
import { LightingPanel } from './LightingPanel'

interface ViewerProps {
  selectedVehicleId: string | null
  isDevMode: boolean
}

export function Viewer({ selectedVehicleId, isDevMode }: ViewerProps) {
  const [canvas, setCanvas] = useState<HTMLCanvasElement | null>(null)
  const canvasRef = useCallback((el: HTMLCanvasElement | null) => {
    setCanvas(el)
  }, [])

  const { engine, rendererType, error: engineError } = useEngine(canvas)
  const sceneManager = useScene(engine ?? null)
  const loader = useVehicleLoader(engine ?? null, sceneManager)
  const lighting = useLightingControl(sceneManager)

  // 차량 선택 변경 시 로드
  const prevVehicleRef = useRef<string | null>(null)
  useEffect(() => {
    if (selectedVehicleId && selectedVehicleId !== prevVehicleRef.current) {
      prevVehicleRef.current = selectedVehicleId
      loader.loadVehicle(selectedVehicleId)
    }
  }, [selectedVehicleId, loader.loadVehicle])

  // 차량 전환 후 조명 재동기화
  useEffect(() => {
    if (loader.currentVehicleId) {
      lighting.resync()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loader.currentVehicleId])

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
    <div className="relative flex-1 bg-slate-900 overflow-hidden">
      <canvas
        ref={canvasRef}
        className="w-full h-full block outline-none"
        touch-action="none"
      />

      {/* 초기 안내 (차량 미선택) */}
      {!selectedVehicleId && !loader.isLoading && (
        <div className="absolute inset-0 flex items-center justify-center z-10 pointer-events-none">
          <p className="text-slate-500 text-sm">
            좌측에서 차량을 선택하세요
          </p>
        </div>
      )}

      {/* 로딩 오버레이 (캔버스 완전 차단) */}
      {loader.isLoading && <LoadingBar progress={loader.progress} />}

      {/* 에러 오버레이 */}
      {loader.error && (
        <ErrorMessage
          error={loader.error}
          onRetry={loader.retry}
          onDismiss={loader.clearError}
        />
      )}

      {/* 엔진 초기화 에러 */}
      {engineError && (
        <ErrorMessage
          error={engineError}
          onRetry={() => window.location.reload()}
          onDismiss={() => {}}
        />
      )}

      {/* 조명 제어 패널 */}
      <LightingPanel
        azimuth={lighting.state.azimuth}
        elevation={lighting.state.elevation}
        intensity={lighting.state.intensity}
        onAzimuthChange={lighting.setAzimuth}
        onElevationChange={lighting.setElevation}
        onIntensityChange={lighting.setIntensity}
      />

      {/* 개발자 모드 패널 */}
      {isDevMode && (
        <DevPanel
          engine={engine ?? null}
          scene={sceneManager.sceneRef.current}
          rendererType={rendererType ?? null}
          vehicleId={loader.currentVehicleId}
          zone={loader.currentZone}
          metadata={loader.metadata}
        />
      )}
    </div>
  )
}
