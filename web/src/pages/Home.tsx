import { useEffect, useRef } from 'react'
import { Link } from 'react-router-dom'
import { listMatches } from '../lib/storage'
import { formatDate } from '../lib/utils'
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

    const handlePointerMove = (event: PointerEvent) => {
      const bounds = canvas.getBoundingClientRect()
      targetX = ((event.clientX - bounds.left) / bounds.width - 0.5) * 0.28
      targetY = ((event.clientY - bounds.top) / bounds.height - 0.5) * 0.16
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
    addEventListener('pointermove', handlePointerMove)

    if (typeof DeviceOrientationEvent !== 'undefined') {
      const orientationEvent = DeviceOrientationEvent as DeviceOrientationEventConstructor
      if (typeof orientationEvent.requestPermission === 'function') {
        addEventListener('pointerdown', enableOrientation, { once: true })
      } else {
        attachOrientation()
      }
    }

    draw(0)

    return () => {
      cancelAnimationFrame(animationFrame)
      removeEventListener('resize', resize)
      removeEventListener('pointermove', handlePointerMove)
      removeEventListener('pointerdown', enableOrientation)
      if (orientationAttached) removeEventListener('deviceorientation', handleOrientation)
    }
  }, [])

  return <canvas ref={canvasRef} className="particle-sphere-canvas" aria-hidden="true" />
}

function Recent({ matches }: { matches: Match[] }) {
  return (
    <details className="home-recent">
      <summary className="home-recent-heading">
        <h2>历史复盘</h2>
        <span aria-hidden>⌄</span>
      </summary>
      {matches.length > 0 && (
        <div className="home-recent-list">
          {matches.slice(0, 4).map((match) => (
            <Link key={match.id} to={`/match/${match.id}`} className="home-recent-row">
              <span className="home-recent-match">{match.videoName || match.name}</span>
              <span>{formatDate(match.date)}</span>
              <span className="home-recent-view">查看</span>
            </Link>
          ))}
        </div>
      )}
    </details>
  )
}

export default function Home() {
  const modes = [
    { index: '01', label: '即时分析', note: '赛中快速看重点', mode: 'instant' },
    { index: '02', label: '深度复盘', note: '赛后完整看', mode: 'deep' },
    { index: '03', label: '个人追踪', note: '观察一名球员', mode: 'single' },
    { index: '04', label: '训练模式', note: '单人动作反馈', mode: 'training' },
  ]

  return (
    <div className="page-shell home-page">
      <main className="home-content">
        <section className="sphere-stage">
          <ParticleSphere />
          <div className="home-hero-copy">
            <h1 className="home-title"><span>业余足球</span><span>智能分析助手</span></h1>
            <div className="home-upload-wrap">
              <Link className="home-upload-button" to="/match/new">上传视频 <span aria-hidden>↗</span></Link>
              <span className="home-upload-note">上传足球视频，即刻分析</span>
            </div>
          </div>
        </section>
        <nav className="home-mode-grid" aria-label="复盘方式">
          {modes.map(({ index, label, note, mode }) => (
            <Link key={mode} to={`/match/new?mode=${mode}`} className="home-mode-card">
              <span className="home-mode-index" aria-hidden="true">{index}</span>
              <span className="home-mode-label">{label}</span>
              <span className="home-mode-note">{note}</span>
              <span className="home-mode-arrow" aria-hidden="true">↗</span>
            </Link>
          ))}
        </nav>
        <Recent matches={listMatches()} />
      </main>
      <footer className="home-footer">zeno有限公司出品</footer>
    </div>
  )
}
