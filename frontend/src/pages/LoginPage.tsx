// Copyright (c) 2025 Philip Choi

/** 로그인 페이지 — 인증 없이 /vehicles로 이동 (Phase 6 SSO 도입 전 placeholder) */

import { useNavigate } from 'react-router-dom'

export default function LoginPage() {
  const navigate = useNavigate()

  return (
    <div className="flex h-screen items-center justify-center bg-slate-900">
      <div className="flex flex-col items-center gap-8">
        {/* 타이틀 */}
        <div className="text-center">
          <h1 className="text-3xl font-bold text-white tracking-tight">
            Vehicle Web Viewer
          </h1>
          <p className="text-sm text-slate-400 mt-2">
            Philip Choi
          </p>
        </div>

        {/* 로그인 버튼 */}
        <button
          onClick={() => navigate('/vehicles')}
          className="px-8 py-3 bg-blue-600 hover:bg-blue-500 text-white font-medium rounded-lg transition-colors cursor-pointer"
        >
          Log In
        </button>
      </div>
    </div>
  )
}
