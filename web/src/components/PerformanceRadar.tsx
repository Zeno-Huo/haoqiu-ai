import {useId} from 'react'
export type RadarMetric = readonly [string, number | undefined]
export default function PerformanceRadar({metrics}:{metrics:readonly RadarMetric[]}){
 const id=useId().replace(/:/g,'');const radius=85,cx=180,cy=146
 const position=(i:number,r:number)=>[cx+Math.sin(i*Math.PI*2/5)*r,cy-Math.cos(i*Math.PI*2/5)*r]
 const value=(n:number|undefined)=>n!=null&&Number.isFinite(n)&&n>=0&&n<=10?n:undefined
 const points=metrics.map(([,n],i)=>value(n)==null?undefined:position(i,radius*value(n)!/10))
 const complete=points.every(Boolean)
 return <section className="performance-radar"><h2>表现评分</h2><svg viewBox="0 0 360 296" role="img" aria-labelledby={`${id}-title`}><title id={`${id}-title`}>{metrics.map(([label,n])=>`${label}：${value(n)==null?'暂无评分':n+'分'}`).join('，')}</title><defs><linearGradient id={`${id}-fill`} x1="0" y1="0" x2="1" y2="1"><stop stopColor="#70b49a" stopOpacity=".28"/><stop offset="1" stopColor="#305e61" stopOpacity=".08"/></linearGradient></defs>
 {[.2,.4,.6,.8,1].map(level=><polygon key={level} points={metrics.map((_,i)=>position(i,radius*level).join(',')).join(' ')} className="radar-grid"/>)}
 {metrics.map((_,i)=>{const p=position(i,radius);return <line key={i} x1={cx} y1={cy} x2={p[0]} y2={p[1]} className="radar-axis"/>})}
 {complete?<polygon points={points.map(p=>p!.join(',')).join(' ')} fill={`url(#${id}-fill)`} className="radar-shape"/>:points.map((p,i)=>{const next=points[(i+1)%5];return p&&next?<line key={i} x1={p[0]} y1={p[1]} x2={next[0]} y2={next[1]} className="radar-shape"/>:null})}
 {points.map((p,i)=>p?<circle key={i} cx={p[0]} cy={p[1]} r="3.5" fill="#83bca7"/>:null)}
 {metrics.map(([label,n],i)=>{const p=position(i,116);return <g key={label}><text x={p[0]} y={p[1]-3} textAnchor="middle" className="radar-label">{label}</text><text x={p[0]} y={p[1]+18} textAnchor="middle" className="radar-value">{value(n)==null?'—':n!.toFixed(1)}</text></g>})}
 </svg>{!complete&&<p className="vr-muted">未提供的维度显示“—”，不计为零分。</p>}</section>
}
