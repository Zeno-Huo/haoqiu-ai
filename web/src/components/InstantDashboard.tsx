import { useMemo, useState } from 'react'
import type { InstantAnalysisDashboard, InstantEvent, InstantPair, InstantPlayer } from '../lib/instantAnalysis'

/** 关键时刻只展示这几类高价值事件，传球太多且没有阅读价值。 */
const EVENT_LABEL: Record<string, string> = { goal: '进球', shot: '射门', tackle: '抢断', interception: '拦截', dispossessed: '被断球', turnover: '失误', dribble: '突破' }
const EVENT_ORDER = ['goal', 'shot', 'tackle', 'interception', 'dispossessed', 'turnover', 'dribble']

function pad(value: number): string {
  return String(value).padStart(2, '0')
}

/** 优先用画面记分牌读到的比赛时间；否则把视频内秒数格式化成 00:01:19。 */
function clockText(item: InstantEvent): string {
  if (item.clock) return item.clock
  if (item.time === undefined) return '--:--:--'
  const total = Math.max(0, Math.round(item.time))
  return `${pad(Math.floor(total / 3600))}:${pad(Math.floor((total % 3600) / 60))}:${pad(total % 60)}`
}

function eventKind(item: InstantEvent): string | undefined {
  const raw = String(item.type || '').trim().toLowerCase()
  return EVENT_ORDER.find((kind) => raw.includes(kind))
}

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
function ScoreLine({ dashboard, matchId }: { dashboard: InstantAnalysisDashboard; matchId?: string }) {
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

function PlayerCard({ player, rank }: { player: InstantPlayer; rank: number }) {
  const notes = player.insights.length ? player.insights : player.highlight?.note ? [player.highlight.note] : []
  return <article className={player.isMvp ? 'instant-player is-mvp' : 'instant-player'}>
    <header>
      <span>{player.number ? player.number : pad(rank)}</span>
      <div>
        <h3>{player.number ? `${player.number}号` : player.name || '焦点球员'}{player.name && player.number ? ` ${player.name}` : ''}</h3>
        {player.role && <p className="instant-player-role">{player.role}</p>}
      </div>
      {player.isMvp && <em className="instant-player-mvp">本场最佳</em>}
    </header>
    {notes.length
      ? <ul className="instant-player-notes">{notes.map((note, index) => <li key={index}>{note}</li>)}</ul>
      : <p className="instant-player-empty">这名球员只认出了号码，没看清具体表现。</p>}
    {player.tags.length > 0 && <div className="instant-player-tags">{player.tags.map((tag) => <span key={tag}>{tag}</span>)}</div>}
  </article>
}

function KeyMoments({ events }: { events: InstantEvent[] }) {
  const list = useMemo(() => events
    .map((item) => ({ item, kind: eventKind(item) }))
    .filter((row): row is { item: InstantEvent; kind: string } => Boolean(row.kind))
    .sort((a, b) => (a.item.time ?? 0) - (b.item.time ?? 0))
    .slice(0, 8), [events])
  if (!list.length) return <p className="instant-empty">这段视频里没有识别到明确的关键动作。</p>
  return <ol className="instant-moments">{list.map(({ item, kind }, index) => <li key={`${item.time ?? index}-${kind}-${index}`}>
    <b>{clockText(item)}</b>
    <i className={`instant-moment-kind is-${kind}`}>{EVENT_LABEL[kind]}</i>
    <span>{item.note || item.label || ''}</span>
  </li>)}</ol>
}

export default function InstantDashboard({ dashboard, matchId }: { dashboard: InstantAnalysisDashboard; matchId?: string }) {
  const summary = dashboard.summary
  // MVP 排前面，其次评语多的（内容更实）
  const players = [...dashboard.players]
    .sort((a, b) => Number(b.isMvp) - Number(a.isMvp) || b.insights.length - a.insights.length)
    .slice(0, 6)
  return <section className="instant-dashboard" aria-label="球队分析结果">
    <ScoreLine dashboard={dashboard} matchId={matchId} />
    <header className="instant-verdict"><span>一句话总评</span><h2>{summary.overall || summary.highlight || '这段比赛的重点已整理好。'}</h2></header>
    <section className="instant-focus-players">
      <header className="instant-section-head"><h2>焦点球员表现</h2><span>{players.length ? `${players.length} 人` : '暂无'}</span></header>
      {players.length
        ? <div className="instant-player-grid">{players.map((player, index) => <PlayerCard key={player.id} player={player} rank={index + 1} />)}</div>
        : <p className="instant-empty">这段视频没有看清任何球衣号码，建议换更近或更清晰的机位。</p>}
    </section>
    <section className="instant-priority-grid">
      <article className="is-good"><span>最大亮点</span><h3>{summary.highlight || '进攻推进更主动'}</h3></article>
      <article className="is-risk"><span>最大问题</span><h3>{summary.weakness || '丢球后的保护不足'}</h3></article>
    </section>
    <section className="instant-key-events"><header className="instant-section-head"><h2>关键时刻</h2><span>最多 8 条</span></header><KeyMoments events={dashboard.events} /></section>
    <article className="instant-recommendation"><span>下一阶段建议</span><p>{summary.recommendation || summary.focus || '继续观察下一阶段的场面变化。'}</p></article>
  </section>
}
