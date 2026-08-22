import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { newId, saveMatch } from '../lib/storage'
import { todayStr } from '../lib/utils'
import type { Match, MatchType, Player, Position } from '../types'
import { MATCH_TYPES, MATCH_TYPE_DESC, POSITIONS } from '../types'

interface RosterRow {
  id: string
  number: string
  name: string
  position: Position
}

interface FormState {
  name: string
  date: string
  type: MatchType
  teamName: string
  durationMin: number
  myScore: number
  oppScore: number
}

const SAMPLE: [string, string, Position][] = [
  ['9', '王强', '前锋'], ['7', '李伟', '前锋'], ['10', '张磊', '中场'],
  ['6', '刘洋', '中场'], ['8', '陈浩', '中场'], ['5', '赵明', '后卫'],
  ['11', '孙健', '后卫'], ['3', '周杰', '后卫'], ['12', '吴超', '中场'],
  ['2', '郑凯', '后卫'], ['4', '王磊', '前锋'], ['15', '李军', '前锋'],
]

const ROSTER_SIZE: Record<MatchType, number> = { '5v5': 6, '7v7': 8, '11v11': 12 }

function makeRows(count: number): RosterRow[] {
  return Array.from({ length: count }, () => ({ id: newId('r'), number: '', name: '', position: '中场' }))
}

/** 比分输入清洗：非数字/负数归 0，上限 99 */
function clampScore(raw: string): number {
  const n = Math.floor(Number(raw))
  if (!Number.isFinite(n)) return 0
  return Math.min(99, Math.max(0, n))
}

const STEPS = ['比赛信息', '我的球员名单']

