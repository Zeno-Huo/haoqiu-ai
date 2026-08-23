import { useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { createRng } from '../lib/seed'
import { getTeamProfile, newId, saveMatch } from '../lib/storage'
import { todayStr } from '../lib/utils'
import type { Match, MatchType, Player } from '../types'
import { MATCH_TYPES, MATCH_TYPE_DESC } from '../types'

function clampScore(raw: string): number {
  const value = Math.floor(Number(raw))
  if (!Number.isFinite(value)) return 0
  return Math.min(99, Math.max(0, value))
}

export default function MatchNew() {
  const navigate = useNavigate()
  const inputRef = useRef<HTMLInputElement>(null)
  const team = getTeamProfile()
  const [videoName, setVideoName] = useState('')
  const [videoMeta, setVideoMeta] = useState<Match['videoMeta']>()
  const [date, setDate] = useState(todayStr())
  const [type, setType] = useState<MatchType>('7v7')
  const [opponentName, setOpponentName] = useState('')
  const [myScore, setMyScore] = useState(0)
  const [oppScore, setOppScore] = useState(0)
  const [error, setError] = useState('')

  const canStart = Boolean(videoName)

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
      name: `${date} 球队复盘`,
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
      videoMeta,
      identificationStatus: 'pending',
      players,
      createdAt: Date.now(),
    }
    saveMatch(match)
    navigate(`/match/${id}/quality`, { replace: true })
  }

  return (
    <div className="page-shell px-4 py-10">
      <div className="mx-auto max-w-3xl">
        <header className="mb-7">
          <h1 className="text-3xl font-semibold text-[var(--text-primary)]">上传比赛视频</h1>
          <p className="mt-2 max-w-2xl text-sm leading-6 text-[var(--text-muted)]">
            选择一段球队视频，进入本地演示复盘流程；浏览器只读取文件信息，不上传视频，真实分析待接入。
          </p>
        </header>

        <section className="panel p-5 sm:p-6">
          <input
            ref={inputRef}
            className="sr-only"
            type="file"
            accept="video/*"
            onChange={(event) => {
              const file = event.target.files?.[0]
              setVideoName(file?.name ?? '')
              setVideoMeta(file ? { sizeBytes: file.size } : undefined)
              if (file) {
                const url = URL.createObjectURL(file)
                const probe = document.createElement('video')
                probe.preload = 'metadata'
                probe.onloadedmetadata = () => {
                  setVideoMeta({ sizeBytes: file.size, durationSeconds: probe.duration, width: probe.videoWidth, height: probe.videoHeight })
                  URL.revokeObjectURL(url)
                }
                probe.onerror = () => URL.revokeObjectURL(url)
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
                {videoName ? '已读取本地文件信息 · 下一步检查拍摄质量' : '支持常见视频格式 · 不会上传文件'}
              </span>
            </span>
          </button>

          <div className="mt-3 text-center">
            <button className="text-sm text-[var(--ai)] hover:underline" type="button" onClick={() => { setVideoName('好球Ai_演示片段.mp4'); setVideoMeta({ sizeBytes: 0, durationSeconds: 20, width: 1280, height: 720 }); setError('') }}>
              没有视频？使用演示片段
            </button>
          </div>

          {error && <p className="mt-5 text-sm text-[var(--danger)]">{error}</p>}
          <div className="mt-6">
            <button className="btn-primary w-full justify-center" type="button" disabled={!canStart} onClick={startReview}>
              下一步：检查视频 <span aria-hidden>→</span>
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

          <p className="mt-4 text-center text-xs text-[var(--text-muted)]">本地演示：只在本地记录文件信息；后续看板使用演示数据，真实分析待接入。</p>
        </section>
      </div>
    </div>
  )
}
