// Copyright (c) 2025 Philip Choi

/** 차량 선택 사이드바. 차량 목록 fetch + 선택 강조. */

import { useEffect, useState } from 'react'
import { fetchVehicles } from '../services/api'
import type { VehicleListItem } from '../types/vehicle'
import { logger } from '../utils/logger'

interface SidebarProps {
  currentVehicleId: string | null
  onSelectVehicle: (vehicleId: string) => void
  isLoading: boolean
}

export function Sidebar({
  currentVehicleId,
  onSelectVehicle,
  isLoading,
}: SidebarProps) {
  const [vehicles, setVehicles] = useState<VehicleListItem[]>([])
  const [fetchError, setFetchError] = useState<string | null>(null)
  const [isFetching, setIsFetching] = useState(true)

  const loadVehicles = () => {
    setIsFetching(true)
    setFetchError(null)
    fetchVehicles()
      .then((list) => {
        setVehicles(list)
        logger.info('[차량 목록]', list.length, '대')
      })
      .catch((err) => {
        logger.error('[차량 목록 실패]', err)
        setFetchError('차량 목록을 불러올 수 없습니다')
      })
      .finally(() => setIsFetching(false))
  }

  useEffect(() => {
    loadVehicles()
  }, [])

  return (
    <aside className="w-70 bg-slate-800 text-white flex flex-col h-full shrink-0">
      {/* 헤더 */}
      <div className="p-4 border-b border-slate-700">
        <h1 className="text-lg font-bold">Vehicle Viewer</h1>
        <p className="text-xs text-slate-400 mt-1">Philip Choi</p>
      </div>

      {/* 차량 목록 */}
      <div className="flex-1 overflow-y-auto p-2">
        {isFetching && (
          <p className="text-sm text-slate-400 p-2">로딩 중...</p>
        )}

        {fetchError && (
          <div className="p-2">
            <p className="text-sm text-red-400 mb-2">{fetchError}</p>
            <button
              onClick={loadVehicles}
              className="text-xs bg-slate-700 hover:bg-slate-600 px-3 py-1 rounded"
            >
              재시도
            </button>
          </div>
        )}

        {!isFetching && !fetchError && vehicles.length === 0 && (
          <p className="text-sm text-slate-400 p-2">
            등록된 차량이 없습니다.
            <br />
            <span className="text-xs">
              pipeline/compress.py로 GLB 파일을 추가하세요.
            </span>
          </p>
        )}

        {vehicles.map((v) => (
          <button
            key={v.vehicle_id}
            onClick={() => onSelectVehicle(v.vehicle_id)}
            disabled={isLoading}
            className={`w-full text-left p-3 rounded mb-1 transition-colors ${
              currentVehicleId === v.vehicle_id
                ? 'bg-blue-600'
                : 'hover:bg-slate-700'
            } ${isLoading ? 'opacity-50 cursor-wait' : 'cursor-pointer'}`}
          >
            <div className="font-medium text-sm">{v.vehicle_name}</div>
          </button>
        ))}
      </div>

      {/* Phase 4 확장 영역 (인터랙션 패널) */}
      <div className="border-t border-slate-700 p-3">
        <p className="text-xs text-slate-500">v0.2 — Phase 2</p>
      </div>
    </aside>
  )
}