export default function MatchNew() {
  const navigate = useNavigate()
  const [step, setStep] = useState(0)

  const [form, setForm] = useState<FormState>({
    name: '',
    date: todayStr(),
    type: '7v7',
    teamName: '',
    durationMin: 15,
    myScore: 0,
    oppScore: 0,
  })

  const [roster, setRoster] = useState<RosterRow[]>(() => makeRows(5))
  const [rosterError, setRosterError] = useState('')

  const infoValid =
    form.name.trim() !== '' && form.date !== '' && form.teamName.trim() !== '' && form.durationMin > 0

  function fillSample() {
    const size = ROSTER_SIZE[form.type]
    setRoster(SAMPLE.slice(0, size).map(([number, name, position]) => ({ id: newId('r'), number, name, position })))
    setRosterError('')
  }

  function submitRoster() {
    const players: Player[] = roster
      .filter((r) => r.number.trim() !== '' || r.name.trim() !== '')
      .map((r) => {
        if (r.number.trim() === '' || r.name.trim() === '') return null
        return { id: newId('p'), name: r.name.trim(), number: r.number.trim(), position: r.position }
      })
      .filter((p): p is Player => p !== null)

    if (players.length === 0) {
      setRosterError('请至少录入 1 名球员（号码与姓名都要填写）')
      return
    }
    const incomplete = roster.some((r) => (r.number.trim() === '') !== (r.name.trim() === ''))
    if (incomplete) {
      setRosterError('存在号码或姓名只填了一边的球员，请补全或清空该行')
      return
    }

    const match: Match = {
      id: newId('m'),
      name: form.name.trim(),
      date: form.date,
      type: form.type,
      duration: form.durationMin * 60,
      teamName: form.teamName.trim(),
      myScore: form.myScore,
      oppScore: form.oppScore,
      players,
      createdAt: Date.now(),
    }
    saveMatch(match)
    navigate(`/match/${match.id}/analyzing`, { replace: true })
  }

  return (
    <div className="mx-auto max-w-2xl px-4 py-8">
      {/* 步骤指示 */}
      <ol className="mb-8 flex items-center gap-2">
        {STEPS.map((s, i) => (
          <li key={s} className="flex flex-1 items-center gap-2">
            <span
              className={`grid h-7 w-7 shrink-0 place-items-center rounded-full text-xs font-bold ${
                i < step
                  ? 'bg-pitch-600 text-white'
                  : i === step
                    ? 'bg-pitch-700 text-white ring-4 ring-pitch-100'
                    : 'bg-slate-100 text-slate-400'
              }`}
            >
              {i < step ? '✓' : i + 1}
            </span>
            <span className={`hidden text-xs font-medium sm:block ${i === step ? 'text-slate-800' : 'text-slate-400'}`}>
              {s}
            </span>
            {i < STEPS.length - 1 && <span className="h-px flex-1 bg-slate-200" />}
          </li>
        ))}
      </ol>

      <h1 className="text-2xl font-bold text-slate-800">{STEPS[step]}</h1>
      <p className="mt-1 text-sm text-slate-500">
        {step === 0 && '填写比赛基本信息'}
        {step === 1 && '录入我的球员号码、姓名与位置'}
      </p>

      <div className="mt-6">
        {/* Step 1：比赛信息 */}
        {step === 0 && (
          <div className="card space-y-4 p-5">
            <div>
              <label className="mb-1.5 block text-sm font-medium text-slate-700">比赛名称</label>
              <input
                className="input-base"
                placeholder="如：周六夜 7v7 友谊赛"
                value={form.name}
                onChange={(e) => setForm({ ...form, name: e.target.value })}
              />
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="mb-1.5 block text-sm font-medium text-slate-700">比赛日期</label>
                <input
                  type="date"
                  className="input-base"
                  value={form.date}
                  onChange={(e) => setForm({ ...form, date: e.target.value })}
                />
              </div>
              <div>
                <label className="mb-1.5 block text-sm font-medium text-slate-700">比赛类型</label>
                <select
                  className="input-base"
                  value={form.type}
                  onChange={(e) => setForm({ ...form, type: e.target.value as MatchType })}
                >
                  {MATCH_TYPES.map((t) => (
                    <option key={t} value={t}>
                      {t} · {MATCH_TYPE_DESC[t]}
                    </option>
                  ))}
                </select>
              </div>
            </div>
            <div>
              <label className="mb-1.5 block text-sm font-medium text-pitch-700">我的队名</label>
              <input
                className="input-base ring-1 ring-pitch-100 focus:ring-pitch-300"
                placeholder="如：夜鹰队"
                value={form.teamName}
                onChange={(e) => setForm({ ...form, teamName: e.target.value })}
              />
            </div>
            <div>
              <label className="mb-1.5 block text-sm font-medium text-slate-700">比赛时长（分钟）</label>
              <input
                type="number"
                min={1}
                max={120}
                className="input-base"
                value={form.durationMin}
                onChange={(e) => setForm({ ...form, durationMin: Math.max(1, Number(e.target.value) || 1) })}
              />
              <p className="mt-1 text-xs text-slate-400">模拟阶段按此时长生成数据，不涉及真实视频上传</p>
            </div>
            <div>
              <label className="mb-1.5 block text-sm font-medium text-slate-700">比赛比分</label>
              <div className="flex items-center gap-3">
                <div className="flex-1">
                  <label className="mb-1 block text-xs text-slate-400">我方进球</label>
                  <input
                    type="number"
                    min={0}
                    max={99}
                    className="input-base text-center font-score text-lg font-bold tabular-nums"
                    value={form.myScore}
                    onChange={(e) => setForm({ ...form, myScore: clampScore(e.target.value) })}
                  />
                </div>
                <span className="mt-5 font-score text-2xl font-black text-slate-300">:</span>
                <div className="flex-1">
                  <label className="mb-1 block text-xs text-slate-400">对方进球</label>
                  <input
                    type="number"
                    min={0}
                    max={99}
                    className="input-base text-center font-score text-lg font-bold tabular-nums"
                    value={form.oppScore}
                    onChange={(e) => setForm({ ...form, oppScore: clampScore(e.target.value) })}
                  />
                </div>
              </div>
              <p className="mt-1 text-xs text-slate-400">用于看板比分、胜负标签与比赛总结</p>
            </div>
            <div className="flex justify-end pt-2">
              <button className="btn-primary" disabled={!infoValid} onClick={() => setStep(1)}>
                下一步：球员名单
              </button>
            </div>
          </div>
        )}

        {/* Step 2：我的球员名单 */}
        {step === 1 && (
          <div className="space-y-5">
            <div className="card p-5">
              <div className="mb-3 flex items-center justify-between">
                <h3 className="text-base font-bold text-pitch-700">{form.teamName || '我的球队'}</h3>
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={fillSample}
                    className="rounded-lg bg-slate-100 px-3 py-1.5 text-xs font-semibold text-slate-600 transition hover:bg-slate-200"
                  >
                    一键生成示例名单
                  </button>
                  <button
                    type="button"
                    onClick={() => setRoster([...roster, { id: newId('r'), number: '', name: '', position: '中场' }])}
                    className="rounded-lg bg-slate-100 px-3 py-1.5 text-xs font-semibold text-slate-600 transition hover:bg-slate-200"
                  >
                    + 添加
                  </button>
                </div>
              </div>
              <div className="space-y-2">
                {roster.map((row, idx) => (
                  <div key={row.id} className="flex items-center gap-2">
                    <input
                      className="input-base w-16 text-center"
                      placeholder="号码"
                      value={row.number}
                      onChange={(e) => {
                        const next = [...roster]
                        next[idx] = { ...row, number: e.target.value }
                        setRoster(next)
                      }}
                    />
                    <input
                      className="input-base flex-1"
                      placeholder="姓名"
                      value={row.name}
                      onChange={(e) => {
                        const next = [...roster]
                        next[idx] = { ...row, name: e.target.value }
                        setRoster(next)
                      }}
                    />
                    <select
                      className="input-base w-20 shrink-0"
                      value={row.position}
                      aria-label="球员位置"
                      onChange={(e) => {
                        const next = [...roster]
                        next[idx] = { ...row, position: e.target.value as Position }
                        setRoster(next)
                      }}
                    >
                      {POSITIONS.map((p) => (
                        <option key={p} value={p}>
                          {p}
                        </option>
                      ))}
                    </select>
                    <button
                      type="button"
                      onClick={() => setRoster(roster.filter((_, i) => i !== idx))}
                      className="grid h-9 w-9 shrink-0 place-items-center rounded-lg text-slate-300 transition hover:bg-red-50 hover:text-red-500"
                      aria-label="删除该球员"
                    >
                      ✕
                    </button>
                  </div>
                ))}
              </div>
            </div>

            {rosterError && (
              <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-600">{rosterError}</div>
            )}

            <div className="flex justify-between pt-2">
              <button className="btn-secondary" onClick={() => setStep(0)}>
                ← 上一步
              </button>
              <button className="btn-primary" onClick={submitRoster}>
                生成看板 →
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
