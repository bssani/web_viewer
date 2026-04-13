// Copyright (c) 2025 Philip Choi

/**
 * 뷰어 페이지.
 * URL 파라미터 :id로 차량 ID를 받아 Babylon.js 3D 뷰어를 렌더링.
 * 기존 App.tsx의 Sidebar + Viewer 레이아웃을 그대로 유지.
 */

import { useState } from 'react'
import { useParams } from 'react-router-dom'
import { Sidebar } from '../components/Sidebar'
import { Viewer } from '../components/Viewer'

const isDevMode = new URLSearchParams(window.location.search).has('dev')

export default function ViewerPage() {
  const { id } = useParams<{ id: string }>()

  // Sidebar 내부에서 차량 선택 시 사용 (3c-4에서 navigate로 교체 예정)
  const [selectedVehicleId, setSelectedVehicleId] = useState<string | null>(id ?? null)

  return (
    <div className="flex h-screen bg-slate-900 text-white overflow-hidden">
      <Sidebar
        currentVehicleId={selectedVehicleId}
        onSelectVehicle={setSelectedVehicleId}
        isLoading={false}
      />
      <Viewer
        selectedVehicleId={selectedVehicleId}
        isDevMode={isDevMode}
      />
    </div>
  )
}
