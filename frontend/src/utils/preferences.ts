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

/** 불리언 설정 저장 — localStorage는 문자열만 저장하므로 'true'/'false' 명시. */
export function saveBooleanPref(key: string, value: boolean): void {
  try {
    localStorage.setItem(key, value ? 'true' : 'false')
  } catch {
    // 시크릿 모드 등 접근 실패 — 무시
  }
}

/**
 * 불리언 설정 조회 — 명시적 문자열 비교.
 * 주의: `if (localStorage.getItem(key))` 형태 금지 — "false" 문자열도 truthy로 판정되는 버그.
 */
export function loadBooleanPref(key: string, fallback: boolean): boolean {
  try {
    const v = localStorage.getItem(key)
    if (v === null) return fallback
    return v === 'true'
  } catch {
    return fallback
  }
}
