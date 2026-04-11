// Copyright (c) 2025 Philip Choi

/**
 * 루트 앱 컴포넌트.
 * 좌측 Sidebar(차량 선택) + 우측 Viewer(3D 렌더링) 레이아웃.
 * ?dev=1 쿼리 파라미터로 개발자 모드 활성화.
 */

import { useState } from 'react'
import { Sidebar } from './components/Sidebar'
import { Viewer } from './components/Viewer'

const isDevMode = new URLSearchParams(window.location.search).has('dev')

export default function App() {
  const [selectedVehicleId, setSelectedVehicleId] = useState<string | null>(null)

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
