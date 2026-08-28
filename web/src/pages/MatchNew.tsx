import { useRef, useState } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router-dom'
import { getTeamProfile, listMatches, newId, saveMatch } from '../lib/storage'
import { cacheVideoFile } from '../lib/videoFileCache'
import type { Match, Player } from '../types'

type AnalysisMode = 'instant' | 'single' | 'training'

const MODE_COPY: Record<AnalysisMode, { title: string; subtitle: string; start: string }> = {
  instant: { title: '即时分析', subtitle: '上传比赛视频，快速看懂球队表现', start: '立即分析' },
  single: { title: '个人比赛', subtitle: '找到你，看看这场踢得怎么样', start: '分析个人表现' },
  training: { title: '个人训练', subtitle: '上传短视频，获得一个明确练习建议', start: '分析训练动作' },
}

function videoDuration(seconds?: number) {
  if (!seconds) return '视频'
  return `${Math.floor(seconds / 60)}分${Math.round(seconds % 60)}秒`
}

export default function MatchNew() {
  const navigate = useNavigate()
  const [searchParams] = useSearchParams()
  const requestedMode = searchParams.get('mode')
  const mode = (requestedMode === 'instant' || requestedMode === 'single' || requestedMode === 'training') ? requestedMode : undefined
  const inputRef = useRef<HTMLInputElement>(null)
  const probeTokenRef = useRef(0)
  const team = getTeamProfile()
  const [videoName, setVideoName] = useState('')
  const [selectedFile, setSelectedFile] = useState<File>()
  const [videoMeta, setVideoMeta] = useState<Match['videoMeta']>()
  const [videoState, setVideoState] = useState<'idle' | 'probing' | 'ready' | 'error'>('idle')
  const [source, setSource] = useState<'new' | 'previous'>('new')
  const [previousMatch, setPreviousMatch] = useState<Match>()
  const [jerseyHint, setJerseyHint] = useState('')
  const [targetNumber, setTargetNumber] = useState('')
  const [targetNickname, setTargetNickname] = useState('')
  const [trainingAction, setTrainingAction] = useState('')
  const [error, setError] = useState('')

  if (!requestedMode) {
    return <div className="page-shell mode-page"><div className="mode-page-inner">
      <header className="mode-page-header"><h1>你想看什么？</h1><p>先选球队，还是自己。</p></header>
      <section className="product-choice-grid">
        <Link to="/match/new?mode=instant" className="product-choice is-primary"><span>01</span><strong>即时分析</strong><b>看球队</b><p>几分钟看懂场面、亮点和问题</p><i>立即分析 →</i></Link>
        <Link to="/match/new?mode=personal" className="product-choice"><span>02</span><strong>个人分析</strong><b>看自己</b><p>分析你的比赛表现或训练动作</p><i>分析自己 →</i></Link>
      </section>
    </div></div>
  }

  if (requestedMode === 'personal') {
    return <div className="page-shell mode-page"><div className="mode-page-inner">
      <Link className="flow-back" to="/match/new">← 返回</Link>
      <header className="mode-page-header"><h1>个人分析</h1><p>这段视频拍的是什么？</p></header>
      <section className="product-choice-grid">
        <Link to="/match/new?mode=single" className="product-choice"><span>01</span><strong>个人比赛</strong><b>看本场表现</b><p>关键片段、亮点、问题和本场称号</p><i>选择比赛 →</i></Link>
        <Link to="/match/new?mode=training" className="product-choice"><span>02</span><strong>个人训练</strong><b>看训练动作</b><p>动作评价和下一次练习建议</p><i>选择训练 →</i></Link>
      </section>
    </div></div>
  }

  if (!mode) return null
  const modeCopy = MODE_COPY[mode]
  const canStart = videoState === 'ready' && Boolean(videoName) &&
    (mode !== 'instant' || Boolean(jerseyHint.trim())) &&
    (mode !== 'single' || Boolean(targetNumber.trim() || targetNickname.trim())) &&
    (mode !== 'training' || Boolean(trainingAction))

  function selectPrevious(item: Match) {
    setPreviousMatch(item)
    setVideoName(item.videoName || item.name)
    setVideoMeta(item.videoMeta)
    setSelectedFile(undefined)
    setVideoState('ready')
    setError('')
  }

  function selectFile(file?: File) {
    const token = ++probeTokenRef.current
    setError('')
    if (!file) return
    if (!/\.(mp4|mov)$/i.test(file.name)) { setError('请选择 MP4 或 MOV 视频'); setVideoState('error'); return }
    if (file.size > 300 * 1024 * 1024) { setError('视频不能超过 300MB'); setVideoState('error'); return }
    setSelectedFile(file)
    setPreviousMatch(undefined)
    setVideoName(file.name)
    setVideoMeta({ sizeBytes: file.size })
    setVideoState('probing')
    const url = URL.createObjectURL(file)
    const probe = document.createElement('video')
    probe.preload = 'metadata'
    probe.onloadedmetadata = () => {
      if (token !== probeTokenRef.current) return URL.revokeObjectURL(url)
      if (probe.duration > 15 * 60) {
        setSelectedFile(undefined); setVideoName(''); setVideoMeta(undefined); setVideoState('error'); setError('请上传 15 分钟以内的视频')
      } else {
        setVideoMeta({ sizeBytes: file.size, durationSeconds: probe.duration, width: probe.videoWidth, height: probe.videoHeight })
        setVideoState('ready')
      }
      URL.revokeObjectURL(url)
    }
    probe.onerror = () => { setVideoState('error'); setError('视频读取失败，请换一个文件'); URL.revokeObjectURL(url) }
    probe.src = url
  }

  function start() {
    if (!canStart) return
    const id = newId('m')
    const players: Player[] = Array.from({ length: 7 }, (_, index) => ({
      id: newId('p'),
      name: index === 0 && targetNickname.trim() ? targetNickname.trim() : `${index + 1}号球员`,
      number: index === 0 && targetNumber.trim() ? targetNumber.trim() : `${index + 1}`,
      position: index < 2 ? '前锋' : index < 5 ? '中场' : '后卫',
    }))
    const match: Match = {
      id,
      name: mode === 'instant' ? '球队即时分析' : mode === 'single' ? '个人比赛分析' : '个人训练分析',
      date: new Date().toISOString().slice(0, 10), type: '7v7', duration: videoMeta?.durationSeconds || 15 * 60,
      teamId: team.id, teamName: team.name, opponentName: '对手', myScore: 0, oppScore: 0,
      videoName, videoSource: selectedFile ? 'local-file' : 'demo', videoMeta,
      cloudUploadId: previousMatch?.cloudUploadId, instantJobId: previousMatch?.instantJobId, cloudJobId: previousMatch?.cloudJobId,
      ourTeamContext: mode === 'instant' ? { jerseyHint: jerseyHint.trim() } : undefined,
      identificationStatus: 'pending', players, createdAt: Date.now(), analysisMode: mode === 'single' ? 'single' : undefined,
    }
    saveMatch(match)
    if (selectedFile) cacheVideoFile(id, selectedFile)
    navigate(mode === 'instant' ? `/match/${id}/instant` : mode === 'single' ? `/match/${id}/tracking` : `/match/${id}/training`, { replace: true })
  }

  return <div className="page-shell px-4 py-8"><div className="mx-auto max-w-2xl">
    <Link className="flow-back" to={mode === 'instant' ? '/match/new' : '/match/new?mode=personal'}>← 返回</Link>
    <header className="flow-header"><h1>{modeCopy.title}</h1><p>{modeCopy.subtitle}</p></header>
    <section className="panel p-5 sm:p-6">
      <div className="source-tabs"><button type="button" className={source === 'new' ? 'is-active' : ''} onClick={() => setSource('new')}>新视频</button><button type="button" className={source === 'previous' ? 'is-active' : ''} onClick={() => setSource('previous')}>历史视频</button></div>
      {source === 'new' ? <>
        <input ref={inputRef} className="sr-only" type="file" accept=".mp4,.mov,video/mp4,video/quicktime" onChange={(event) => selectFile(event.target.files?.[0])} />
        <button className={`upload-dropzone w-full p-6 ${videoName ? 'has-file' : ''}`} type="button" onClick={() => inputRef.current?.click()}><span><span className="upload-icon">{videoName ? '✓' : '↑'}</span><strong className="block text-base text-[var(--text-primary)]">{videoName || '选择视频'}</strong><span className="mt-2 block text-xs text-[var(--text-muted)]">{videoState === 'probing' ? '正在读取视频…' : videoName ? videoDuration(videoMeta?.durationSeconds) : 'MP4 / MOV · 最长15分钟'}</span></span></button>
      </> : <div className="previous-video-list">{listMatches().slice(0, 6).map((item) => <button key={item.id} type="button" className={`previous-video-row ${previousMatch?.id === item.id ? 'is-selected' : ''}`} onClick={() => selectPrevious(item)}><strong>{item.videoName || item.name}</strong><span>{videoDuration(item.videoMeta?.durationSeconds)}</span><b>选择</b></button>)}</div>}

      {videoState === 'ready' && <div className="analysis-min-fields">
        {mode === 'instant' && <><label className="field-label">哪边是我们？</label><input className="input-base" value={jerseyHint} maxLength={60} onChange={(event) => setJerseyHint(event.target.value)} placeholder="例如：白衣，画面左侧" /><p>告诉 AI 我方球衣或开场位置</p></>}
        {mode === 'single' && <div className="grid gap-4 sm:grid-cols-2"><div><label className="field-label">球衣号码</label><input className="input-base" value={targetNumber} onChange={(event) => setTargetNumber(event.target.value)} placeholder="例如：10" /></div><div><label className="field-label">昵称</label><input className="input-base" value={targetNickname} onChange={(event) => setTargetNickname(event.target.value)} placeholder="任选一项" /></div></div>}
        {mode === 'training' && <><label className="field-label">训练动作</label><div className="action-options">{['停球','传球','带球','射门'].map((action) => <button type="button" key={action} className={trainingAction === action ? 'is-active' : ''} onClick={() => setTrainingAction(action)}>{action}</button>)}</div></>}
      </div>}
      {error && <p className="flow-error">{error}</p>}
      <button className="btn-primary mt-6 w-full" type="button" disabled={!canStart} onClick={start}>{modeCopy.start} →</button>
    </section>
  </div></div>
}
