import { useEffect, useRef } from 'react'
import { Link } from 'react-router-dom'
import { listMatches } from '../lib/storage'
import type { Match } from '../types'

type Dot = {
  x: number
  y: number
  z: number
  size: number
  phase: number
}

type DeviceOrientationEventConstructor = typeof DeviceOrientationEvent & {
  requestPermission?: () => Promise<'granted' | 'denied'>
}

function ParticleSphere() {
  const canvasRef = useRef<HTMLCanvasElement>(null)

  useEffect(() => {
    const canvas = canvasRef.current
    const context = canvas?.getContext('2d')
    if (!canvas || !context) return

    const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)').matches
    const isMobile = innerWidth < 640
    const dotCount = reducedMotion ? 180 : isMobile ? 620 : 1100
    const dots: Dot[] = Array.from({ length: dotCount }, (_, index) => {
      const z = 1 - (2 * (index + 0.5)) / dotCount
      const angle = index * 2.399963
      const radius = Math.sqrt(1 - z * z)

      return {
        x: radius * Math.cos(angle),
        y: z,
        z: radius * Math.sin(angle),
        size: 0.45 + (index % 6) * 0.18,
        phase: (index % 37) / 37,
      }
    })

    let width = 0
    let height = 0
    let animationFrame = 0
    let lastFrame = 0
    let targetX = 0
    let targetY = 0
    let currentX = 0
    let currentY = 0
    let orientationAttached = false

    const resize = () => {
      const density = Math.min(devicePixelRatio || 1, 2)
      width = canvas.clientWidth
      height = canvas.clientHeight
      canvas.width = width * density
      canvas.height = height * density
      context.setTransform(density, 0, 0, density, 0, 0)
    }

    const handleOrientation = (event: DeviceOrientationEvent) => {
      if (event.gamma == null && event.beta == null) return
      targetX = Math.max(-0.14, Math.min(0.14, ((event.gamma || 0) / 8) * 0.14))
      targetY = Math.max(-0.1, Math.min(0.1, (((event.beta || 0) - 45) / 8) * 0.1))
    }

    const attachOrientation = () => {
      if (orientationAttached) return
      addEventListener('deviceorientation', handleOrientation)
      orientationAttached = true
    }

    const enableOrientation = async () => {
      if (typeof DeviceOrientationEvent === 'undefined') return
      const orientationEvent = DeviceOrientationEvent as DeviceOrientationEventConstructor

      if (typeof orientationEvent.requestPermission !== 'function') {
        attachOrientation()
        return
      }

      try {
        if ((await orientationEvent.requestPermission()) === 'granted') attachOrientation()
      } catch {
        // Permission can be declined; automatic rotation remains available.
      }
    }

    const project = (x: number, y: number, z: number, rotation: number, radius: number) => {
      const angle = rotation + currentX
      const cosine = Math.cos(angle)
      const sine = Math.sin(angle)
      const rotatedX = x * cosine - z * sine
      const rotatedZ = x * sine + z * cosine
      const rotatedY = y * Math.cos(currentY) - rotatedZ * Math.sin(currentY)
      const depth = y * Math.sin(currentY) + rotatedZ * Math.cos(currentY)
      const scale = 1 + depth * 0.2

      return {
        x: width * 0.54 + rotatedX * radius * scale,
        y: height * 0.4 + rotatedY * radius * scale,
        z: depth,
        scale,
      }
    }

    const draw = (time: number) => {
      animationFrame = requestAnimationFrame(draw)
      if (!reducedMotion && time - lastFrame < 33) return
      lastFrame = time

      const rotation = 0
      currentX += (targetX - currentX) * 0.06
      currentY += (targetY - currentY) * 0.06
      context.clearRect(0, 0, width, height)

      const radius = Math.min(width, height) * (isMobile ? 0.31 : 0.34)
      const hexRotation = reducedMotion ? 0.2 : time * 0.00016
      const breathe = reducedMotion ? 1 : 1 + Math.sin(time * 0.0011) * 0.12
      const hexagon = Array.from({ length: 6 }, (_, index) => {
        const freeShape = reducedMotion ? 1 : 1 + Math.sin(time * 0.0017 + index * 1.45) * 0.08
        const angle = hexRotation + (index * Math.PI) / 3 - Math.PI / 6
        return project(
          Math.cos(angle) * 1.18 * breathe * freeShape,
          Math.sin(angle) * 0.7 * breathe * freeShape,
          Math.sin(angle) * 0.34 * breathe * freeShape,
          rotation,
          radius,
        )
      })
      const distanceToSegment = (px: number, py: number, ax: number, ay: number, bx: number, by: number) => {
        const dx = bx - ax
        const dy = by - ay
        const lengthSquared = dx * dx + dy * dy || 1
        const t = Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / lengthSquared))
        const cx = ax + t * dx
        const cy = ay + t * dy
        return Math.hypot(px - cx, py - cy)
      }
      const projectedDots = dots
        .map((dot) => {
          const point = project(dot.x, dot.y, dot.z, rotation, radius)
          let nearest = Infinity
          let pushX = 0
          let pushY = 0
          hexagon.forEach((vertex, index) => {
            const next = hexagon[(index + 1) % hexagon.length]
            const distance = distanceToSegment(point.x, point.y, vertex.x, vertex.y, next.x, next.y)
            if (distance < nearest) {
              nearest = distance
              const dx = point.x - (vertex.x + next.x) / 2
              const dy = point.y - (vertex.y + next.y) / 2
              const length = Math.hypot(dx, dy) || 1
              pushX = dx / length
              pushY = dy / length
            }
          })
          const influence = Math.max(0, 1 - nearest / Math.max(26, radius * 0.18))
          return { ...point, x: point.x + pushX * influence * 8, y: point.y + pushY * influence * 8, dot }
        })
        .sort((a, b) => a.z - b.z)

      projectedDots.forEach((item) => {
        const drift = 0
        context.fillStyle = `rgba(101,214,176,${0.12 + (item.z + 1) * 0.32})`
        context.beginPath()
        context.arc(item.x, item.y, item.dot.size * item.scale + drift * 0.08, 0, Math.PI * 2)
        context.fill()
      })

      context.strokeStyle = 'rgba(101,214,176,.32)'
      context.lineWidth = 1
      context.lineJoin = 'round'
      context.beginPath()
      hexagon.forEach((point, index) => {
        if (index === 0) context.moveTo(point.x, point.y)
        else context.lineTo(point.x, point.y)
      })
      context.closePath()
      context.stroke()

      hexagon.forEach((point, index) => {
        context.fillStyle = index % 2 === 0 ? 'rgba(241,245,243,.95)' : 'rgba(101,214,176,.95)'
        context.beginPath()
        context.arc(point.x, point.y, 2.5, 0, Math.PI * 2)
        context.fill()
      })
    }

    resize()
    addEventListener('resize', resize)

    if (typeof DeviceOrientationEvent !== 'undefined') {
      const orientationEvent = DeviceOrientationEvent as DeviceOrientationEventConstructor
      if (typeof orientationEvent.requestPermission === 'function') {
        // iOS requires a user gesture for sensor permission; keep this touch-only
        // so desktop mouse interactions never become part of the home experience.
        addEventListener('touchstart', enableOrientation, { once: true, passive: true })
      } else {
        attachOrientation()
      }
    }

    draw(0)

    return () => {
      cancelAnimationFrame(animationFrame)
      removeEventListener('resize', resize)
      removeEventListener('touchstart', enableOrientation)
      if (orientationAttached) removeEventListener('deviceorientation', handleOrientation)
    }
  }, [])

  return <canvas ref={canvasRef} className="particle-sphere-canvas" aria-hidden="true" />
}

