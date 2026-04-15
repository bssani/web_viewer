// Copyright (c) 2025 Philip Choi

/**
 * 뷰어 페이지.
 * URL 파라미터 :id로 차량 ID를 받아 Babylon.js 3D 뷰어를 렌더링.
 * 차량 선택 이동은 LeftPanel 하단 버튼이 담당.
 */

import { useParams } from 'react-router-dom'
import { Viewer } from '../components/Viewer'

const isDevMode = new URLSearchParams(window.location.search).has('dev')

export default function ViewerPage() {
  const { id } = useParams<{ id: string }>()

  return (
    <div className="h-screen bg-slate-900 text-white overflow-hidden">
      <Viewer
        selectedVehicleId={id ?? null}
        isDevMode={isDevMode}
      />
    </div>
  )
}
