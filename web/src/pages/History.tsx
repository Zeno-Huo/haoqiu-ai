import { useState } from 'react'
import { Link } from 'react-router-dom'
import { MATCH_KIND_LABEL, MATCH_STATUS_LABEL, matchKind, matchStatus, matchTarget } from '../lib/matchLink'
import { deleteMatch, listMatches } from '../lib/storage'
import { formatDate, formatDuration } from '../lib/utils'
import type { Match } from '../types'

export default function History() {
  const [matches, setMatches] = useState<Match[]>(() =>
    listMatches().sort((a, b) => b.createdAt - a.createdAt)
  )
  const [batchMode, setBatchMode] = useState(false)
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const doneCount = matches.filter((match) => matchStatus(match) === 'done').length

  function enterBatch() {
    // 进入批量模式默认全选，用户取消勾选要保留的那条即可
    setSelected(new Set(matches.map((m) => m.id)))
    setBatchMode(true)
  }

  function exitBatch() {
    setSelected(new Set())
    setBatchMode(false)
  }

  function toggleOne(id: string) {
    setSelected((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  function remove(match: Match) {
    if (!window.confirm(`删除「${match.videoName || match.name}」的往期分析记录？此操作不可撤销。`)) return
    deleteMatch(match.id)
    setMatches((list) => list.filter((item) => item.id !== match.id))
  }

  function removeSelected() {
    if (selected.size === 0) return
    if (!window.confirm(`确认删除选中的 ${selected.size} 场往期分析记录？此操作不可撤销。`)) return
    selected.forEach((id) => deleteMatch(id))
    setMatches((list) => list.filter((item) => !selected.has(item.id)))
    exitBatch()
  }

  return (
    <div className="page-shell mode-page">
      <div className="mode-page-inner">
        <header className="history-head">
          <Link to="/" className="history-back">← 首页</Link>
          <h1>往期分析</h1>
          <p>{matches.length ? `共 ${matches.length} 场 · ${doneCount} 场已完成` : '还没有任何往期分析记录'}</p>
          {matches.length > 0 && (
            <div className="history-tools">
              {!batchMode ? (
                <button className="btn-secondary" type="button" onClick={enterBatch}>批量删除</button>
              ) : (
                <>
                  <button className="btn-secondary" type="button" onClick={() => setSelected(new Set(matches.map((m) => m.id)))}>全选</button>
                  <button className="btn-secondary" type="button" onClick={() => setSelected(new Set())}>全不选</button>
                  <button className="btn-danger" type="button" disabled={selected.size === 0} onClick={removeSelected}>
                    删除选中（{selected.size}）
                  </button>
                  <button className="btn-secondary" type="button" onClick={exitBatch}>取消</button>
                </>
              )}
            </div>
          )}
        </header>

        {matches.length === 0 ? (
          <section className="history-empty">
            <h2>还没有往期分析</h2>
            <p>上传一段比赛视频，分析完成后会自动记录在这里。</p>
            <Link className="btn-primary" to="/match/new?mode=instant">上传视频开始分析</Link>
          </section>
        ) : (
          <div className="history-list">
            {matches.map((match) => {
              const kind = matchKind(match)
              const status = matchStatus(match)
              return (
                <article key={match.id} className={`history-card${batchMode ? ' is-batch' : ''}`}>
                  {batchMode && (
                    <label className="history-check" aria-label="选择该场">
                      <input type="checkbox" checked={selected.has(match.id)} onChange={() => toggleOne(match.id)} />
                    </label>
                  )}
                  <div className="history-card-main">
                    <h2>历史视频</h2>
                    <p className="history-meta">
                      {formatDate(match.date)} · {formatDuration(match.duration)}
                      {match.teamName ? ` · ${match.teamName}` : ''}
                    </p>
                  </div>
                  <div className="history-tags">
                    <span className={`history-kind is-${kind}`}>{MATCH_KIND_LABEL[kind]}</span>
                    <span className={`history-status is-${status}`}>{MATCH_STATUS_LABEL[status]}</span>
                  </div>
                  <div className="history-actions">
                    <Link className="btn-primary" to={matchTarget(match)}>查看往期分析</Link>
                    {!batchMode && <button className="btn-secondary" type="button" onClick={() => remove(match)}>删除</button>}
                  </div>
                </article>
              )
            })}
          </div>
        )}
      </div>
    </div>
  )
}
