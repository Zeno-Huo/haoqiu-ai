import { useState } from 'react'
import type { InstantAnalysisDashboard, InstantPair } from '../lib/instantAnalysis'

const SCORE_KEY = (matchId?: string) => `haoqiu.instant.score.${matchId || 'unknown'}`

function readManualScore(matchId?: string): InstantPair | undefined {
  try {
    const raw = localStorage.getItem(SCORE_KEY(matchId))
    if (!raw) return undefined
    const parsed = JSON.parse(raw) as InstantPair
    return typeof parsed?.home === 'number' && typeof parsed?.away === 'number' ? parsed : undefined
  } catch { return undefined }
}

/** 比分条：故意做得很轻。识别不到时允许用户自己补一个。 */
export default function MatchScoreLine({ dashboard, matchId }: { dashboard: InstantAnalysisDashboard; matchId?: string }) {
  const recognized = dashboard.score && (typeof dashboard.score.home === 'number' || typeof dashboard.score.away === 'number') ? dashboard.score : undefined
  const [manual, setManual] = useState<InstantPair | undefined>(() => readManualScore(matchId))
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState({ home: '', away: '' })
  const shownScore = recognized || manual

  function open() {
    setDraft({ home: String(manual?.home ?? ''), away: String(manual?.away ?? '') })
    setEditing(true)
  }

  function save() {
    const home = Number(draft.home)
    const away = Number(draft.away)
    if (!Number.isFinite(home) || !Number.isFinite(away) || draft.home === '' || draft.away === '') return
    const next = { home: Math.max(0, Math.round(home)), away: Math.max(0, Math.round(away)) }
    setManual(next)
    try { localStorage.setItem(SCORE_KEY(matchId), JSON.stringify(next)) } catch { /* 隐私模式下写不进去也不影响展示 */ }
    setEditing(false)
  }

  function clear() {
    setManual(undefined)
    try { localStorage.removeItem(SCORE_KEY(matchId)) } catch { /* 同上 */ }
    setEditing(false)
  }

  const hint = recognized ? (dashboard.scoreSource === 'scoreboard' ? '读自画面记分牌' : '据进球画面推算') : manual ? '你手动填写的' : '画面上没有记分牌'

  return <section className="instant-scoreline">
    <span className="instant-scoreline-label">比分</span>
    {shownScore ? <b className="instant-scoreline-value">{shownScore.home ?? '—'} : {shownScore.away ?? '—'}</b> : <b className="instant-scoreline-value is-unknown">未识别</b>}
    <span className="instant-scoreline-hint">{hint}</span>
    {editing
      ? <span className="instant-scoreline-edit">
          <input aria-label="我方进球" inputMode="numeric" value={draft.home} onChange={(e) => setDraft((d) => ({ ...d, home: e.target.value.replace(/\D/g, '').slice(0, 2) }))} />
          <i>:</i>
          <input aria-label="对方进球" inputMode="numeric" value={draft.away} onChange={(e) => setDraft((d) => ({ ...d, away: e.target.value.replace(/\D/g, '').slice(0, 2) }))} />
          <button type="button" onClick={save}>保存</button>
          {manual && <button type="button" onClick={clear}>清除</button>}
          <button type="button" onClick={() => setEditing(false)}>取消</button>
        </span>
      : !recognized && <button className="instant-scoreline-action" type="button" onClick={open}>{manual ? '修改' : '手动补充'}</button>}
  </section>
}
