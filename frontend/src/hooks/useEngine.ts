// Copyright (c) 2025 Philip Choi

/**
 * Babylon.js 엔진 초기화 훅.
 * 모듈 레벨 싱글톤으로 React Strict Mode 중복 초기화 방지.
 * WebGPU 우선, 실패 시 WebGL 2.0 자동 fallback.
 */

import { useEffect, useRef, useState } from 'react'
import { Engine } from '@babylonjs/core/Engines/engine'
import { WebGPUEngine } from '@babylonjs/core/Engines/webgpuEngine'
import { MeshoptCompression } from '@babylonjs/core/Meshes/Compression/meshoptCompression'
import { KhronosTextureContainer2 } from '@babylonjs/core/Misc/khronosTextureContainer2'
import type { RendererType } from '../types/vehicle'
import { logger } from '../utils/logger'

export interface EngineState {
  engine: Engine | WebGPUEngine
  rendererType: RendererType
}

// Meshopt 디코더 등록 (로컬 파일 사용)
MeshoptCompression.Configuration.decoder.url = '/libs/meshopt_decoder.js'

// KTX2 디코더 등록 (로컬 파일 사용 — 사내 인트라넷 CDN 접근 불가 대비)
KhronosTextureContainer2.URLConfig = {
  jsDecoderModule: '/libs/babylon.ktx2Decoder.js',
  wasmUASTCToASTC: '/libs/ktx2Transcoders/uastc_astc.wasm',
  wasmUASTCToBC7: '/libs/ktx2Transcoders/uastc_bc7.wasm',
  wasmUASTCToRGBA_UNORM: null,
  wasmUASTCToRGBA_SRGB: null,
  wasmUASTCToR8_UNORM: null,
  wasmUASTCToRG8_UNORM: null,
  jsMSCTranscoder: '/libs/ktx2Transcoders/msc_basis_transcoder.js',
  wasmMSCTranscoder: '/libs/ktx2Transcoders/msc_basis_transcoder.wasm',
  wasmZSTDDecoder: null,
}

// 모듈 레벨 싱글톤 — Strict Mode에서도 한 번만 생성
let _engineInstance: Engine | WebGPUEngine | null = null
let _initPromise: Promise<EngineState> | null = null
let _rendererType: RendererType | null = null

async function initializeEngine(
  canvas: HTMLCanvasElement,
): Promise<EngineState> {
  if (_engineInstance) {
    return { engine: _engineInstance, rendererType: _rendererType! }
  }
  if (_initPromise) return _initPromise

  _initPromise = (async () => {
    try {
      // WebGPU 시도
      const supported = await WebGPUEngine.IsSupportedAsync
      if (supported) {
        try {
          const engine = new WebGPUEngine(canvas, { useLogarithmicDepth: true })
          await engine.initAsync()
          _engineInstance = engine
          _rendererType = 'webgpu'
          logger.info('WebGPU 엔진 초기화 완료')
          return { engine, rendererType: 'webgpu' as const }
        } catch (gpuErr) {
          logger.warn('WebGPU 초기화 실패, WebGL fallback', gpuErr)
        }
      }

      // WebGL 2.0 fallback
      const engine = new Engine(canvas, true, { useLogarithmicDepth: true })
      _engineInstance = engine
      _rendererType = 'webgl2'
      logger.info('WebGL 2.0 엔진 초기화 완료')
      return { engine, rendererType: 'webgl2' as const }
    } catch (err) {
      _initPromise = null // 재시도 가능하게
      throw err
    }
  })()

  return _initPromise
}

export function useEngine(canvas: HTMLCanvasElement | null) {
  const [state, setState] = useState<EngineState | null>(null)
  const [error, setError] = useState<Error | null>(null)
  const isMounted = useRef(true)

  useEffect(() => {
    isMounted.current = true
    return () => {
      isMounted.current = false
    }
  }, [])

  useEffect(() => {
    if (!canvas) return

    initializeEngine(canvas)
      .then((result) => {
        if (isMounted.current) {
          setState(result)
        }
      })
      .catch((err) => {
        if (isMounted.current) {
          logger.error('엔진 초기화 실패', err)
          setError(err as Error)
        }
      })
  }, [canvas])

  // beforeunload에서만 engine.dispose()
  useEffect(() => {
    const handleUnload = () => {
      if (_engineInstance) {
        _engineInstance.dispose()
        _engineInstance = null
        _initPromise = null
        _rendererType = null
      }
    }
    window.addEventListener('beforeunload', handleUnload)
    return () => window.removeEventListener('beforeunload', handleUnload)
  }, [])

  return { ...state, error }
}
