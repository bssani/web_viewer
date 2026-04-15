// Copyright (c) 2025 Philip Choi

/**
 * 좌측 고정 사이드 패널.
 * 상단: 파츠 애니메이션 섹션 (parts 0개면 숨김)
 * 중단: 향후 확장 영역 (현재 비움)
 * 하단: "← 차량 선택" 버튼 (고정)
 */

import { AnimationPanel } from './AnimationPanel'
import type { PartAnimationState } from '../hooks/usePartAnimations'

interface LeftPanelProps {
  parts: PartAnimationState[]
  onTogglePart: (name: string) => void
  onBackToSelect: () => void
}

export function LeftPanel({ parts, onTogglePart, onBackToSelect }: LeftPanelProps) {
  return (
    <aside className="w-60 shrink-0 h-full bg-slate-900 border-r border-slate-700 flex flex-col text-white">
      {/* 상단 — 파츠 섹션 */}
      <div className="shrink-0">
        <AnimationPanel parts={parts} onToggle={onTogglePart} />
      </div>

      {/* 중단 — 향후 확장 */}
      <div className="flex-1" />

      {/* 하단 — 차량 선택 이동 */}
      <div className="shrink-0 border-t border-slate-700 p-3">
        <button
          onClick={onBackToSelect}
          className="w-full px-3 py-2 bg-slate-800 hover:bg-slate-700 rounded text-sm text-slate-200 hover:text-white transition-colors cursor-pointer border border-slate-600/50"
        >
          ← 차량 선택
        </button>
      </div>
    </aside>
  )
}
