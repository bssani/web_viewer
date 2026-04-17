// Copyright (c) 2025 Philip Choi

/**
 * EngineContext — App 레벨 canvas/engine 영속화 컨테이너.
 *
 * canvas는 전체화면 fixed로 항상 DOM에 존재.
 * Viewer 경로(/vehicles/:id/viewer) 진입 시 visibility:visible + pointer-events:auto.
 * 다른 경로에선 visibility:hidden + pointer-events:none + 낮은 z-index로 숨김.
 *
 * engine은 첫 Viewer 진입 시 lazy 초기화.
 * 한 번 만들어진 engine은 세션 내 영속 (beforeunload 시에만 dispose).
 * Viewer는 scene만 dispose하고 engine은 건드리지 않음.
 */

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react'
import { useLocation } from 'react-router-dom'
import type { Engine } from '@babylonjs/core/Engines/engine'
import type { WebGPUEngine } from '@babylonjs/core/Engines/webgpuEngine'
import type { RendererType } from '../types/vehicle'
import { initializeEngine } from '../hooks/useEngine'
import { logger } from '../utils/logger'

interface EngineContextValue {
  engine: Engine | WebGPUEngine | null
  rendererType: RendererType | null
  canvas: HTMLCanvasElement | null
  error: Error | null
}

const EngineContext = createContext<EngineContextValue | null>(null)

// Viewer 경로 매칭: /vehicles/{id}/viewer
const VIEWER_PATH_PATTERN = /^\/vehicles\/[^/]+\/viewer$/

export function useEngineContext(): EngineContextValue {
  const ctx = useContext(EngineContext)
  if (!ctx) {
    throw new Error('useEngineContext는 EngineProvider 하위에서만 호출 가능합니다.')
  }
  return ctx
}

export function EngineProvider({ children }: { children: ReactNode }) {
  const [canvas, setCanvas] = useState<HTMLCanvasElement | null>(null)
  const [engine, setEngine] = useState<Engine | WebGPUEngine | null>(null)
  const [rendererType, setRendererType] = useState<RendererType | null>(null)
  const [error, setError] = useState<Error | null>(null)

  // Strict Mode 대응: cleanup에서 false로 되돌리지 않음 (한 번 true면 unmount까지 유지)
  const isInitializedRef = useRef(false)

  const location = useLocation()
  const isViewerActive = VIEWER_PATH_PATTERN.test(location.pathname)

  // canvas DOM 마운트 시 state로 끌어올림 (callback ref)
  const canvasRefCallback = useCallback((node: HTMLCanvasElement | null) => {
    setCanvas(node)
  }, [])

  // Viewer 경로 첫 진입 시 엔진 lazy 초기화
  useEffect(() => {
    if (!canvas) return
    if (!isViewerActive) return
    if (isInitializedRef.current) return

    isInitializedRef.current = true

    initializeEngine(canvas)
      .then(({ engine: e, rendererType: r }) => {
        setEngine(e)
        setRendererType(r)
      })
      .catch((err: Error) => {
        logger.error('엔진 초기화 실패', err)
        setError(err)
      })
  }, [canvas, isViewerActive])

  // 페이지 언로드 시에만 engine dispose
  useEffect(() => {
    const handleUnload = () => {
      if (engine) {
        engine.stopRenderLoop()
        engine.dispose()
      }
    }
    window.addEventListener('beforeunload', handleUnload)
    return () => window.removeEventListener('beforeunload', handleUnload)
  }, [engine])

  const value = useMemo<EngineContextValue>(
    () => ({ engine, rendererType, canvas, error }),
    [engine, rendererType, canvas, error],
  )

  return (
    <EngineContext.Provider value={value}>
      <canvas
        ref={canvasRefCallback}
        style={{
          position: 'fixed',
          top: 0,
          left: 0,
          width: '100vw',
          height: '100vh',
          visibility: isViewerActive ? 'visible' : 'hidden',
          pointerEvents: isViewerActive ? 'auto' : 'none',
          zIndex: isViewerActive ? 1 : -1,
          outline: 'none',
        }}
        tabIndex={isViewerActive ? 0 : -1}
      />
      {children}
    </EngineContext.Provider>
  )
}
