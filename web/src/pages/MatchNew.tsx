import { useRef, useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { createRng } from '../lib/seed'
import { getTeamProfile, newId, saveMatch } from '../lib/storage'
import { todayStr } from '../lib/utils'
import { cacheVideoFile } from '../lib/videoFileCache'
import type { Match, MatchType, Player } from '../types'
import { MATCH_TYPES, MATCH_TYPE_DESC } from '../types'

function clampScore(raw: string): number {
  const value = Math.floor(Number(raw))
  if (!Number.isFinite(value)) return 0
  return Math.min(99, Math.max(0, value))
}

export default function MatchNew() {
  const navigate = useNavigate()
  const [searchParams] = useSearchParams()
  const mode = searchParams.get('mode')
  const inputRef = useRef<HTMLInputElement>(null)
  const probeTokenRef = useRef(0)
  const team = getTeamProfile()
  const [videoName, setVideoName] = useState('')
  const [selectedFile, setSelectedFile] = useState<File>()
  const [videoProbeState, setVideoProbeState] = useState<'idle' | 'probing' | 'ready' | 'error'>('idle')
  const [videoMeta, setVideoMeta] = useState<Match['videoMeta']>()
  const [framePreview, setFramePreview] = useState('')
  const [openingFramePoint, setOpeningFramePoint] = useState<{ x: number; y: number }>()
  const [jerseyHint, setJerseyHint] = useState('')
  const [date, setDate] = useState(todayStr())
  const [type, setType] = useState<MatchType>('7v7')
  const [opponentName, setOpponentName] = useState('')
  const [myScore, setMyScore] = useState(0)
  const [oppScore, setOppScore] = useState(0)
  const [error, setError] = useState('')

  const canStart = Boolean(videoName && videoProbeState === 'ready')
  const modeTitle = mode === 'instant' ? '上传比赛视频，开始即时分析' : mode === 'deep' ? '上传比赛视频，开始深度复盘' : mode === 'single' ? '上传视频，开始单人跟拍' : '上传比赛视频'
  const modeHint = mode === 'instant'
    ? '选择一段球队视频，上传后由视觉大模型快速给出文字判断。'
    : mode === 'deep'
    ? '选择一段球队视频，上传后由 GPU 做逐帧检测并生成标注视频。'
    : mode === 'single'
    ? '选择一段以一名球员为主的训练或比赛视频。YOLO 先完成整段检测，再由你确认跟拍对象。'
    : '选择一段球队视频，先检查画面信息；下一步可选择真实检测或独立的球队复盘 Demo。'
  const startLabel = mode === 'instant' ? '开始即时分析' : mode === 'deep' ? '开始深度复盘' : mode === 'single' ? '开始单人跟拍' : '下一步：检查视频'

  function startReview() {
    if (!videoName) {
      setError('请选择视频，或使用演示片段')
      return
    }

    const id = newId('m')
    const rng = createRng(`comparison:${id}`)
    const possessionHome = 46 + rng.int(0, 8)
    const lineupSize = type === '5v5' ? 5 : type === '7v7' ? 7 : 11
    const candidateCount = team.members.length ? Math.min(team.members.length, lineupSize) : lineupSize
    const fallbackNumbers = ['9', '7', '10']
    const players: Player[] = Array.from({ length: candidateCount }, (_, index) => {
      const numberClue = index < 3 ? (team.members[index]?.commonNumber?.trim() || fallbackNumbers[index]) : undefined
      return {
        id: newId('p'),
        name: numberClue ? `${numberClue}号球员` : `无号码球衣${index - 2}`,
        number: numberClue || '?',
        position: index < Math.max(1, Math.floor(candidateCount * 0.3)) ? '前锋' : index < Math.max(2, Math.floor(candidateCount * 0.75)) ? '中场' : '后卫',
      }
    })
    const match: Match = {
      id,
      name: mode === 'single' ? `${date} 单人跟拍` : `${date} 球队复盘`,
      date,
      type,
      duration: 15 * 60,
      teamId: team.id,
      teamName: team.name,
      opponentName: opponentName.trim() || '对手',
      myScore,
      oppScore,
      possessionHome,
      possessionAway: 100 - possessionHome,
      shotsAway: Math.max(0, oppScore + rng.int(1, 5)),
      videoName,
      videoSource: selectedFile ? 'local-file' : 'demo',
      videoMeta,
      ourTeamContext: mode === 'instant' ? {
        teamName: team.name,
        jerseyHint: jerseyHint.trim() || undefined,
        openingFramePoint,
      } : undefined,
      identificationStatus: 'pending',
      players,
      createdAt: Date.now(),
      analysisMode: mode === 'single' ? 'single' : undefined,
    }
    saveMatch(match)
    if (selectedFile) cacheVideoFile(id, selectedFile)
    if (mode === 'instant') navigate(`/match/${id}/instant`, { replace: true })
    else if (mode === 'deep') navigate(`/match/${id}/detection`, { replace: true })
    else if (mode === 'single') navigate(`/match/${id}/tracking`, { replace: true })
    else navigate(`/match/${id}/quality`, { replace: true })
  }

  return (
    <div className="page-shell px-4 py-10">
      <div className="mx-auto max-w-3xl">
        <header className="mb-7">
          <h1 className="text-3xl font-semibold text-[var(--text-primary)]">{modeTitle}</h1>
          <p className="mt-2 max-w-2xl text-sm leading-6 text-[var(--text-muted)]">
            {modeHint}
          </p>
        </header>

        <section className="panel p-5 sm:p-6">
          <input
            ref={inputRef}
            className="sr-only"
            type="file"
            accept=".mp4,.mov,video/mp4,video/quicktime"
            onChange={(event) => {
              const probeToken = ++probeTokenRef.current
              const file = event.target.files?.[0]
              if (file && !/\.(mp4|mov)$/i.test(file.name)) {
                event.currentTarget.value = ''
                setSelectedFile(undefined)
                setVideoName('')
                setVideoMeta(undefined)
                setVideoProbeState('error')
                setError('真实检测 v0.1 仅支持 MP4 或 MOV 视频')
                return
              }
              if (file && file.size > 300 * 1024 * 1024) {
                event.currentTarget.value = ''
                setSelectedFile(undefined)
                setVideoName('')
                setVideoMeta(undefined)
                setVideoProbeState('error')
                setError('视频超过 300MB，请压缩或截取后重试')
                return
              }
              setSelectedFile(file)
              setVideoName(file?.name ?? '')
              setVideoMeta(file ? { sizeBytes: file.size } : undefined)
              setFramePreview('')
              setOpeningFramePoint(undefined)
              setVideoProbeState(file ? 'probing' : 'idle')
              if (file) {
                const url = URL.createObjectURL(file)
                const probe = document.createElement('video')
                probe.preload = 'metadata'
                probe.onloadedmetadata = () => {
                  if (probeToken !== probeTokenRef.current) {
                    URL.revokeObjectURL(url)
                    return
                  }
                  if (probe.duration > 15 * 60) {
                    if (inputRef.current) inputRef.current.value = ''
                    setSelectedFile(undefined)
                    setVideoName('')
                    setVideoMeta(undefined)
                    setVideoProbeState('error')
                    setError('视频超过 15 分钟，请截取后重试')
                  } else {
                    setVideoMeta({ sizeBytes: file.size, durationSeconds: probe.duration, width: probe.videoWidth, height: probe.videoHeight })
                    setVideoProbeState('ready')
                    probe.currentTime = Math.min(0.2, Math.max(0, probe.duration / 2))
                  }
                }
                probe.onseeked = () => {
                  if (probeToken !== probeTokenRef.current) return
                  const canvas = document.createElement('canvas')
                  canvas.width = probe.videoWidth
                  canvas.height = probe.videoHeight
                  const context = canvas.getContext('2d')
                  if (context && canvas.width && canvas.height) {
                    context.drawImage(probe, 0, 0, canvas.width, canvas.height)
                    setFramePreview(canvas.toDataURL('image/jpeg', 0.82))
                  }
                  URL.revokeObjectURL(url)
                }
                probe.onerror = () => {
                  if (probeToken === probeTokenRef.current) {
                    if (inputRef.current) inputRef.current.value = ''
                    setSelectedFile(undefined)
                    setVideoName('')
                    setVideoMeta(undefined)
                    setVideoProbeState('error')
                    setError('无法读取该视频的基础信息，请更换 MP4 或 MOV 文件后重试')
                  }
                  URL.revokeObjectURL(url)
                }
                probe.src = url
              }
              setError('')
            }}
          />
          <button
            className={`upload-dropzone w-full p-6 ${videoName ? 'has-file' : ''}`}
            type="button"
            onClick={() => inputRef.current?.click()}
          >
            <span>
              <span className="upload-icon" aria-hidden>{videoName ? '✓' : '↑'}</span>
              <strong className="block text-base text-[var(--text-primary)]">{videoName || '选择手机拍摄的比赛视频'}</strong>
              <span className="mt-2 block text-xs text-[var(--text-muted)]">
                {videoProbeState === 'probing' ? '正在读取视频信息…' : videoName ? '已读取本地文件信息 · 尚未上传' : '支持 MP4 / MOV · 上限 300MB、15 分钟'}
              </span>
            </span>
          </button>

          <div className="mt-3 text-center">
            <button className="text-sm text-[var(--ai)] hover:underline" type="button" onClick={() => { probeTokenRef.current += 1; if (inputRef.current) inputRef.current.value = ''; setSelectedFile(undefined); setVideoName('好球Ai_演示片段.mp4'); setVideoMeta({ sizeBytes: 0, durationSeconds: 20, width: 1280, height: 720 }); setVideoProbeState('ready'); setError('') }}>
              没有视频？使用演示片段
            </button>
          </div>

          {mode === 'instant' && videoProbeState === 'ready' && selectedFile && (
            <section className="mt-6 rounded-md border border-[var(--line)] bg-[var(--content)] p-4">
              <h2 className="text-base font-semibold text-[var(--text-primary)]">确认本场我方（推荐）</h2>
              <p className="mt-1 text-xs leading-5 text-[var(--text-muted)]">点击首帧中的任意一名我方球员。千问会把他所在一侧视为我方；这只是本场线索，不使用固定号码或固定球衣颜色。</p>
              {framePreview ? (
                <button type="button" className="relative mt-4 block w-full overflow-hidden rounded-md border border-[var(--line)] bg-black" onClick={(event) => {
                  const rect = event.currentTarget.getBoundingClientRect()
                  setOpeningFramePoint({ x: Math.max(0, Math.min(1, (event.clientX - rect.left) / rect.width)), y: Math.max(0, Math.min(1, (event.clientY - rect.top) / rect.height)) })
                }} aria-label="点击标记本场我方球员">
                  <img src={framePreview} alt="视频首帧，点击任意一名我方球员" className="block max-h-72 w-full object-contain" />
                  {openingFramePoint && <span className="pointer-events-none absolute h-7 w-7 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-[var(--ai)] bg-[var(--ai)]/20 shadow-[0_0_0_4px_rgba(101,214,176,.18)]" style={{ left: `${openingFramePoint.x * 100}%`, top: `${openingFramePoint.y * 100}%` }} />}
                </button>
              ) : <p className="mt-4 rounded-md border border-dashed border-[var(--line)] p-4 text-xs text-[var(--text-muted)]">正在提取视频首帧…</p>}
              <label className="field-label mt-4">我方球衣补充（可选）</label>
              <input className="input-base" value={jerseyHint} maxLength={80} onChange={(event) => setJerseyHint(event.target.value)} placeholder="例如：白色上衣、深色短裤；或只写“荧光训练背心”" />
              <p className={`mt-2 text-xs ${openingFramePoint ? 'text-[var(--ai)]' : 'text-[var(--text-muted)]'}`}>{openingFramePoint ? '已标记我方球员；会随本次视频提交。' : '未标记也可分析，但模型更难稳定区分我方与对方。'}</p>
            </section>
          )}

          {error && <p className="mt-5 text-sm text-[var(--danger)]">{error}</p>}
          <div className="mt-6">
            <button className="btn-primary w-full justify-center" type="button" disabled={!canStart} onClick={startReview}>
              {videoProbeState === 'probing' ? '正在读取视频信息…' : startLabel} {videoProbeState !== 'probing' && <span aria-hidden>→</span>}
            </button>
          </div>

          <details className="optional-details mt-5">
            <summary>补充比赛信息（可选）</summary>
            <div className="mt-5 grid gap-4 sm:grid-cols-2">
              <div>
                <label className="field-label">比赛日期</label>
                <input className="input-base" type="date" value={date} onChange={(event) => setDate(event.target.value)} />
              </div>
              <div>
                <label className="field-label">比赛类型</label>
                <select className="input-base" value={type} onChange={(event) => setType(event.target.value as MatchType)}>
                  {MATCH_TYPES.map((item) => <option key={item} value={item}>{item} · {MATCH_TYPE_DESC[item]}</option>)}
                </select>
              </div>
              <div>
                <label className="field-label">对手名称</label>
                <input className="input-base" placeholder="默认：对手" value={opponentName} onChange={(event) => setOpponentName(event.target.value)} />
              </div>
              <div>
                <label className="field-label">当前比分</label>
                <div className="grid grid-cols-[1fr_auto_1fr] items-center gap-2">
                  <input aria-label="我方比分" className="input-base text-center font-score" min={0} max={99} type="number" value={myScore} onChange={(event) => setMyScore(clampScore(event.target.value))} />
                  <span className="text-[var(--text-muted)]">—</span>
                  <input aria-label="对方比分" className="input-base text-center font-score" min={0} max={99} type="number" value={oppScore} onChange={(event) => setOppScore(clampScore(event.target.value))} />
                </div>
              </div>
            </div>
          </details>

          <p className="mt-4 text-center text-xs text-[var(--text-muted)]">文件只在选择真实分析后上传；演示复盘不上传视频。</p>
        </section>
      </div>
    </div>
  )
}
