// Copyright (c) 2025 Philip Choi

/**
 * Babylon.js 뷰어 래퍼.
 * canvas/engine은 EngineContext 소유 (앱 레벨 영속).
 * Viewer는 scene 생성/dispose 및 차량 로드/조명/애니메이션 UI만 담당.
 */

import { useEffect, useRef } from 'react'
import { useNavigate } from 'react-router-dom'
import { useEngineContext } from '../contexts/EngineContext'
import { useScene } from '../hooks/useScene'
import { useVehicleLoader } from '../hooks/useVehicleLoader'
import { useLightingControl } from '../hooks/useLightingControl'
import { usePartAnimations } from '../hooks/usePartAnimations'
import { LoadingBar } from './LoadingBar'
import { ErrorMessage } from './ErrorMessage'
import { DevPanel } from './DevPanel'
import { LeftPanel } from './LeftPanel'
import { RightPanel } from './RightPanel'

interface ViewerProps {
  selectedVehicleId: string | null
  isDevMode: boolean
}

export function Viewer({ selectedVehicleId, isDevMode }: ViewerProps) {
  const navigate = useNavigate()

  // canvas + engine은 EngineContext 소유 (앱 전체 수명)
  const { engine, rendererType, error: engineError } = useEngineContext()

  // 캔버스 활성 영역 placeholder (ResizeObserver 대상)
  const canvasAreaRef = useRef<HTMLDivElement | null>(null)

  const sceneManager = useScene(engine ?? null)
  const loader = useVehicleLoader(engine ?? null, sceneManager)
  const lighting = useLightingControl(sceneManager, loader.currentVehicleId)
  const anim = usePartAnimations(sceneManager.sceneRef.current, loader.currentVehicleId)

  // 차량 선택 변경 시 로드 (engine 준비 후)
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

  // Viewer 언마운트: 렌더 루프만 중지, engine은 EngineContext 소유라 dispose 금지
  // scene dispose는 useScene 훅 내부에서 처리
  useEffect(() => {
    return () => {
      engine?.stopRenderLoop()
    }
  }, [engine])

  // ResizeObserver — 캔버스 활성 영역(flex-1 div) 감시
  // canvas 자체는 fullscreen이라 브라우저 resize는 자동. 패널 토글 시 활성 영역 변화만 처리.
  useEffect(() => {
    const el = canvasAreaRef.current
    if (!el || !engine) return

    let rafId: number | null = null
    const observer = new ResizeObserver(() => {
      if (rafId !== null) return
      rafId = requestAnimationFrame(() => {
        engine.resize()
        rafId = null
      })
    })

    observer.observe(el)
    return () => {
      observer.disconnect()
      if (rafId !== null) cancelAnimationFrame(rafId)
    }
  }, [engine])

  return (
    // canvas(z:1 fixed) 위에 UI를 올리기 위해 stacking context 생성 + 투명 배경 (canvas 가림 방지).
    // pointer-events-none으로 root 자체는 hit-test에서 빠지고, 자식 aside/overlay가 각자 auto로 수신.
    <div className="relative z-20 flex h-full w-full pointer-events-none">
      {/* 좌측 고정 패널 */}
      <LeftPanel
        parts={anim.parts}
        onTogglePart={anim.togglePart}
        onBackToSelect={() => navigate('/vehicles')}
      />

      {/* 캔버스 활성 영역 — canvas는 EngineContext가 fullscreen으로 렌더. */}
      {/* placeholder는 pointer-events-none으로 canvas가 orbit/zoom 이벤트 수신하도록 통과. */}
      <div ref={canvasAreaRef} className="relative flex-1 min-w-0 overflow-hidden pointer-events-none">
        {!selectedVehicleId && !loader.isLoading && (
          <div className="absolute inset-0 flex items-center justify-center z-10 pointer-events-none">
            <p className="text-slate-500 text-sm">차량을 선택하세요</p>
          </div>
        )}

        {loader.isLoading && (
          <div className="pointer-events-auto">
            <LoadingBar progress={loader.progress} />
          </div>
        )}

        {loader.error && (
          <div className="pointer-events-auto">
            <ErrorMessage
              error={loader.error}
              onRetry={loader.retry}
              onDismiss={loader.clearError}
            />
          </div>
        )}

        {engineError && (
          <div className="pointer-events-auto">
            <ErrorMessage
              error={engineError}
              onRetry={() => window.location.reload()}
              onDismiss={() => {}}
            />
          </div>
        )}

        {isDevMode && (
          <div className="pointer-events-auto">
            <DevPanel
              engine={engine ?? null}
              scene={sceneManager.sceneRef.current}
              rendererType={rendererType ?? null}
              vehicleId={loader.currentVehicleId}
              metadata={loader.metadata}
            />
          </div>
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
