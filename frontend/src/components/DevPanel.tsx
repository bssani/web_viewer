// Copyright (c) 2025 Philip Choi

/**
 * 개발자 모드 패널 (?dev=1).
 * 렌더러 종류, FPS, 메시/머티리얼/텍스처 수, 메모리, 차량 정보 실시간 표시.
 * 차량 전환 시 누수 감지 경고.
 */

import { useEffect, useRef, useState } from 'react'
import type { Scene } from '@babylonjs/core/scene'
import type { Engine } from '@babylonjs/core/Engines/engine'
import type { WebGPUEngine } from '@babylonjs/core/Engines/webgpuEngine'
import type { RendererType, VehicleMetadata } from '../types/vehicle'

interface DevPanelProps {
  engine: Engine | WebGPUEngine | null
  scene: Scene | null
  rendererType: RendererType | null
  vehicleId: string | null
  metadata: VehicleMetadata | null
}

interface SceneMetrics {
  fps: number
  meshes: number
  materials: number
  textures: number
  cachedTextures: number
  totalVertices: number
  jsHeap: number | null
}

export function DevPanel({
  engine,
  scene,
  rendererType,
  vehicleId,
  metadata,
}: DevPanelProps) {
  const [metrics, setMetrics] = useState<SceneMetrics | null>(null)
  const [hasLeak, setHasLeak] = useState(false)
  const prevMetricsRef = useRef<SceneMetrics | null>(null)

  // 메트릭 갱신 (1초 간격)
  useEffect(() => {
    if (!engine || !scene) return

    const interval = setInterval(() => {
      const current: SceneMetrics = {
        fps: Math.round(engine.getFps()),
        meshes: scene.meshes.length,
        materials: scene.materials.length,
        textures: scene.textures.length,
        cachedTextures: engine.getLoadedTexturesCache().length,
        totalVertices: scene.getTotalVertices(),
        jsHeap: (performance as unknown as { memory?: { usedJSHeapSize: number } })
          .memory?.usedJSHeapSize ?? null,
      }
      setMetrics(current)
    }, 1000)

    return () => clearInterval(interval)
  }, [engine, scene])

  // 차량 전환 시 누수 감지
  useEffect(() => {
    if (metrics && prevMetricsRef.current) {
      // 이전 씬보다 캐시된 텍스처가 누적되면 누수
      if (metrics.cachedTextures > prevMetricsRef.current.cachedTextures + 5) {
        setHasLeak(true)
      } else {
        setHasLeak(false)
      }
    }
    prevMetricsRef.current = metrics
  }, [vehicleId, metrics])

  const handleCopy = () => {
    if (!metrics) return
    const text = [
      `=== Vehicle Viewer Benchmark ===`,
      `Date: ${new Date().toISOString()}`,
      `Renderer: ${rendererType ?? 'unknown'}`,
      `Vehicle: ${vehicleId ?? 'none'}`,
      `FPS: ${metrics.fps}`,
      `Meshes: ${metrics.meshes}`,
      `Materials: ${metrics.materials}`,
      `Textures: ${metrics.textures}`,
      `Cached Textures: ${metrics.cachedTextures}`,
      `Total Vertices: ${metrics.totalVertices.toLocaleString()}`,
      `JS Heap: ${metrics.jsHeap ? `${(metrics.jsHeap / 1048576).toFixed(1)}MB` : 'N/A'}`,
      metadata?.model
        ? `Metadata Draw Calls: ${metadata.model.draw_calls}`
        : '',
    ]
      .filter(Boolean)
      .join('\n')
    navigator.clipboard.writeText(text)
  }

  if (!metrics) return null

  return (
    <div className="absolute bottom-3 right-3 z-20 bg-black/80 text-green-400 text-xs font-mono p-3 rounded-lg max-w-60 select-none">
      <div className="font-bold mb-1 text-green-300">DEV</div>
      <div>렌더러: {rendererType ?? '...'}</div>
      <div>FPS: {metrics.fps}</div>
      <hr className="border-green-900 my-1" />
      <div>메시: {metrics.meshes}</div>
      <div>머티리얼: {metrics.materials}</div>
      <div>텍스처: {metrics.textures}</div>
      <div>캐시 텍스처: {metrics.cachedTextures}</div>
      <div>정점: {metrics.totalVertices.toLocaleString()}</div>
      {metrics.jsHeap && (
        <div>JS Heap: {(metrics.jsHeap / 1048576).toFixed(1)}MB</div>
      )}
      <hr className="border-green-900 my-1" />
      <div>차량: {vehicleId ?? 'none'}</div>
      {metadata?.model && (
        <div className="text-slate-400">
          meta draw_calls: {metadata.model.draw_calls}
        </div>
      )}
      {hasLeak && (
        <div className="text-red-400 font-bold mt-1">⚠ 메모리 누수 의심</div>
      )}
      <button
        onClick={handleCopy}
        className="mt-2 bg-green-900 hover:bg-green-800 text-green-300 px-2 py-0.5 rounded text-xs w-full"
      >
        Copy to Clipboard
      </button>
    </div>
  )
}