/** 右上角入口：点击直接进 /history 二级页面（不做下拉展开）。 */
function Recent({ matches }: { matches: Match[] }) {
  return (
    <Link to="/history" className="home-recent">
      <span>往期分析</span>
      <b>{matches.length > 0 ? `${matches.length} 场` : '查看'}</b>
      <i aria-hidden="true">→</i>
    </Link>
  )
}

export default function Home() {
  const modes = [
    {
      index: '01',
      label: '比赛分析',
      kicker: '看球队',
      note: '快速总结，辅助决策',
      features: ['战术分析', '数据统计', '关键事件'],
      action: '上传视频，即刻分析',
      mode: 'instant',
      primary: true,
    },
    {
      index: '02',
      label: '个人分析',
      kicker: '看自己',
      note: 'AI动作追踪，深度分析，时间较长',
      features: ['表现评分', '跑动热图', '技术统计'],
      action: '上传个人跟拍视频',
      mode: 'personal',
      primary: false,
    },
  ]

  return (
    <div className="page-shell home-page">
      <main className="home-content">
        <section className="sphere-stage">
          <ParticleSphere />
          <div className="home-hero-copy">
            <span className="home-kicker">✦&nbsp; 业余足球</span>
            <h1 className="home-title"><span>AI</span>视频分析</h1>
            <span className="home-title-rule" aria-hidden="true" />
            <p className="home-value">上传足球视频，智能分析比赛与表现</p>
          </div>
        </section>
        <nav className="home-mode-grid" aria-label="分析方式">
          {modes.map(({ index, label, kicker, note, features, action, mode, primary }) => (
            <Link key={mode} to={`/match/new?mode=${mode}`} className={`home-mode-card ${primary ? 'is-primary' : ''}`}>
              <span className="home-mode-top">
                <span className="home-mode-index" aria-hidden="true">{index}</span>
                <b className="home-mode-kicker">{kicker} <span aria-hidden="true">›</span></b>
              </span>
              <span className="home-mode-detail">
                <span className={`home-mode-icon ${mode}`} aria-hidden="true">
                  {mode === 'instant' ? (
                    <svg viewBox="0 0 56 56" fill="none"><rect x="7" y="32" width="9" height="15" rx="2" /><rect x="23" y="21" width="9" height="26" rx="2" /><rect x="39" y="10" width="9" height="37" rx="2" /></svg>
                  ) : (
                    <svg viewBox="0 0 56 56" fill="none"><circle cx="28" cy="19" r="9" /><path d="M12 47c1-10 7-16 16-16s15 6 16 16" /></svg>
                  )}
                </span>
                <span className="home-mode-copy">
                  <strong className="home-mode-label">{label}</strong>
                  <span className="home-mode-note">{note}</span>
                  <span className="home-mode-features">
                    {features.map((feature) => <span key={feature}>{feature}</span>)}
                  </span>
                  <span className="home-mode-action">{action}<span aria-hidden="true">→</span></span>
                </span>
              </span>
            </Link>
          ))}
        </nav>
        <Recent matches={listMatches()} />
      </main>
      <footer className="home-footer">zeno有限公司出品</footer>
    </div>
  )
}
