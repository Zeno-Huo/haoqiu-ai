import { useRef, useState } from 'react'
import { useLocation, useNavigate, useSearchParams } from 'react-router-dom'
import { createRng } from '../lib/seed'
import { getTeamProfile, listMatches, newId, saveMatch } from '../lib/storage'
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
  const location = useLocation()
  const [searchParams] = useSearchParams()
  const mode = searchParams.get('mode')
  const inputRef = useRef<HTMLInputElement>(null)
  const probeTokenRef = useRef(0)
  const team = getTeamProfile()
  const incoming = location.state as { file?: File; videoMeta?: Match['videoMeta'] } | null
  const [videoName, setVideoName] = useState(incoming?.file?.name ?? '')
  const [selectedFile, setSelectedFile] = useState<File | undefined>(incoming?.file)
  const [videoProbeState, setVideoProbeState] = useState<'idle' | 'probing' | 'ready' | 'error'>(incoming?.file ? 'ready' : 'idle')
  const [videoMeta, setVideoMeta] = useState<Match['videoMeta']>(incoming?.videoMeta)
  const [jerseyHint, setJerseyHint] = useState('')
  const [date, setDate] = useState(todayStr())
  const [type, setType] = useState<MatchType>('7v7')
  const [opponentName, setOpponentName] = useState('')
  const [myScore, setMyScore] = useState(0)
  const [oppScore, setOppScore] = useState(0)
  const [error, setError] = useState('')
  const [selectedMode, setSelectedMode] = useState<'instant' | 'deep' | 'single' | 'training'>()
  const [videoSourceTab, setVideoSourceTab] = useState<'new' | 'previous'>('new')
  const [previousMatch, setPreviousMatch] = useState<Match>()
  const [targetNumber, setTargetNumber] = useState('')
  const [targetNickname, setTargetNickname] = useState('')
  const [targetClue, setTargetClue] = useState('')
  const [trainingAction, setTrainingAction] = useState('')
  const [reviewScope, setReviewScope] = useState('整场')

  const activeMode = mode || selectedMode
  const canStart = Boolean(videoName && videoProbeState === 'ready' && activeMode)
  const modeTitle = '选择视频'
  const modeHint = mode === 'instant'
    ? '横屏、画面稳定、能看到主要比赛区域即可。'
    : mode === 'deep'
    ? '横屏、画面稳定、能看到主要比赛区域即可。'
    : mode === 'single'
    ? '横屏、画面稳定、能看到主要比赛区域即可。'
    : '横屏、画面稳定、能看到主要比赛区域即可。'
  const startLabel = activeMode === 'instant' ? '开始分析' : activeMode === 'deep' ? '开始复盘' : activeMode === 'single' ? '开始跟拍' : activeMode === 'training' ? '开始分析' : '选择复盘方式'

  function startReview() {
    if (!videoName) {
      setError('请选择视频，或使用演示片段')
      return
    }
    if (activeMode === 'single' && !targetNumber.trim() && !targetNickname.trim() && !targetClue.trim()) { setError('请填写号码、昵称或画面线索至少一项'); return }
    if (activeMode === 'training' && !trainingAction) { setError('请选择训练动作'); return }
    if (previousMatch && !previousMatch.cloudUploadId && !previousMatch.instantJobId && !previousMatch.cloudJobId && !selectedFile) { setError('该视频文件不可用，请重新选择'); return }

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
      name: activeMode === 'single' ? `${date} 单人跟拍` : activeMode === 'training' ? `${date} 训练反馈` : `${date} 球队复盘`,
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
      cloudUploadId: previousMatch?.cloudUploadId,
      instantJobId: previousMatch?.instantJobId,
      cloudJobId: previousMatch?.cloudJobId,
      ourTeamContext: {
        teamName: team.name,
        jerseyHint: jerseyHint.trim() || undefined,
      },
      identificationStatus: 'pending',
      players,
      createdAt: Date.now(),
      analysisMode: activeMode === 'single' ? 'single' : undefined,
    }
    saveMatch(match)
    if (selectedFile) cacheVideoFile(id, selectedFile)
    if (activeMode === 'instant') navigate(`/match/${id}/instant`, { replace: true })
    else if (activeMode === 'training') navigate(`/match/${id}/training`, { replace: true })
    else if (activeMode === 'deep') navigate(`/match/${id}/detection`, { replace: true })
    else if (activeMode === 'single') navigate(`/match/${id}/tracking`, { replace: true })
    else navigate(`/match/${id}/analyzing`, { replace: true })
  }

  if (!mode && !incoming?.file) return <div className="page-shell mode-page"><div className="mode-page-inner"><header className="mode-page-header"><h1>选择分析模式</h1></header><section className="mode-picker mode-picker-standalone">{[['instant','◈','快速分析','推荐','赛中快速查看','3–5 分钟 · 球队重点'],['deep','◫','深度复盘','','赛后完整回看','完整时间线 · 预计更久'],['single','◎','个人追踪','','观察一名球员','个人片段 · 本场特点'],['training','⌁','训练模式','','单人动作反馈','短视频即可 · 练习提示']].map(([key,icon,title,badge,line,result]) => <button key={key} type="button" className="mode-choice-card" onClick={() => navigate(`/match/new?mode=${key}`)}><span className="mode-choice-icon" aria-hidden>{icon}</span><span className="mode-choice-top"><strong>{title}</strong>{badge && <em>{badge}</em>}</span><span className="mode-choice-line">{line} · {result}</span><span className="mode-choice-arrow" aria-hidden>→</span></button>)}</section></div></div>
  return (
    <div className="page-shell px-4 py-10">
      <div className="mx-auto max-w-3xl">
        <header className="mb-7">
          <h1 className="text-3xl font-semibold text-[var(--text-primary)]">{incoming?.file && !mode ? '选择复盘方式' : modeTitle}</h1>
          {(!incoming?.file || mode) && <p className="mt-2 max-w-2xl text-sm leading-6 text-[var(--text-muted)]">{modeHint}</p>}
        </header>

        <section className="panel p-5 sm:p-6">
          <div className="source-tabs" role="tablist" aria-label="选择视频来源"><button type="button" className={videoSourceTab === 'new' ? 'is-active' : ''} onClick={() => setVideoSourceTab('new')}>新视频</button><button type="button" className={videoSourceTab === 'previous' ? 'is-active' : ''} onClick={() => setVideoSourceTab('previous')}>过往视频</button></div>
          {videoSourceTab === 'previous' && <div className="previous-video-list">{listMatches().slice(0, 6).map((item) => <button key={item.id} type="button" className="previous-video-row" onClick={() => { setPreviousMatch(item); setVideoName(item.videoName || item.name); setVideoMeta(item.videoMeta); setVideoProbeState('ready'); setSelectedFile(undefined); setVideoSourceTab('previous'); setError('') }}><strong>{item.videoName || item.name}</strong><span>{item.date} · {item.videoMeta?.durationSeconds ? `${Math.floor(item.videoMeta.durationSeconds / 60)}分${Math.round(item.videoMeta.durationSeconds % 60)}秒` : '视频'}</span><b>选择</b></button>)}</div>}
          {videoSourceTab === 'new' && (<>
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
                setError('当前仅支持 MP4 或 MOV 视频')
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
          {videoName && incoming?.file ? <div className="selected-video-summary"><strong>{videoName}</strong><span>{videoMeta?.durationSeconds ? `${Math.floor(videoMeta.durationSeconds / 60)}分${Math.round(videoMeta.durationSeconds % 60)}秒` : '已选择视频'}</span><button type="button" className="text-sm text-[var(--ai)]" onClick={() => navigate('/')}>更换视频</button></div> : <button
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
          </button>}

          <div className="mt-3 text-center">
            <button className="text-sm text-[var(--ai)] hover:underline" type="button" onClick={() => { probeTokenRef.current += 1; if (inputRef.current) inputRef.current.value = ''; setSelectedFile(undefined); setVideoName('好球Ai_演示片段.mp4'); setVideoMeta({ sizeBytes: 0, durationSeconds: 20, width: 1280, height: 720 }); setVideoProbeState('ready'); setError('') }}>
              没有视频？使用演示片段
            </button>
          </div>

          {videoProbeState === 'ready' && !mode && !selectedMode && (
            <section className="mode-picker" aria-labelledby="mode-picker-title">
              <h2 id="mode-picker-title">选择复盘方式</h2>
              {[['instant','快速分析','推荐','适合赛中或中场快速查看','几分钟看到比分、控球、射门和球队重点'],['deep','深度复盘','','适合赛后完整复盘','查看事件时间线、关键片段和球队表现'],['single','个人追踪','','适合持续观察一名球员','查看个人片段、数据摘要和本场特点'],['training','训练模式','','适合单人训练和动作纠正','查看动作问题和下一次练习提示']].map(([key,title,badge,subtitle,desc]) => <button key={key} type="button" className="mode-choice-card" onClick={() => setSelectedMode(key as 'instant' | 'deep' | 'single' | 'training')}><span className="mode-choice-top"><strong>{title}</strong>{badge && <em>{badge}</em>}</span><span>{subtitle}</span><small>{desc}</small><b>{title}</b></button>)}
            </section>
          )}

          {videoProbeState === 'ready' && (Boolean(mode || selectedMode) && (
            <section className="mt-6 rounded-md border border-[var(--line)] bg-[var(--content)] p-4">
              {(activeMode === 'instant' || activeMode === 'deep') && <><label className="field-label mt-4">我方球衣补充（可选）</label><input className="input-base" value={jerseyHint} maxLength={80} onChange={(event) => setJerseyHint(event.target.value)} placeholder="例如：白色上衣、深色短裤" />{activeMode === 'deep' && <><label className="field-label mt-4">复盘范围（可选）</label><select className="input-base" value={reviewScope} onChange={(event) => setReviewScope(event.target.value)}><option>整场</option><option>上半场</option><option>下半场</option></select></>}</>}
              {activeMode === 'single' && <><label className="field-label">目标球员号码</label><input className="input-base" value={targetNumber} onChange={(event) => setTargetNumber(event.target.value)} placeholder="例如 10" /><label className="field-label mt-4">昵称</label><input className="input-base" value={targetNickname} onChange={(event) => setTargetNickname(event.target.value)} placeholder="号码或昵称至少填一项" /><label className="field-label mt-4">画面位置线索（可选）</label><input className="input-base" value={targetClue} onChange={(event) => setTargetClue(event.target.value)} placeholder="例如：靠近左侧边线" /></>}
              {activeMode === 'training' && <><label className="field-label">训练动作</label><select className="input-base" value={trainingAction} onChange={(event) => setTrainingAction(event.target.value)}><option value="">请选择</option><option>停球</option><option>传球</option><option>带球</option><option>射门</option></select><label className="field-label mt-4">惯用脚（可选）</label><select className="input-base"><option>不填写</option><option>左脚</option><option>右脚</option></select></>}
            </section>
          ))}

          {error && <p className="mt-5 text-sm text-[var(--danger)]">{error}</p>}
          {(Boolean(mode || selectedMode)) && <div className="mt-6">
            <button className="btn-primary w-full justify-center" type="button" disabled={!canStart} onClick={startReview}>
              {videoProbeState === 'probing' ? '正在读取视频信息…' : startLabel} {videoProbeState !== 'probing' && <span aria-hidden>→</span>}
            </button>
          </div>}

          <details className="optional-details mt-5" hidden={!Boolean(mode || selectedMode)}>
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

          <p className="mt-4 text-center text-xs text-[var(--text-muted)]">当前为本地演示流程，真实分析待接入。</p></>)}
        </section>
      </div>
    </div>
  )
}
