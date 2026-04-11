// Copyright (c) 2025 Philip Choi

/** 구역별 정보 (metadata.json zones 항목) */
export interface ZoneInfo {
  file: string
  file_size_bytes: number
  file_hash: string
  draw_calls: number
  material_count: number
  vertex_count: number
  texture_memory_bytes: number
}

/** 차량 메타데이터 전체 (GET /vehicles/{id} 응답) */
export interface VehicleMetadata {
  vehicle_id: string
  vehicle_name: string
  created_at: string
  updated_at: string
  ue_version: string
  zones: Record<string, ZoneInfo>
}

/** 차량 목록 항목 (GET /vehicles 응답 내부) */
export interface VehicleListItem {
  vehicle_id: string
  vehicle_name: string
  updated_at: string | null
  zones: string[]
}

/** 렌더러 타입 */
export type RendererType = 'webgpu' | 'webgl2'
