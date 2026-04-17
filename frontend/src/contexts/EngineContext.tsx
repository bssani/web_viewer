// Copyright (c) 2025 Philip Choi

/**
 * EngineContext — App 레벨 canvas/engine 영속화 컨테이너.
 *
 * Step 1 (현재): canvas DOM placeholder만 보유. engine은 null 고정.
 *   - Viewer는 여전히 자체 useEngine(canvas)로 engine 생성 (기능/메모리 baseline 동일).
 *   - Step 2에서 이 canvas를 Viewer가 사용하도록 전환하면서 engine 초기화 추가 예정.
 *
 * canvas 이중 초기화 방지를 위해 현재는 initializeEngine() 호출하지 않음.
 * beforeunload dispose 로직도 Step 2에서 engine 초기화와 함께 추가.
 */

import {
  createContext,
  useCallback,
  useContext,
  useState,
  type ReactNode,
} from 'react'
import type { Engine } from '@babylonjs/core/Engines/engine'
import type { WebGPUEngine } from '@babylonjs/core/Engines/webgpuEngine'
import type { RendererType } from '../types/vehicle'

interface EngineContextValue {
  engine: Engine | WebGPUEngine | null
  rendererType: RendererType | null
  canvas: HTMLCanvasElement | null
  error: Error | null
}

const EngineContext = createContext<EngineContextValue | null>(null)

export function useEngineContext(): EngineContextValue {
  const ctx = useContext(EngineContext)
  if (!ctx) {
    throw new Error('useEngineContext는 EngineProvider 하위에서만 호출 가능합니다.')
  }
  return ctx
}

export function EngineProvider({ children }: { children: ReactNode }) {
  const [canvas, setCanvas] = useState<HTMLCanvasElement | null>(null)

  // 캔버스 DOM 마운트 시점에 state로 끌어올려 children이 참조할 수 있게 함.
  const canvasRefCallback = useCallback((node: HTMLCanvasElement | null) => {
    setCanvas(node)
  }, [])

  const value: EngineContextValue = {
    engine: null,
    rendererType: null,
    canvas,
    error: null,
  }

  return (
    <EngineContext.Provider value={value}>
      <canvas
        ref={canvasRefCallback}
        style={{
          position: 'fixed',
          left: -9999,
          top: 0,
          width: 1,
          height: 1,
          pointerEvents: 'none',
        }}
      />
      {children}
    </EngineContext.Provider>
  )
}
