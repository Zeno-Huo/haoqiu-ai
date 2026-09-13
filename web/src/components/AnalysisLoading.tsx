import {useEffect,useState} from 'react'
import {Link} from 'react-router-dom'
import VisualIcon from './VisualIcon'
import '../visual-refresh.css'
const tips=['分析需要一点时间，请保持页面打开。','画面越复杂，整理越需要耐心。','等待期间，无需重复提交。']
export default function AnalysisLoading({filename,progress,stage,uploading=false,error,onRetry}:{filename:string;progress:number;stage:string;uploading?:boolean;error?:string;onRetry?:()=>void}) {
 const [tip,setTip]=useState(0)
 useEffect(()=>{if(error)return;const timer=window.setInterval(()=>setTip(n=>(n+1)%tips.length),5000);return()=>clearInterval(timer)},[error])
 const value=Number.isFinite(progress)?Math.round(Math.min(100,Math.max(0,progress))):undefined
 return <main className={`vr-page vr-loading ${error?'has-error':''}`}><header className="vr-nav"><Link to="/" aria-label="返回首页"><VisualIcon name="back"/></Link><h1>{error?'分析暂未完成':'正在分析'}</h1><span/></header><p className="vr-filename">{filename}</p>
 <div className="vr-ring" role="progressbar" aria-label={uploading?'视频上传进度':'分析进度'} aria-valuemin={0} aria-valuemax={100} aria-valuenow={value}><svg viewBox="0 0 240 240" aria-hidden="true"><circle className="vr-ring-track" cx="120" cy="120" r="105"/><circle className="vr-ring-progress" cx="120" cy="120" r="105" pathLength="100" strokeDasharray={`${value||0} 100`}/><circle className="vr-ring-orbit" cx="120" cy="120" r="116" pathLength="100" strokeDasharray="12 88"/></svg><div><b>{value??'—'}</b>{value!=null&&<span>%</span>}</div></div>
 {error?<section className="vr-loading-error" role="alert"><p>{error}</p>{onRetry&&<button className="vr-primary" onClick={onRetry}>再试一次</button>}</section>:<><h2>{stage}</h2><div className="vr-reassurance"><p key={tip}>{tips[tip]}</p><div aria-label="等待提示">{tips.map((_,i)=><button key={i} aria-label={`提示 ${i+1}`} aria-pressed={tip===i} onClick={()=>setTip(i)}/>)}</div></div><p className="vr-loading-detail">{uploading?'视频上传完成后，自动开始分析。':'正在结合前后画面，整理球员表现。'}</p><ol className="vr-steps">{['读取视频','分析表现','生成报告'].map((s,i)=><li key={s} className={i===(uploading?0:1)?'active':i<(uploading?0:1)?'done':''}><span>{!uploading&&i===0?<VisualIcon name="check"/>:null}</span>{s}</li>)}</ol></>}
 <footer><p>高机位画面通常更利于判断。</p><Link className="vr-secondary" to="/">返回首页</Link></footer></main>
}
