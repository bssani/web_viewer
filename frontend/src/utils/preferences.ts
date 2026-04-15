// Copyright (c) 2025 Philip Choi

/**
 * 사용자 UI 선택 영속화 유틸.
 * localStorage 접근 실패(시크릿 모드 등)는 조용히 무시.
 */

const ENV_KEY = 'vwv:env'
const NONE_SENTINEL = '__none__'

/** IBL 환경 선택 저장. null = 사용자가 "없음" 명시 선택. */
export function saveEnvironmentChoice(envId: string | null): void {
  try {
    localStorage.setItem(ENV_KEY, envId === null ? NONE_SENTINEL : envId)
  } catch {
    // localStorage 접근 실패 — 무시
  }
}

/**
 * IBL 환경 선택 조회.
 * - undefined: 저장된 값 없음 (기본값 사용 신호)
 * - null: 사용자가 "없음" 명시 선택
 * - string: 사용자가 선택한 envId
 */
export function loadEnvironmentChoice(): string | null | undefined {
  try {
    const v = localStorage.getItem(ENV_KEY)
    if (v === null) return undefined
    if (v === NONE_SENTINEL) return null
    return v
  } catch {
    return undefined
  }
}
