// Copyright (c) 2025 Philip Choi

/** 환경별 로깅 유틸리티. dev 모드에서만 콘솔 출력, 에러는 항상 출력. */

const isDev = import.meta.env.DEV

export const logger = {
  info: (...args: unknown[]) => {
    if (isDev) console.log('[VWV]', ...args)
  },
  warn: (...args: unknown[]) => {
    if (isDev) console.warn('[VWV]', ...args)
  },
  error: (...args: unknown[]) => {
    console.error('[VWV]', ...args)
  },
  debug: (...args: unknown[]) => {
    if (isDev) console.debug('[VWV]', ...args)
  },
}
