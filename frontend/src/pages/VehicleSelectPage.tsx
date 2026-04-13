// Copyright (c) 2025 Philip Choi

/** 차량 선택 페이지 — 카드 그리드로 차량 목록 표시, 클릭 시 뷰어 이동 */

import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { fetchVehicles } from '../services/api'
import type { VehicleListItem } from '../types/vehicle'
import { logger } from '../utils/logger'

export default function VehicleSelectPage() {
  const navigate = useNavigate()
  const [vehicles, setVehicles] = useState<VehicleListItem[]>([])
  const [isFetching, setIsFetching] = useState(true)
  const [fetchError, setFetchError] = useState<string | null>(null)

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
    <div className="min-h-screen bg-slate-900 text-white">
      {/* 헤더 */}
      <header className="border-b border-slate-700 px-8 py-6">
        <h1 className="text-2xl font-bold">차량 선택</h1>
        <p className="text-sm text-slate-400 mt-1">뷰어로 확인할 차량을 선택하세요</p>
      </header>

      {/* 콘텐츠 */}
      <main className="p-8">
        {/* 로딩 */}
        {isFetching && (
          <p className="text-slate-400">로딩 중...</p>
        )}

        {/* 에러 */}
        {fetchError && (
          <div className="flex flex-col items-start gap-3">
            <p className="text-red-400">{fetchError}</p>
            <button
              onClick={loadVehicles}
              className="px-4 py-2 bg-slate-700 hover:bg-slate-600 rounded text-sm cursor-pointer"
            >
              재시도
            </button>
          </div>
        )}

        {/* 빈 목록 */}
        {!isFetching && !fetchError && vehicles.length === 0 && (
          <p className="text-slate-400">
            등록된 차량이 없습니다. pipeline/compress.py로 GLB 파일을 추가하세요.
          </p>
        )}

        {/* 카드 그리드 */}
        {!isFetching && vehicles.length > 0 && (
          <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-6">
            {vehicles.map((v) => (
              <button
                key={v.vehicle_id}
                onClick={() => navigate(`/vehicles/${v.vehicle_id}/viewer`)}
                className="group bg-slate-800 rounded-lg overflow-hidden border border-slate-700 hover:border-blue-500 transition-colors cursor-pointer text-left"
              >
                {/* 썸네일 */}
                <div className="aspect-video bg-slate-700 flex items-center justify-center overflow-hidden">
                  <ThumbnailImage vehicleId={v.vehicle_id} />
                </div>

                {/* 차량 정보 */}
                <div className="p-4">
                  <h2 className="font-medium text-sm group-hover:text-blue-400 transition-colors">
                    {v.vehicle_name}
                  </h2>
                  <p className="text-xs text-slate-400 mt-1">
                    {v.zones.length}개 구역
                  </p>
                </div>
              </button>
            ))}
          </div>
        )}
      </main>
    </div>
  )
}

/** 썸네일 이미지 — 404 시 placeholder 아이콘 표시 */
function ThumbnailImage({ vehicleId }: { vehicleId: string }) {
  const [hasError, setHasError] = useState(false)

  if (hasError) {
    return (
      <svg
        className="w-12 h-12 text-slate-500"
        fill="none"
        stroke="currentColor"
        viewBox="0 0 24 24"
      >
        <path
          strokeLinecap="round"
          strokeLinejoin="round"
          strokeWidth={1.5}
          d="M8.25 18.75a1.5 1.5 0 0 1-3 0m3 0a1.5 1.5 0 0 0-3 0m3 0h6m-9 0H3.375a1.125 1.125 0 0 1-1.125-1.125V14.25m17.25 4.5a1.5 1.5 0 0 1-3 0m3 0a1.5 1.5 0 0 0-3 0m3 0h1.125c.621 0 1.129-.504 1.09-1.124a17.902 17.902 0 0 0-3.213-9.193 2.056 2.056 0 0 0-1.58-.86H14.25m-3.75 0V5.625m0 12.75v-2.251c0-.39.104-.865.277-1.245l.95-2.09a1.001 1.001 0 0 0-.15-1.024l-2.6-3.12a1.002 1.002 0 0 0-.766-.36H3.375a1.125 1.125 0 0 0-1.125 1.125v8.1c0 .622.504 1.125 1.125 1.125"
        />
      </svg>
    )
  }

  return (
    <img
      src={`/api/vehicles/${vehicleId}/thumbnail`}
      alt={vehicleId}
      className="w-full h-full object-cover"
      onError={() => setHasError(true)}
    />
  )
}
