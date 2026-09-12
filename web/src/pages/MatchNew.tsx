import { useRef, useState } from 'react'
import VisualIcon from '../components/VisualIcon'
import '../visual-refresh.css'
import { Navigate, Link, useNavigate, useSearchParams } from 'react-router-dom'
import { getTeamProfile, newId, saveMatch } from '../lib/storage'
import { cacheVideoFile } from '../lib/videoFileCache'
import type { Match, Player } from '../types'


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
  const [jerseyHint, setJerseyHint] = useState('')
  const [singleJerseyHint, setSingleJerseyHint] = useState('')
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')

  if (!requestedMode) {
    return <Navigate to="/" replace />
  }

  if (requestedMode === 'personal') {
    return <div className="page-shell mode-page"><div className="mode-page-inner">
      <Link className="flow-back" to="/">← 首页</Link>
      <header className="mode-page-header"><h1>个人分析</h1><p>这段视频拍的是什么？</p></header>
      <section className="product-choice-grid">
        <Link to="/match/new?mode=single" className="product-choice"><span>01</span><strong>个人比赛</strong><b>看本场表现</b><p>关键片段、亮点、问题和本场称号</p><i>选择比赛 →</i></Link>
        <Link to="/match/new?mode=training" className="product-choice"><span>02</span><strong>个人训练</strong><b>看训练动作</b><p>动作评价和下一次练习建议</p><i>选择训练 →</i></Link>
      </section>
    </div></div>
  }

  if (!mode) return null
  if (mode === 'training') {
    return <div className="page-shell mode-page"><div className="mode-page-inner">
      <Link className="flow-back" to="/match/new?mode=personal">← 返回</Link>
      <header className="mode-page-header"><h1>个人训练</h1><p>动作评价和下一次练习建议</p></header>
      <section className="panel p-8 text-center">
        <p className="text-lg font-semibold text-[var(--text-primary)]">个人训练正在开发中</p>
        <p className="mt-2 text-sm leading-6 text-[var(--text-muted)]">目前先攻克团队模式和个人比赛的比赛分析，训练动作分析会在后续版本上线。</p>
        <Link className="btn-primary mt-6" to="/match/new?mode=personal">返回选择</Link>
      </section>
    </div></div>
  }
  const canStart = videoState === 'ready' && Boolean(videoName) &&
    (mode !== 'instant' || Boolean(jerseyHint.trim()))

  // 系统会自动压缩，所以这里只挡真正离谱的文件（1GB / 5 分钟）
  const HARD_MAX_BYTES = 1024 * 1024 * 1024
  const HARD_MAX_SECONDS = 5 * 60
  // 超过这个值会走云端压缩，提前告诉用户
  const AUTO_COMPRESS_BYTES = 150 * 1024 * 1024
  const AUTO_COMPRESS_SECONDS = 5 * 60

  function selectFile(file?: File) {
    const token = ++probeTokenRef.current
    setError('')
    setNotice('')
    if (!file) return
    setSelectedFile(undefined); setVideoName(''); setVideoMeta(undefined)
    if (!/\.(mp4|mov)$/i.test(file.name)) { setError('请选择 MP4 或 MOV 视频'); setVideoState('error'); return }
    if (file.size > HARD_MAX_BYTES) { setError('视频不能超过 1GB'); setVideoState('error'); return }
    setSelectedFile(file)
    setVideoName(file.name)
    setVideoMeta({ sizeBytes: file.size })
    setVideoState('probing')
    const url = URL.createObjectURL(file)
    const probe = document.createElement('video')
    probe.preload = 'metadata'
    probe.onloadedmetadata = () => {
      if (token !== probeTokenRef.current) return URL.revokeObjectURL(url)
      if (probe.duration > HARD_MAX_SECONDS) {
        setSelectedFile(undefined); setVideoName(''); setVideoMeta(undefined); setVideoState('error'); setError('内测阶段请选取 5 分钟以内的视频，推荐 2–5 分钟的精彩片段')
      } else {
        setVideoMeta({ sizeBytes: file.size, durationSeconds: probe.duration, width: probe.videoWidth, height: probe.videoHeight })
        if (file.size > AUTO_COMPRESS_BYTES || probe.duration > AUTO_COMPRESS_SECONDS) {
          setNotice('视频较大，上传后将自动压缩。内测阶段优先使用较短、清晰的片段。')
        }
        setVideoState('ready')
      }
      URL.revokeObjectURL(url)
    }
    probe.onerror = () => { if (token !== probeTokenRef.current) return URL.revokeObjectURL(url); setVideoState('error'); setError('视频读取失败，请换一个文件'); URL.revokeObjectURL(url) }
    probe.src = url
  }

  function start() {
    if (!canStart) return
    const id = newId('m')
    const hint = singleJerseyHint.trim()
    const numberMatch = hint.match(/\d+/)?.[0]
    const colorMatch = hint.match(/(红|蓝|白|黑|绿|黄|橙|紫|粉|灰|青)/)?.[0]
    const players: Player[] = Array.from({ length: 7 }, (_, index) => ({
      id: newId('p'),
      name: index === 0 && hint ? '主角' : `${index + 1}号球员`,
      number: index === 0 && numberMatch ? numberMatch : `${index + 1}`,
      position: index < 2 ? '前锋' : index < 5 ? '中场' : '后卫',
      jerseyColor: index === 0 ? colorMatch : undefined,
    }))
    const match: Match = {
      id,
      name: mode === 'instant' ? '团队模式' : '个人比赛分析',
      date: new Date().toISOString().slice(0, 10), type: '7v7', duration: videoMeta?.durationSeconds || 15 * 60,
      teamId: team.id, teamName: team.name, opponentName: '对手', myScore: 0, oppScore: 0,
      videoName, videoSource: selectedFile ? 'local-file' : 'demo', videoMeta,
      ourTeamContext: mode === 'instant'
        ? { jerseyHint: jerseyHint.trim() }
        : (hint ? { jerseyHint: hint } : undefined),
      identificationStatus: 'pending', players, createdAt: Date.now(),
      analysisMode: mode === 'single' ? 'single' : undefined,
    }
    saveMatch(match)
    if (selectedFile) cacheVideoFile(id, selectedFile)
    navigate(mode === 'instant' ? `/match/${id}/instant` : `/match/${id}/tracking`, { replace: true })
  }

  return <main className="vr-page vr-upload">
    <header className="vr-nav"><Link to={mode==='instant'?'/':'/match/new?mode=personal'} aria-label="返回"><VisualIcon name="back"/></Link><h1>上传视频</h1><span/></header>
    <div className="vr-upload-body">
      <input ref={inputRef} className="sr-only" type="file" accept=".mp4,.mov,video/mp4,video/quicktime" onChange={e=>selectFile(e.target.files?.[0])}/>
      <button className="vr-picker" onClick={()=>inputRef.current?.click()} type="button"><span className="vr-pitch" aria-hidden="true"><i/><b/></span><span className="vr-upload-icon"><VisualIcon name={videoState==='ready'?'check':'upload'}/></span><strong>{videoName || '选择视频'}</strong><span>{videoState==='probing'?'正在读取视频…':videoName?videoDuration(videoMeta?.durationSeconds):'MP4 / MOV · 推荐 2–5 分钟'}</span></button>
      <p className="vr-camera-note">高机位看得更全，平地拍摄可能有偏差</p>
      {videoState==='ready'&&<div className="vr-context"><label htmlFor="jersey-hint">{mode==='instant'?'哪边是我们？':'球衣提示（选填）'}</label><input id="jersey-hint" className="input-base" maxLength={60} value={mode==='instant'?jerseyHint:singleJerseyHint} onChange={e=>mode==='instant'?setJerseyHint(e.target.value):setSingleJerseyHint(e.target.value)} placeholder={mode==='instant'?'例如：白衣，开场在左侧':'例如：10号，红衣黑裤'}/></div>}
      {error&&<p className="flow-error" role="alert">{error}</p>}{!error&&notice&&<p className="vr-muted">{notice}</p>}
    </div><button className="vr-primary" disabled={!canStart} onClick={start}>开始分析<VisualIcon name="arrow"/></button>
  </main>
}
