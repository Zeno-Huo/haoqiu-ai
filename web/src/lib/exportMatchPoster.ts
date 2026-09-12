type Poster = { title: string; target: string; score: string; headline: string; highlight: string; advice: string; stats: {label: string;value: string}[];preview?: boolean }
/** 纯本地生成分享图片，不发送仅在本机可读取的报告链接。 */
export async function exportMatchPoster(report: Poster) {
  const canvas=document.createElement('canvas');canvas.width=780;canvas.height=1080
  const context=canvas.getContext('2d');if(!context)throw new Error('Canvas unavailable');const ctx: CanvasRenderingContext2D = context
  ctx.fillStyle='#081411';ctx.fillRect(0,0,780,1080)
  const glow=ctx.createRadialGradient(640,180,0,640,180,500);glow.addColorStop(0,'#174331');glow.addColorStop(1,'#081411');ctx.fillStyle=glow;ctx.fillRect(0,0,780,550)
  function text(value:string,x:number,y:number,size:number,color='#eff6f1'){ctx.fillStyle=color;ctx.font=`600 ${size}px sans-serif`;ctx.fillText(value,x,y)}
  function wrap(value:string,y:number,size:number,maxLines=3){let line='',row=0;ctx.font=`600 ${size}px sans-serif`;for(const ch of Array.from(value)){if(ctx.measureText(line+ch).width>660){text(line,60,y+row*(size+12),size);line='';if(++row===maxLines)return}line+=ch}if(line)text(line,60,y+row*(size+12),size)}
  text('好球 Ai  /  '+report.title,60,70,24,'#83d9ac');text(report.preview?'设计示例 · 非真实分析':report.target,60,122,25)
  text(report.score,52,285,154,'#83d9ac');text('本场评分 / 10',62,328,22,'#a5b8ae');wrap(report.headline,400,34,2)
  report.stats.forEach((s,i)=>{const x=60+i*173;text(s.label,x,525,23,'#a5b8ae');text(s.value,x,575,38)})
  text('★ 本场亮点',60,650,25,'#83d9ac');wrap(report.highlight,696,26,3)
  text('调整建议',60,844,25,'#e3ae69');wrap(report.advice,892,25,3)
  
  const blob=await new Promise<Blob>((resolve,reject)=>canvas.toBlob(b=>b?resolve(b):reject(new Error('Export failed')),'image/png'))
  return blob
}
