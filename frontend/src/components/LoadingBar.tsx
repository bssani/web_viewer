// Copyright (c) 2025 Philip Choi

/**
 * GLB 로딩 진행률 오버레이.
 * 로딩 중 캔버스를 완전히 덮어 검은 화면(빈 화면) 노출 방지.
 */

interface LoadingBarProps {
  progress: number
}

export function LoadingBar({ progress }: LoadingBarProps) {
  return (
    <div className="absolute inset-0 bg-slate-900 z-10 flex items-center justify-center">
      <div className="text-white text-center">
        <div className="mb-3 text-sm">
          차량 로딩 중... {Math.round(progress)}%
        </div>
        <div className="w-64 h-2 bg-slate-700 rounded-full">
          <div
            className="h-full bg-blue-500 rounded-full transition-all duration-200"
            style={{ width: `${Math.min(progress, 100)}%` }}
          />
        </div>
      </div>
    </div>
  )
}
