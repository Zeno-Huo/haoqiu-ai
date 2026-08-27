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

      const rotation = reducedMotion ? 0 : time * 0.00018
      currentX += (targetX - currentX) * 0.06
      currentY += (targetY - currentY) * 0.06
      context.clearRect(0, 0, width, height)

      const radius = Math.min(width, height) * (isMobile ? 0.31 : 0.34)
      const projectedDots = dots
        .map((dot) => ({ ...project(dot.x, dot.y, dot.z, rotation, radius), dot }))
        .sort((a, b) => a.z - b.z)

      projectedDots.forEach((item) => {
        const drift = reducedMotion ? 0 : Math.sin((time * 0.001 + item.dot.phase) * 2) * 0.7
        context.fillStyle = `rgba(101,214,176,${0.12 + (item.z + 1) * 0.32})`
        context.beginPath()
        context.arc(item.x, item.y, item.dot.size * item.scale + drift * 0.08, 0, Math.PI * 2)
        context.fill()
      })

      const drawShell = (tilt: number, opacity: number) => {
        context.strokeStyle = `rgba(101,214,176,${opacity})`
        context.lineWidth = 0.7
        context.beginPath()

        for (let index = 0; index < 130; index += 1) {
          const angle = (index / 129) * Math.PI * 2 + tilt
          const point = project(
            Math.cos(angle),
            Math.sin(angle) * 0.86,
            Math.sin(angle) * 0.18,
            rotation,
            radius,
          )
          if (index === 0) context.moveTo(point.x, point.y)
          else context.lineTo(point.x, point.y)
        }

        context.stroke()
      }

      drawShell(0.4, 0.32)
      drawShell(2.4, 0.18)

      context.strokeStyle = 'rgba(230,163,90,.34)'
      context.lineWidth = 1
      context.beginPath()
      for (let index = 26; index < 94; index += 1) {
        const angle = (index / 129) * Math.PI * 2 + 1.2
        const point = project(
          Math.cos(angle) * 1.01,
          Math.sin(angle) * 0.72,
          Math.sin(angle) * 0.96,
          rotation,
          radius,
        )
        if (index === 26) context.moveTo(point.x, point.y)
        else context.lineTo(point.x, point.y)
      }
      context.stroke()
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
        <h2>最近复盘</h2>
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
  return (
    <div className="page-shell home-page">
      <main className="home-content">
        <section className="sphere-stage">
          <ParticleSphere />
          <div className="sphere-actions">
            <Link to="/match/new" className="sphere-cta">
              选择分析模式 <span aria-hidden>→</span>
            </Link>
          </div>
        </section>
        <Recent matches={listMatches()} />
      </main>
    </div>
  )
}
