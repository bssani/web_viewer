// Copyright (c) 2025 Philip Choi

/** GLB animationGroup 자동 감지 + 파츠별 열기/닫기 토글. */

import { useEffect, useState, useCallback } from 'react'
import type { Scene } from '@babylonjs/core/scene'
import type { AnimationGroup } from '@babylonjs/core/Animations/animationGroup'
import { logger } from '../utils/logger'

export interface PartAnimationState {
  name: string
  displayName: string
  group: AnimationGroup
  isOpen: boolean
}

function parseDisplayName(raw: string): string {
  return raw
    .replace(/_\d+$/, '')
    .replace(/_/g, ' ')
    .replace(/([a-z])([A-Z])/g, '$1 $2')
    .trim()
}

export function usePartAnimations(scene: Scene | null, vehicleId: string | null) {
  const [parts, setParts] = useState<PartAnimationState[]>([])

  useEffect(() => {
    if (!scene || !vehicleId) {
      setParts([])
      return
    }

    const detected: PartAnimationState[] = scene.animationGroups.map((g) => {
      g.stop()
      g.goToFrame(0)
      return {
        name: g.name,
        displayName: parseDisplayName(g.name),
        group: g,
        isOpen: false,
      }
    })

    logger.info('[animations]', detected.length, '개 감지')
    setParts(detected)
  }, [scene, vehicleId])

  const togglePart = useCallback((name: string) => {
    setParts((prev) =>
      prev.map((p) => {
        if (p.name !== name) return p
        const nextOpen = !p.isOpen
        const speed = nextOpen ? 1 : -1

        if (p.group.isPlaying) {
          p.group.speedRatio = speed
        } else {
          p.group.start(false, speed, p.group.from, p.group.to, false)
        }
        return { ...p, isOpen: nextOpen }
      }),
    )
  }, [])

  return { parts, togglePart }
}
