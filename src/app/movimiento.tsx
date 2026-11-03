'use client'

import { MotionConfig } from 'motion/react'
import type { ReactNode } from 'react'

export function Movimiento({ children }: { children: ReactNode }) {
  return <MotionConfig reducedMotion="user">{children}</MotionConfig>
}
