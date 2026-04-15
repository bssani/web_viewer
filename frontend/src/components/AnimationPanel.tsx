// Copyright (c) 2025 Philip Choi

/** 파츠 애니메이션 토글 섹션. 감지된 animationGroup마다 버튼 1개. 부모 패널 내부 정적 배치. */

import type { PartAnimationState } from '../hooks/usePartAnimations'

interface AnimationPanelProps {
  parts: PartAnimationState[]
  onToggle: (name: string) => void
}

export function AnimationPanel({ parts, onToggle }: AnimationPanelProps) {
  if (parts.length === 0) return null

  return (
    <div className="p-3 select-none">
      <div className="text-xs font-bold text-slate-300 mb-2">파츠</div>
      <div className="flex flex-col gap-1">
        {parts.map((p) => (
          <button
            key={p.name}
            onClick={() => onToggle(p.name)}
            className={`text-xs px-2 py-1.5 rounded transition-colors text-left ${
              p.isOpen
                ? 'bg-blue-600 hover:bg-blue-500 text-white'
                : 'bg-slate-700 hover:bg-slate-600 text-slate-200'
            }`}
          >
            {p.displayName} {p.isOpen ? '닫기' : '열기'}
          </button>
        ))}
      </div>
    </div>
  )
}
