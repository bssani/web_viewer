// Copyright (c) 2025 Philip Choi

/**
 * 루트 앱 컴포넌트.
 * React Router 기반 3페이지 라우팅: 로그인 → 차량 선택 → 뷰어.
 */

import { Routes, Route, Navigate } from 'react-router-dom'
import LoginPage from './pages/LoginPage'
import VehicleSelectPage from './pages/VehicleSelectPage'
import ViewerPage from './pages/ViewerPage'
import { EngineProvider } from './contexts/EngineContext'

export default function App() {
  return (
    <EngineProvider>
      <Routes>
        <Route path="/" element={<LoginPage />} />
        <Route path="/vehicles" element={<VehicleSelectPage />} />
        <Route path="/vehicles/:id/viewer" element={<ViewerPage />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </EngineProvider>
  )
}
