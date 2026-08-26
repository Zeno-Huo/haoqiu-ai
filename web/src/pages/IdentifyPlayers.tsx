import { useMemo, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { getMatch, getTeamProfile, saveMatch } from '../lib/storage'

export default function IdentifyPlayers() {
  const { id } = useParams()
  const navigate = useNavigate()
  const match = useMemo(() => (id ? getMatch(id) : undefined), [id])
  const team = getTeamProfile()
  const [expanded, setExpanded] = useState(false)
  const [mapping, setMapping] = useState<Record<string, string>>(() => match?.playerIdentityMap ?? {})

  if (!match) {
    return <div className="page-shell px-4 py-16 text-center"><p className="text-[var(--text-muted)]">没有找到这场比赛。</p><Link className="mt-4 inline-block text-[var(--ai)]" to="/">返回首页</Link></div>
  }

  let noNumberIndex = 0
  const candidates = match.players.map((player) => {
    const visibleNumber = player.number?.trim() && player.number !== '?' ? player.number.trim() : ''
    if (!visibleNumber) noNumberIndex += 1
    return { player, label: visibleNumber ? `${visibleNumber}号球员` : `无号码球衣${noNumberIndex}` }
  })
  const summary = candidates.map((candidate) => candidate.label).join('、')
  const confirmedCount = Object.values(mapping).filter(Boolean).length
  const selectedByOthers = (candidateId: string, memberId: string) =>
    Object.entries(mapping).some(([id, selected]) => id !== candidateId && selected === memberId)

  function confirm() {
    if (!match) return
    const players = match.players.map((candidate) => {
      const member = team.members.find((item) => item.id === mapping[candidate.id])
      if (!member) return candidate
      return {
        ...candidate,
        name: member.nickname?.trim() || member.name,
        number: candidate.number !== '?' ? candidate.number : (member.commonNumber?.trim() || candidate.number),
        position: member.preferredPosition,
      }
    })
    const confirmed = Object.fromEntries(Object.entries(mapping).filter(([, memberId]) => Boolean(memberId)))
    saveMatch({ ...match, players, identificationStatus: 'confirmed', playerIdentityMap: confirmed })
    navigate(`/match/${match.id}`, { replace: true })
  }

  function skip() {
    if (!match) return
    saveMatch({ ...match, identificationStatus: 'skipped' })
    navigate(`/match/${match.id}`, { replace: true })
  }

  return (
    <div className="page-shell px-4 py-10">
      <div className="mx-auto max-w-2xl">
        <header className="mb-7">
          <p className="status-text mb-3"><span className="status-dot" />球队复盘已生成</p>
          <h1 className="text-3xl font-semibold text-[var(--text-primary)]">补充球员标注</h1>
          <p className="mt-2 max-w-xl text-sm leading-6 text-[var(--text-muted)]">
            号码由 AI 从画面中整理，仅作为确认线索，不代表已经识别出球员身份。
          </p>
        </header>

        <section className="panel p-5 sm:p-6">
          <p className="text-xs text-[var(--text-muted)]">{match.videoName || match.name} · 本地模拟识别</p>
          <h2 className="mt-3 text-lg font-semibold text-[var(--text-primary)]">识别到 {candidates.length} 名球员</h2>
          <p className="mt-2 text-sm leading-6 text-[var(--text-secondary)]">{summary}</p>

          {!expanded && (
            <button className="btn-primary mt-6 w-full justify-center" type="button" onClick={() => setExpanded(true)}>
              补充球员标注 <span aria-hidden>→</span>
            </button>
          )}

          {expanded && (
            <div className="mt-6 border-t border-[var(--line)] pt-2">
              {team.members.length ? candidates.map(({ player, label }) => (
                <div className="candidate-compact" key={player.id}>
                  <label htmlFor={`candidate-${player.id}`}>{label}</label>
                  <select
                    id={`candidate-${player.id}`}
                    className="input-base"
                    value={mapping[player.id] ?? ''}
                    onChange={(event) => setMapping((current) => ({ ...current, [player.id]: event.target.value }))}
                  >
                    <option value="">暂不标注</option>
                    {team.members.map((member) => (
                      <option key={member.id} value={member.id} disabled={selectedByOthers(player.id, member.id)}>
                        {member.nickname || member.name}{member.nickname ? ` · ${member.name}` : ''}{member.commonNumber ? ` · 常用${member.commonNumber}号` : ''}
                      </option>
                    ))}
                  </select>
                </div>
              )) : (
                <p className="py-6 text-sm leading-6 text-[var(--text-muted)]">
                  还没有球队成员。可以<Link className="mx-1 text-[var(--ai)]" to="/team">先添加成员</Link>，或暂不标注直接查看复盘。
                </p>
              )}

              {team.members.length > 0 && (
                <button className="btn-primary mt-4 w-full justify-center" type="button" onClick={confirm} disabled={!confirmedCount}>
                  {confirmedCount ? `保存 ${confirmedCount} 名标注并查看复盘` : '至少标注一名球员'} <span aria-hidden>→</span>
                </button>
              )}
            </div>
          )}

          <button className="mt-4 w-full py-2 text-sm text-[var(--text-secondary)] hover:text-[var(--text-primary)]" type="button" onClick={skip}>
            暂不标注，查看复盘
          </button>
        </section>

        <p className="mt-5 text-xs leading-5 text-[var(--text-muted)]">
          当前 Demo 不会真实识别身份，也不会生成或保存视频切片；确认结果只记录候选人与球队成员的对应关系。
        </p>
      </div>
    </div>
  )
}
