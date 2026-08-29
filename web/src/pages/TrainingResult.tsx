import { useEffect, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import type { DetectionTrainingMetrics } from '../cloudDetectionTypes'
import { useDetectionFlow } from '../lib/useDetectionFlow'
import { getMatch } from '../lib/storage'

// 分析中轮播小字（与个人比赛同风格，文案改为训练语境）
const ANALYZING_TIPS = [
  'AI 正在逐帧识别你的训练动作',
  '正在统计本次训练的关键指标',
  '正在为你生成练习建议',
  '这段视频有点长，请稍候一下',
]

// 各训练项目报告的指标卡定义；HAI 返回 training 字段后按此渲染。
type MetricCard = { key: keyof DetectionTrainingMetrics; label: string; pct?: boolean }
const TRAINING_SCHEMAS: Record<string, MetricCard[]> = {
  '射门': [{ key: 'on_target', label: '射正' }, { key: 'success_rate', label: '射正率', pct: true }, { key: 'avg_power', label: '平均力量' }],
  '传球': [{ key: 'success', label: '成功传球' }, { key: 'success_rate', label: '成功率', pct: true }],
  '停球': [{ key: 'success', label: '成功停球' }, { key: 'success_rate', label: '停球成功率', pct: true }],
  '带球': [{ key: 'turns', label: '变向次数' }, { key: 'success_rate', label: '连贯率', pct: true }],
  '颠球': [{ key: 'best_streak', label: '最长连续' }, { key: 'reps', label: '总次数' }],
  '头球': [{ key: 'success', label: '成功争顶' }, { key: 'success_rate', label: '成功率', pct: true }],
  '变向过人': [{ key: 'turns', label: '变向次数' }, { key: 'success_rate', label: '过人成功率', pct: true }],
  '射门力量': [{ key: 'avg_power', label: '平均力量' }, { key: 'on_target', label: '射正' }],
}

export default function TrainingResult() {
  const { id } = useParams()
  const initialMatch = id ? getMatch(id) : undefined
  const trainingItem = initialMatch?.ourTeamContext?.trainingItem?.trim()
  const focusHint = initialMatch?.ourTeamContext?.jerseyHint?.trim()
  const flow = useDetectionFlow(id, { focusHint, trainingItem })
  const { job, resultVideo, configured, isUploading, isAnalyzing, isReportReady, gpuFailed, unifiedProgress, stageLabel, message } = flow

  const [tipIndex, setTipIndex] = useState(0)
  useEffect(() => {
    if (!isAnalyzing) return
    const t = window.setInterval(() => setTipIndex((i) => (i + 1) % ANALYZING_TIPS.length), 2600)
    return () => window.clearInterval(t)
  }, [isAnalyzing])

  if (!initialMatch) return <div className="page-shell grid place-items-center px-4"><section className="panel max-w-md p-6 text-center"><p className="text-[var(--text-secondary)]">找不到这段训练记录。</p><Link className="btn-primary mt-5" to="/match/new?mode=training">重新选择视频</Link></section></div>

  const training = job?.training
  const schema = (trainingItem && TRAINING_SCHEMAS[trainingItem]) || []

  const steps = [
    { key: 'upload', label: '上传视频', done: !isUploading, active: isUploading },
    { key: 'analyze', label: 'AI 分析', done: isReportReady, active: isAnalyzing },
    { key: 'report', label: '查看报告', done: isReportReady, active: isReportReady },
  ]

  return (
    <div className="page-shell px-4 py-10">
      <div className="mx-auto max-w-3xl">
        <header className="mb-8">
          <p className="eyebrow">个人训练</p>
          <h1 className="mt-2 text-3xl font-semibold text-[var(--text-primary)]">
            {isReportReady ? '你的训练报告' : '正在分析你的训练'}
          </h1>
          <p className="mt-2 text-sm leading-6 text-[var(--text-muted)]">
            {isReportReady
              ? `训练项目：${trainingItem || '未指定'} · AI 已完成分析`
              : `训练项目：${trainingItem || '未指定'} · 请稍候，AI 正在为你分析`}
          </p>
        </header>

        {!isReportReady && (
          <div className="mb-8 flex items-center justify-between gap-2">
            {steps.map((step, idx) => (
              <div key={step.key} className="flex flex-1 items-center gap-2">
                <div className={`flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-full text-sm font-semibold transition ${
                  step.done ? 'bg-[var(--ai)] text-white' : step.active ? 'bg-[var(--ai)]/15 text-[var(--ai)] ring-2 ring-[var(--ai)]/30' : 'bg-[var(--surface-raised)] text-[var(--text-muted)]'
                }`}>{step.done ? '✓' : idx + 1}</div>
                <span className={`text-sm font-medium transition ${step.active ? 'text-[var(--text-primary)]' : step.done ? 'text-[var(--ai)]' : 'text-[var(--text-muted)]'}`}>{step.label}</span>
                {idx < steps.length - 1 && <div className={`mx-2 h-px flex-1 ${step.done ? 'bg-[var(--ai)]' : 'bg-[var(--line)'}`} />}
              </div>
            ))}
          </div>
        )}

        {!configured ? (
          <section className="panel p-6"><h2 className="text-lg font-semibold">分析暂时不可用</h2><Link className="btn-primary mt-5" to="/match/new?mode=training">重新选择视频</Link></section>
        ) : isReportReady ? (
          <section className="panel p-5 sm:p-6">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <h2 className="text-xl font-semibold text-[var(--text-primary)]">你的训练报告</h2>
                <p className="mt-0.5 text-sm text-[var(--text-muted)]">{initialMatch.videoName}</p>
              </div>
              <span className="status-text"><span className="status-dot bg-emerald-500" />已完成</span>
            </div>

            <div className="mt-4 inline-flex items-center gap-2 rounded-full border border-[var(--ai)] bg-[var(--ai)]/10 px-3 py-1 text-sm text-[var(--ai)]">
              训练项目：{trainingItem || '未指定'}
            </div>

            {/* 训练专项指标：HAI 返回 training 字段后按项目渲染对应卡片 */}
            {training ? (
              <div className="personal-stats mt-5">
                {schema.length > 0 ? schema.map((card) => {
                  const raw = training[card.key] as number | null | undefined
                  if (raw === null || raw === undefined) return null
                  const display = card.pct ? `${Math.round((raw as number) * 100)}%` : String(raw)
                  return (
                    <div className="personal-stat" key={card.key}>
                      <span className="personal-stat-value font-score">{display}</span>
                      <span className="personal-stat-label">{card.label}</span>
                    </div>
                  )
                }) : (
                  <div className="personal-stat"><span className="personal-stat-value font-score">{training.reps ?? training.success ?? '—'}</span><span className="personal-stat-label">完成次数</span></div>
                )}
              </div>
            ) : (
              <div className="mt-5 rounded-md border border-[var(--line)] bg-[var(--content)] p-4">
                <p className="text-sm font-medium text-[var(--text-secondary)]">训练专项指标正在升级</p>
                <p className="mt-1 text-xs leading-5 text-[var(--text-muted)]">
                  按「{trainingItem || '该训练项目'}」统计的专项指标（射正 / 成功率 / 连续次数等）由 AI 逐帧识别得出，将在检测模型升级后自动补齐，无需重新上传视频。
                </p>
              </div>
            )}

            {/* 一句话练习建议（HAI 基于指标生成，真实不编） */}
            {training?.advice ? (
              <div className="mt-4 rounded-md border border-[var(--ai)]/30 bg-[var(--ai)]/5 p-4">
                <p className="text-sm font-semibold text-[var(--ai)]">下次只练这个</p>
                <p className="mt-1 text-sm leading-6 text-[var(--text-primary)]">{training.advice}</p>
              </div>
            ) : training ? (
              <p className="mt-4 text-xs text-[var(--text-muted)]">练习建议正在生成…</p>
            ) : null}

            {/* 带标注训练画面（看动作形态） */}
            {resultVideo ? (
              <div className="mt-4 rounded-md border border-[var(--line)] bg-[var(--content)] p-4">
                <p className="mb-3 text-sm font-semibold text-[var(--text-primary)]">带标注训练画面</p>
                <video className="w-full rounded-md border border-[var(--line)] bg-black" controls preload="metadata" src={resultVideo.url} />
                <p className="mt-3 text-xs text-[var(--text-muted)]">AI 已为每帧画面标注球员与球的位置，方便你回看动作形态。</p>
              </div>
            ) : null}
          </section>
        ) : (
          <section className="panel p-5 sm:p-6">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div><p className="font-medium text-[var(--text-primary)]">{initialMatch.videoName}</p></div>
              <span className="status-text"><span className="status-dot" />{isUploading ? '上传中' : gpuFailed ? '未完成' : '分析中'}</span>
            </div>
            <div className="mt-7 h-2.5 overflow-hidden rounded-full bg-[var(--surface-raised)]">
              <div className="h-full rounded-full bg-[var(--ai)] transition-[width] duration-500 ease-out" style={{ width: `${Math.max(0, Math.min(100, unifiedProgress))}%` }} />
            </div>
            <div className="mt-3 flex justify-between text-sm text-[var(--text-secondary)]">
              <span>{isAnalyzing ? ANALYZING_TIPS[tipIndex] : stageLabel}</span>
              <b className="font-score text-[var(--ai)]">{Math.round(unifiedProgress)}%</b>
            </div>
            {message && (
              <div className="mt-6 rounded-md border border-[var(--attack)] bg-[var(--content)] p-4 text-sm text-[var(--attack)]">
                {message}
                <div className="mt-4"><Link className="btn-secondary" to="/match/new?mode=training">重新选择视频</Link></div>
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
