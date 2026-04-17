// Copyright (c) 2025 Philip Choi

/**
 * Babylon.js 엔진 초기화 로직.
 * initializeEngine(canvas)만 export. 엔진 lifecycle은 EngineContext가 관리.
 */

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

/**
 * WebGPU 우선, 실패 시 WebGL 2.0 fallback으로 엔진 생성.
 * 동일 canvas로 2번 호출하면 WebGPU context attach 실패하므로 호출 측에서 방지 필수.
 */
export async function initializeEngine(
  canvas: HTMLCanvasElement,
): Promise<EngineState> {
  // WebGPU 시도
  const supported = await WebGPUEngine.IsSupportedAsync
  if (supported) {
    try {
      const engine = new WebGPUEngine(canvas, { useLogarithmicDepth: true })
      await engine.initAsync()
      logger.info('WebGPU 엔진 초기화 완료')
      return { engine, rendererType: 'webgpu' as const }
    } catch (gpuErr) {
      logger.warn('WebGPU 초기화 실패, WebGL fallback', gpuErr)
    }
  }

  // WebGL 2.0 fallback
  const engine = new Engine(canvas, true, { useLogarithmicDepth: true })
  logger.info('WebGL 2.0 엔진 초기화 완료')
  return { engine, rendererType: 'webgl2' as const }
}
