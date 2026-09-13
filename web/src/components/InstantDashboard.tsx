import { useEffect, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import type { InstantAnalysisDashboard } from '../lib/instantAnalysis'
import { exportMatchPoster } from '../lib/exportMatchPoster'
import FootballNetwork from './FootballNetwork'
import PerformanceRadar from './PerformanceRadar'
import VisualIcon from './VisualIcon'
import '../visual-refresh.css'

export type ReportMode = 'team' | 'personal'
const scoreText = (n?: number) => n == null || !Number.isFinite(n) || n < 0 || n > 10 ? '—' : n.toFixed(1)
function Copy({text}:{text:string}) {return text.length>48?<details className="vr-copy"><summary>{text.slice(0,44)}… <span>展开</span></summary><p>{text}</p></details>:<p>{text}</p>}
export default function InstantDashboard({dashboard,mode='team',focusHint,preview=false}:{dashboard:InstantAnalysisDashboard;matchId?:string;mode?:ReportMode;focusHint?:string;preview?:boolean}) {
 const personal=mode==='personal'
 const hinted=focusHint?.match(/\d+/)?.[0]
 const initial=dashboard.players.find(p=>hinted&&p.number===hinted) || dashboard.players.find(p=>p.isMvp) || dashboard.players[0]
 const [selected,setSelected]=useState(initial?.id || '')
 const player=dashboard.players.find(p=>p.id===selected)
 const isTarget=player?.id===initial?.id
 const title=personal?'个人比赛':'球队比赛'
 const headline=(personal&&!isTarget?player?.insights[0]:dashboard.summary.overall) || '本次暂无分析总结'
 const highlight=personal?player?.strength || player?.highlight?.note || (isTarget?dashboard.summary.highlight:undefined) || player?.insights[0]:dashboard.summary.highlight

 const advice=personal?player?.techniques?.find(t=>t.advice)?.advice || (isTarget?dashboard.summary.recommendation || dashboard.summary.focus:undefined):dashboard.summary.recommendation || dashboard.summary.focus
 const rating=personal?player?.score:dashboard.teamAverage
 const dimensions=[['进攻',player?.ratings?.attack],['传球',player?.ratings?.passing],['防守',player?.ratings?.defense],['跑动',player?.ratings?.running],['对抗',player?.ratings?.duels]] as const
 const [poster,setPoster]=useState<string>();const [feedback,setFeedback]=useState('');const dialog=useRef<HTMLDialogElement>(null)
 useEffect(()=>{if(!poster)return;dialog.current?.showModal();return()=>URL.revokeObjectURL(poster)},[poster])
 async function share(){try{const blob=await exportMatchPoster({title,target:personal?`${player?.number||'号码未确认'} · 本场表现`:'球队表现',score:scoreText(rating),headline,highlight:highlight||'本次未识别到明确亮点',advice:advice||'本次暂无调整建议',stats:personal?dimensions.map(([label,value])=>({label,value:scoreText(value)})):[],preview});setPoster(URL.createObjectURL(blob))}catch{setFeedback('图片生成失败，请先截图保存。')}}
 return <main className={`vr-page vr-report ${personal?'report-personal':'report-team'}`}>
  <header className="vr-nav"><Link to="/" aria-label="返回首页"><VisualIcon name="back"/></Link><h1>{title}</h1><button onClick={()=>void share()} aria-label="分享战报"><VisualIcon name="share"/></button></header>
  {preview&&<p className="vr-preview-label">设计预览 · 示例数据</p>}
  <section className={`vr-hero ${personal?'is-personal':'is-team'}`}>
   <div className="vr-network-art"><FootballNetwork variant={personal?'ball':'staticPitch'}/></div>
   <div className="vr-score"><p>{personal?`${player?.number?`${player.number}号`:'号码未确认'} · 本场表现`:'球队评分'}</p><b>{scoreText(rating)}</b>{personal&&<span>综合评分</span>}</div>
   <div className="vr-summary">{personal&&<span>AI 分析总结</span>}<Copy text={headline}/></div>
  </section>
  {personal&&dashboard.players.length>1&&<label className="vr-player-select">本场球员<select value={selected} onChange={e=>setSelected(e.target.value)}>{dashboard.players.map(p=><option key={p.id} value={p.id}>{p.number?`${p.number}号`:'号码未确认'} {p.role}</option>)}</select></label>}
  {personal&&player?.unconfirmedNumber&&<p className="vr-muted">号码未确认，请结合球衣描述核对。</p>}
  {personal&&<PerformanceRadar metrics={dimensions}/>}
  {!personal&&<section className="vr-notes"><article><h2><VisualIcon name="spark"/>本场亮点</h2><Copy text={highlight||'本次未识别到明确亮点'}/></article><article><h2><VisualIcon name="opponent"/>对手表现</h2><Copy text={dashboard.summary.opponent||'本次暂无对手表现分析'}/></article></section>}
  {!personal&&<section className="vr-roster"><h2>焦点球员</h2>{[...dashboard.players].sort((a,b)=>Number(b.isMvp)-Number(a.isMvp)).map(p=><article key={p.id} className="vr-teammate"><span className="vr-number">{p.unconfirmedNumber||p.anonymousIndex||!p.number?'?':p.number}<small>{p.number&&!p.unconfirmedNumber?'号':''}</small></span><div className="vr-player-copy"><h3>{p.role||p.name||'本场球员'}</h3><Copy text={p.strength||p.insights[0]||'本次暂无具体点评'}/>{p.unconfirmedNumber&&<small>号码未确认</small>}</div><div className="vr-player-score"><b>{scoreText(p.score)}</b>{p.isMvp&&<em><VisualIcon name="award"/>本场最佳</em>}</div></article>)}{!dashboard.players.length&&<p className="vr-empty">本次暂无球员表现</p>}</section>}
  {personal&&<section className="vr-dimension-analysis"><h2>五维分析</h2>{(['attack','passing','defense','running','duels'] as const).map((key,i)=><article key={key}><div><h3>{dimensions[i][0]}</h3><span>{scoreText(dimensions[i][1])}</span></div><Copy text={player?.dimensionAnalysis?.[key]||'本次暂无该维度的详细分析'}/></article>)}</section>}
  {personal&&!!player?.tags.length&&<div className="vr-tags">{player.tags.slice(0,3).map(t=><span key={t}>{t}</span>)}</div>}
  <section className="vr-advice"><h2>调整建议</h2><Copy text={advice||'本次暂无调整建议'}/></section>
  <button className="vr-primary vr-share" onClick={()=>void share()}>分享{personal?'本场表现':'球队战报'}<VisualIcon name="share"/></button>
  {feedback&&<p role="alert">{feedback}</p>}
  {poster&&<dialog className="vr-dialog" ref={dialog} onCancel={()=>setPoster(undefined)}><button onClick={()=>setPoster(undefined)} aria-label="关闭分享图片">关闭</button><img src={poster} alt="本场战报分享图片"/><a className="vr-primary" href={poster} download="好球Ai-战报.png">保存图片</a></dialog>}
 </main>
}
