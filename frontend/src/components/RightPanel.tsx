// Copyright (c) 2025 Philip Choi

/**
 * 우측 고정 사이드 패널 — 접기/펼치기 지원.
 * 펼친 상태: 240px 폭, 내부에 LightingPanel
 * 접힌 상태: 패널 DOM 미렌더, 펼치기 버튼만 fixed 위치
 *
 * 토글 시 CSS transition 사용 금지 — ResizeObserver가 60Hz로 engine.resize 폭주.
 * 즉시 snap 변경으로 ResizeObserver 1회만 발화.
 */

import { useState } from 'react'
import { LightingPanel, type LightingPanelProps } from './LightingPanel'
import { loadBooleanPref, saveBooleanPref } from '../utils/preferences'

const RIGHT_PANEL_KEY = 'vwv:rightpanel'

type RightPanelProps = LightingPanelProps

/** 접기 화살표 (펼친 상태 → ▶, 접힌 상태 → ◀) */
function ArrowIcon({ direction }: { direction: 'left' | 'right' }) {
  const d = direction === 'right'
    ? 'M9 6l6 6-6 6'   // ▶
    : 'M15 6l-6 6 6 6' // ◀
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      width="20"
      height="20"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d={d} />
    </svg>
  )
}

export function RightPanel(props: RightPanelProps) {
  const [isOpen, setIsOpen] = useState<boolean>(() =>
    loadBooleanPref(RIGHT_PANEL_KEY, true),
  )

  const toggle = (next: boolean) => {
    setIsOpen(next)
    saveBooleanPref(RIGHT_PANEL_KEY, next)
  }

  if (!isOpen) {
    // 접힌 상태 — 펼치기 버튼만 fixed (ArcRotateCamera 포인터 위 z-10)
    return (
      <button
        type="button"
        onClick={() => toggle(true)}
        aria-label="우측 패널 펼치기"
        className="pointer-events-auto fixed top-3 right-3 z-10 w-8 h-8 flex items-center justify-center bg-slate-800/90 hover:bg-slate-700 text-slate-300 hover:text-white rounded cursor-pointer"
      >
        <ArrowIcon direction="left" />
      </button>
    )
  }

  return (
    <aside className="pointer-events-auto w-60 shrink-0 h-full bg-slate-900 border-l border-slate-700 flex flex-col text-white">
      <div className="flex items-center justify-between px-3 py-2 border-b border-slate-700 shrink-0">
        <span className="text-xs font-bold text-slate-300">설정</span>
        <button
          type="button"
          onClick={() => toggle(false)}
          aria-label="우측 패널 접기"
          className="w-6 h-6 flex items-center justify-center rounded hover:bg-slate-700 text-slate-400 hover:text-white cursor-pointer"
        >
          <ArrowIcon direction="right" />
        </button>
      </div>
      <div className="flex-1 min-h-0 overflow-y-auto">
        <LightingPanel {...props} />
      </div>
    </aside>
  )
}
