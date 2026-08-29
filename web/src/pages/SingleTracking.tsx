import { useEffect, useMemo, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import type { CloudDetectionJob, SignedDetectionVideo } from '../cloudDetectionTypes'
import { createCloudDetectionJob, getCloudDetectionJob, getSignedDetectionVideo, isCloudDetectionConfigured } from '../lib/cloudDetectionApi'
import { ensureUploadedVideo, UPLOAD_PHASE_LABELS, type UploadPhase } from '../lib/cloudUploadWorkflow'
import { getCachedVideoFile } from '../lib/videoFileCache'
import { getMatch, saveMatch } from '../lib/storage'

// 分析中阶段轮播提醒：GPU 检测在跑完前不回报进度（常驻 0%），
// 用轮播小字告诉用户"确实在跑、别急"。
const ANALYZING_TIPS = [
  'AI 正在逐帧识别画面里的球员和球',
  '正在为你锁定主角位置',
  '正在生成带标注的比赛画面',
  '这段视频有点长，请稍候一下',
]

export default function SingleTracking() {
  const { id } = useParams()
  const initialMatch = useMemo(() => (id ? getMatch(id) : undefined), [id])
  const [job, setJob] = useState<CloudDetectionJob | undefined>(initialMatch?.trackingDetectionJob)
  const [phase, setPhase] = useState<UploadPhase>('ticket')
  const [uploadProgress, setUploadProgress] = useState(0)
  const [message, setMessage] = useState('')
  const [resultVideo, setResultVideo] = useState<SignedDetectionVideo>()
  const configured = isCloudDetectionConfigured()

  useEffect(() => {
    if (!initialMatch || !configured) return
    let cancelled = false
    let timer: number | undefined
    const match = initialMatch

    async function run() {
      try {
        const latest = getMatch(match.id) ?? match
        let jobId = latest.trackingJobId
        if (!jobId) {
          const file = getCachedVideoFile(match.id)
          if (!latest.cloudUploadId && !file) throw new Error('本地视频文件已在刷新后丢失，请重新选择视频。')
          const uploadId = await ensureUploadedVideo(match.id, file, (next, progress) => {
            if (!cancelled) { setPhase(next); setUploadProgress(progress) }
          })
          // 主角提示：优先用用户填的球衣线索，没有则交给 HAI 自动锁定最常被跟拍者
          const focusHint = latest.ourTeamContext?.jerseyHint?.trim()
            || (latest.players?.[0]?.jerseyColor ? `球衣颜色为 ${latest.players[0].jerseyColor}` : undefined)
            || (latest.players?.[0]?.number ? `${latest.players[0].number} 号` : undefined)
          const created = await createCloudDetectionJob(uploadId, match.id, 'single', focusHint)
          if (cancelled) return
          jobId = created.job_id
          setJob(created)
          saveMatch({ ...latest, cloudUploadId: uploadId, trackingJobId: jobId, trackingDetectionJob: created })
        }
        async function poll() {
          if (!jobId || cancelled) return
          const current = await getCloudDetectionJob(jobId)
          if (cancelled) return
          setJob(current)
          const currentMatch = getMatch(match.id) ?? match
          saveMatch({ ...currentMatch, trackingJobId: current.job_id, trackingDetectionJob: current })
          if (current.status === 'succeeded') {
            if (current.artifacts?.annotated_video_ready) {
              const signed = await getSignedDetectionVideo(current.job_id)
              if (!cancelled) setResultVideo(signed)
            }
            return
          }
          if (current.status !== 'failed') timer = window.setTimeout(poll, 2000)
        }
        await poll()
      } catch (error) {
        if (!cancelled) setMessage(error instanceof Error ? error.message : '单人跟拍任务创建失败，请重新选择视频。')
      }
    }
    void run()
    return () => { cancelled = true; if (timer) window.clearTimeout(timer) }
  }, [configured, initialMatch])

  if (!initialMatch) return <div className="page-shell grid place-items-center px-4"><section className="panel max-w-md p-6 text-center"><p className="text-[var(--text-secondary)]">找不到这段单人跟拍记录。</p><Link className="btn-primary mt-5" to="/match/new?mode=single">重新选择视频</Link></section></div>
  const matchRecord = initialMatch

  const gpuSuccess = job?.status === 'succeeded'
  const gpuFailed = job?.status === 'failed'

  // ── 统一三步骤模型 ──
  // 步骤① 上传视频 → 步骤② AI 分析（YOLO/GPU）→ 步骤③ 查看报告
  const hasUploadId = !!matchRecord.cloudUploadId || !!job
  const isUploading = !hasUploadId
  const isAnalyzing = hasUploadId && !gpuSuccess && !gpuFailed
  const isReportReady = gpuSuccess

  const unifiedProgress = isUploading ? uploadProgress : (job?.progress ?? 0)

  // 分析中轮播小字
  const [tipIndex, setTipIndex] = useState(0)
  useEffect(() => {
    if (!isAnalyzing) return
    const t = window.setInterval(() => setTipIndex((i) => (i + 1) % ANALYZING_TIPS.length), 2600)
    return () => window.clearInterval(t)
  }, [isAnalyzing])

  let stageLabel: string
  if (isUploading) {
    stageLabel = UPLOAD_PHASE_LABELS[phase]
  } else if (isAnalyzing) {
    if (!job) stageLabel = '正在准备分析任务'
    else if (job.status === 'queued') stageLabel = '正在排队等待分析'
    else stageLabel = ANALYZING_TIPS[tipIndex]
  } else {
    stageLabel = '分析完成'
  }

  // ── 报告数据（YOLO 客观检测）──
  // 主角标识：优先用 HAI 真实检测出的主角，否则显示用户提供的线索（标注为"指定"，说明只是辅助定位）
  const events = job?.events
  const focalPlayer = events?.focal_player
  const hasVerifiedFocal = Boolean(focalPlayer?.number || focalPlayer?.color)
  const focalHintRaw = matchRecord.ourTeamContext?.jerseyHint?.trim()
    || (matchRecord.players?.[0]?.jerseyColor ? `球衣${matchRecord.players[0].jerseyColor}` : '')
    || (matchRecord.players?.[0]?.number ? `${matchRecord.players[0].number} 号` : '')
  const focalBadge = hasVerifiedFocal
    ? { label: '主角', text: [focalPlayer?.number && `${focalPlayer.number}号`, focalPlayer?.color].filter(Boolean).join(' ') || '已锁定' }
    : focalHintRaw
      ? { label: '指定主角', text: focalHintRaw }
      : { label: '主角', text: '画面最常被跟拍的人' }

  const steps = [
    { key: 'upload', label: '上传视频', done: !isUploading, active: isUploading },
    { key: 'analyze', label: 'AI 分析', done: isReportReady, active: isAnalyzing },
    { key: 'report', label: '查看报告', done: isReportReady, active: isReportReady },
  ]

  return (
    <div className="page-shell px-4 py-10">
      <div className="mx-auto max-w-3xl">
        <header className="mb-8">
          <p className="eyebrow">个人比赛</p>
          <h1 className="mt-2 text-3xl font-semibold text-[var(--text-primary)]">
            {isReportReady ? '你的本场表现' : '正在分析你的表现'}
          </h1>
          <p className="mt-2 text-sm leading-6 text-[var(--text-muted)]">
            {isReportReady
              ? 'AI 已完成分析，以下是你的个人表现报告'
              : '请稍等，AI 正在为你生成个人复盘报告'}
          </p>
        </header>

        {/* ── 步骤条 ── */}
        {!isReportReady && (
          <div className="mb-8 flex items-center justify-between gap-2">
            {steps.map((step, idx) => (
              <div key={step.key} className="flex flex-1 items-center gap-2">
                <div className={`flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-full text-sm font-semibold transition ${
                  step.done
                    ? 'bg-[var(--ai)] text-white'
                    : step.active
                      ? 'bg-[var(--ai)]/15 text-[var(--ai)] ring-2 ring-[var(--ai)]/30'
                      : 'bg-[var(--surface-raised)] text-[var(--text-muted)]'
                }`}>
                  {step.done ? '✓' : idx + 1}
                </div>
                <span className={`text-sm font-medium transition ${
                  step.active ? 'text-[var(--text-primary)]' : step.done ? 'text-[var(--ai)]' : 'text-[var(--text-muted)]'
                }`}>{step.label}</span>
                {idx < steps.length - 1 && <div className={`mx-2 h-px flex-1 ${step.done ? 'bg-[var(--ai)]' : 'bg-[var(--line)'}`} />}
              </div>
            ))}
          </div>
        )}

        {/* ── 统一进度区 / 报告区 ── */}
        {!configured ? (
          <section className="panel p-6"><h2 className="text-lg font-semibold">分析暂时不可用</h2><Link className="btn-primary mt-5" to="/match/new?mode=single">重新选择视频</Link></section>
        ) : isReportReady ? (
          /* ── 步骤③：个人报告（YOLO 客观检测）── */
          <section className="panel p-5 sm:p-6">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <h2 className="text-xl font-semibold text-[var(--text-primary)]">你的本场表现</h2>
                <p className="mt-0.5 text-sm text-[var(--text-muted)]">{initialMatch.videoName}</p>
              </div>
              <span className="status-text"><span className="status-dot bg-emerald-500" />已完成</span>
            </div>

            {/* 主角标识：HAI 真实检测则标"主角"，否则标"指定主角"（仅用户线索） */}
            <div className="mt-4 inline-flex items-center gap-2 rounded-full border border-[var(--ai)] bg-[var(--ai)]/10 px-3 py-1 text-sm text-[var(--ai)]">
              {focalBadge.label}：{focalBadge.text}
            </div>

            {/* 事件统计：HAI 返回真实数据后自动展示；否则给出升级占位（不展示无意义的原始检测数） */}
            {events ? (
              <div className="personal-stats mt-5">
                <div className="personal-stat"><span className="personal-stat-value font-score">{events.touches ?? 0}</span><span className="personal-stat-label">触球</span></div>
                <div className="personal-stat"><span className="personal-stat-value font-score">{events.passes ?? 0}</span><span className="personal-stat-label">传球</span></div>
                <div className="personal-stat"><span className="personal-stat-value font-score">{events.shots ?? 0}</span><span className="personal-stat-label">射门</span></div>
                <div className="personal-stat"><span className="personal-stat-value font-score">{events.steals ?? 0}</span><span className="personal-stat-label">抢断</span></div>
                <div className="personal-stat"><span className="personal-stat-value font-score">{Math.round((events.possession_rate ?? 0) * 100)}%</span><span className="personal-stat-label">控球率</span></div>
              </div>
            ) : (
              <div className="mt-5 rounded-md border border-[var(--line)] bg-[var(--content)] p-4">
                <p className="text-sm font-medium text-[var(--text-secondary)]">事件统计正在升级</p>
                <p className="mt-1 text-xs leading-5 text-[var(--text-muted)]">
                  触球、传球、射门、抢断、控球率由 AI 逐帧识别得出，将在检测模型升级后自动补齐，无需重新上传视频。
                </p>
              </div>
            )}

            {/* 带标注比赛画面 */}
            {resultVideo ? (
              <div className="mt-4 rounded-md border border-[var(--line)] bg-[var(--content)] p-4">
                <p className="mb-3 text-sm font-semibold text-[var(--text-primary)]">带标注比赛画面</p>
                <video className="w-full rounded-md border border-[var(--line)] bg-black" controls preload="metadata" src={resultVideo.url} />
                <p className="mt-3 text-xs text-[var(--text-muted)]">AI 已为每帧画面标注球员与球的位置。</p>
              </div>
            ) : gpuSuccess ? (
              <p className="mt-4 text-sm text-[var(--text-muted)]">带标注画面正在准备…</p>
            ) : null}
          </section>
        ) : (
          /* ── 步骤①②：统一进度卡 ── */
          <section className="panel p-5 sm:p-6">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <p className="font-medium text-[var(--text-primary)]">{initialMatch.videoName}</p>
              </div>
              <span className="status-text">
                <span className="status-dot" />
                {isUploading ? '上传中' : gpuFailed ? '未完成' : '分析中'}
              </span>
            </div>

            {/* 进度条 */}
            <div className="mt-7 h-2.5 overflow-hidden rounded-full bg-[var(--surface-raised)]">
              <div
                className="h-full rounded-full bg-[var(--ai)] transition-[width] duration-500 ease-out"
                style={{ width: `${Math.max(0, Math.min(100, unifiedProgress))}%` }}
              />
            </div>
            <div className="mt-3 flex justify-between text-sm text-[var(--text-secondary)]">
              <span>{stageLabel}</span>
              <b className="font-score text-[var(--ai)]">{Math.round(unifiedProgress)}%</b>
            </div>

            {/* 阶段描述 */}
            {isUploading && (
              <p className="mt-3 text-xs text-[var(--text-muted)]">视频上传完成后，AI 将自动开始分析</p>
            )}
            {isAnalyzing && (
              <p className="mt-3 text-xs text-[var(--text-muted)]">AI 正在分析，完成后会自动展示你的报告</p>
            )}

            {/* 错误信息 */}
            {message && (
              <div className="mt-6 rounded-md border border-[var(--attack)] bg-[var(--content)] p-4 text-sm text-[var(--attack)]">
                {message}
                <div className="mt-4"><Link className="btn-secondary" to="/match/new?mode=single">重新选择视频</Link></div>
              </div>
            )}
            {gpuFailed && (
              <div className="mt-6 rounded-md border border-[var(--danger)] bg-[var(--content)] p-4">
                <p className="text-sm text-[var(--danger)]">{job?.error?.message || '视频标注没有完成'}</p>
              </div>
            )}
          </section>
        )}

        <div className="mt-8"><Link className="btn-secondary" to="/">返回功能选择</Link></div>
      </div>
    </div>
  )
}
