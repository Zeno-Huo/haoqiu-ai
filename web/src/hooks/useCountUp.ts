import { useEffect, useState } from 'react'

/** ease-out-expo：干脆、有决断感的减速曲线 */
const easeOutExpo = (t: number) => (t >= 1 ? 1 : 1 - Math.pow(2, -10 * t))

/**
 * 数字滚动：0 → 目标值（requestAnimationFrame）。
 * - duration：滚动时长（默认 800ms，落在 600–900ms 建议区间）
 * - delay：延迟开始（用于配合卡片 stagger 入场，让数字在卡片浮现后开始滚动）
 * - 尊重 prefers-reduced-motion：直接落到最终值，不做滚动
 */
export function useCountUp(target: number, opts?: { duration?: number; delay?: number }): number {
  const { duration = 800, delay = 0 } = opts ?? {}
  const [value, setValue] = useState(0)

  useEffect(() => {
    if (typeof window !== 'undefined' && window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
      setValue(target)
      return
    }

    let raf = 0
    let start = 0
    let timer = 0

    const tick = (now: number) => {
      if (start === 0) start = now
      const p = Math.min(1, (now - start) / duration)
      setValue(target * easeOutExpo(p))
      if (p < 1) {
        raf = requestAnimationFrame(tick)
      } else {
        setValue(target)
      }
    }

    const begin = () => {
      raf = requestAnimationFrame(tick)
    }

    if (delay > 0) {
      timer = window.setTimeout(begin, delay)
    } else {
      begin()
    }

    return () => {
      window.clearTimeout(timer)
      cancelAnimationFrame(raf)
    }
  }, [target, duration, delay])

  return value
}
