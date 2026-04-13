// Copyright (c) 2025 Philip Choi

/**
 * 뷰어 페이지.
 * URL 파라미터 :id로 차량 ID를 받아 Babylon.js 3D 뷰어를 렌더링.
 * "← 차량 선택" 버튼으로 /vehicles 이동.
 */

import { useParams, useNavigate } from 'react-router-dom'
import { Viewer } from '../components/Viewer'

const isDevMode = new URLSearchParams(window.location.search).has('dev')

export default function ViewerPage() {
  const { id } = useParams<{ id: string }>()
  const navigate = useNavigate()

  return (
    <div className="relative h-screen bg-slate-900 text-white overflow-hidden">
      {/* 뒤로가기 버튼 */}
      <button
        onClick={() => navigate('/vehicles')}
        className="absolute top-4 left-4 z-20 px-4 py-2 bg-slate-800/80 hover:bg-slate-700 backdrop-blur-sm rounded-lg text-sm text-slate-300 hover:text-white transition-colors cursor-pointer border border-slate-600/50"
      >
        ← 차량 선택
      </button>

      <Viewer
        selectedVehicleId={id ?? null}
        isDevMode={isDevMode}
      />
    </div>
  )
}
