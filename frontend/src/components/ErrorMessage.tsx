// Copyright (c) 2025 Philip Choi

/** 에러 표시 + 재시도 버튼. null-safe 에러 메시지 분류. */

interface ErrorMessageProps {
  error: unknown
  onRetry: () => void
  onDismiss: () => void
}

/** 에러 종류에 따른 사용자 메시지 (null-safe) */
function getErrorMessage(error: unknown): string {
  if (error === null || error === undefined) {
    return '알 수 없는 오류가 발생했습니다.'
  }

  if (typeof error === 'string') return error
  if (typeof error !== 'object') return String(error)

  const rawMessage = (error as Error)?.message ?? ''
  const msg = rawMessage.toLowerCase()

  // AbortController 정상 취소 — 에러 아님
  if (msg.includes('abort')) return ''

  if (msg.includes('network') || msg.includes('fetch') || msg.includes('failed to fetch')) {
    return '서버에 연결할 수 없습니다. 네트워크를 확인하세요.'
  }
  if (msg.includes('404') || msg.includes('not found')) {
    return '요청한 파일을 찾을 수 없습니다.'
  }
  if (msg.includes('구역') || msg.includes('zone')) {
    return rawMessage
  }
  if (msg.includes('plugin') || msg.includes('glb') || msg.includes('gltf') || msg.includes('parse')) {
    return '3D 모델 파일을 로드할 수 없습니다.'
  }
  if (msg.includes('engine') || msg.includes('webgl') || msg.includes('webgpu')) {
    return '3D 렌더링 엔진을 초기화할 수 없습니다. 브라우저를 업데이트하세요.'
  }

  return rawMessage || '알 수 없는 오류가 발생했습니다.'
}

export function ErrorMessage({ error, onRetry, onDismiss }: ErrorMessageProps) {
  if (!error) return null

  const message = getErrorMessage(error)
  if (!message) return null

  return (
    <div className="absolute inset-0 z-10 flex items-center justify-center bg-slate-900/80">
      <div className="bg-slate-800 text-white rounded-lg p-6 max-w-sm mx-4 shadow-xl">
        <p className="text-sm mb-4">{message}</p>
        <div className="flex gap-2">
          <button
            onClick={onRetry}
            className="flex-1 bg-blue-600 hover:bg-blue-500 px-4 py-2 rounded text-sm transition-colors"
          >
            재시도
          </button>
          <button
            onClick={onDismiss}
            className="flex-1 bg-slate-700 hover:bg-slate-600 px-4 py-2 rounded text-sm transition-colors"
          >
            닫기
          </button>
        </div>
      </div>
    </div>
  )
}
