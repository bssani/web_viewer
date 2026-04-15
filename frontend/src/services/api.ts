// Copyright (c) 2025 Philip Choi

/** FastAPI 호출 서비스. 메타데이터 API에만 지수 백오프 재시도 적용. */

import type { VehicleListItem, VehicleMetadata } from '../types/vehicle'
import { logger } from '../utils/logger'

const MAX_RETRIES = 3
const BASE_DELAY_MS = 1000

/** 지수 백오프 fetch (5xx/네트워크 에러만 재시도, 4xx는 즉시 실패) */
async function fetchWithRetry(
  url: string,
  options?: RequestInit,
): Promise<Response> {
  let lastError: Error | null = null

  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    try {
      const response = await fetch(url, options)

      // 4xx는 재시도 안 함
      if (response.status >= 400 && response.status < 500) {
        return response
      }

      // 성공 또는 3xx
      if (response.ok) {
        return response
      }

      // 5xx → 재시도 대상
      lastError = new Error(`HTTP ${response.status}: ${response.statusText}`)
    } catch (err) {
      // 네트워크 에러 또는 AbortError
      if (err instanceof DOMException && err.name === 'AbortError') {
        throw err
      }
      lastError = err as Error
    }

    // 마지막 시도가 아니면 대기
    if (attempt < MAX_RETRIES) {
      const delay = BASE_DELAY_MS * Math.pow(2, attempt)
      logger.warn(`재시도 ${attempt + 1}/${MAX_RETRIES} (${delay}ms 후): ${url}`)
      await new Promise((r) => setTimeout(r, delay))
    }
  }

  throw lastError ?? new Error(`fetch 실패: ${url}`)
}

/** 전체 차량 목록 조회 */
export async function fetchVehicles(
  options?: { signal?: AbortSignal },
): Promise<VehicleListItem[]> {
  const response = await fetchWithRetry('/api/vehicles', { signal: options?.signal })
  if (!response.ok) {
    throw new Error(`차량 목록 조회 실패: ${response.status}`)
  }
  const data = await response.json()
  return data.vehicles ?? []
}

/** 특정 차량 메타데이터 조회 */
export async function fetchVehicleMetadata(
  vehicleId: string,
  options?: { signal?: AbortSignal },
): Promise<VehicleMetadata> {
  const response = await fetchWithRetry(`/api/vehicles/${vehicleId}`, {
    signal: options?.signal,
  })
  if (!response.ok) {
    throw new Error(`차량 메타데이터 조회 실패: ${response.status}`)
  }
  return response.json()
}

/** IBL 환경 목록 */
export interface EnvironmentItem {
  id: string
  name: string
  url: string
}

/** IBL 환경 목록 조회 */
export async function fetchEnvironments(
  options?: { signal?: AbortSignal },
): Promise<EnvironmentItem[]> {
  const response = await fetchWithRetry('/api/environments', { signal: options?.signal })
  if (!response.ok) {
    throw new Error(`환경 목록 조회 실패: ${response.status}`)
  }
  return response.json()
}

/** 해시 기반 캐시 버스팅 GLB URL 생성 (단일 GLB, StaticFiles 서빙) */
export function getGlbUrl(vehicleId: string, fileHash: string): string {
  const hashParam = fileHash ? `?v=${fileHash.slice(0, 8)}` : ''
  return `/static/${vehicleId}/model.glb${hashParam}`
}
