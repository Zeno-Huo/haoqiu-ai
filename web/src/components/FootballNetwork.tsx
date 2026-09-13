import { useEffect, useRef } from 'react'

type Point = [number, number, number]
const phi = (1 + Math.sqrt(5)) / 2
const vertices: Point[] = []
for (const a of [-1, 1]) for (const b of [-phi, phi]) vertices.push([0,a,b],[a,b,0],[b,0,a])
const distance = (a: Point,b: Point) => Math.hypot(...a.map((v,i)=>v-b[i]))
const directed: [number,number][] = []
vertices.forEach((a,i)=>vertices.forEach((b,j)=>{if(i!==j&&Math.abs(distance(a,b)-2)<.001)directed.push([i,j])}))
const ball: Point[] = directed.map(([i,j])=>{const p=vertices[i].map((v,k)=>(2*v+vertices[j][k])/3) as Point;const n=Math.hypot(...p);return p.map(v=>v/n) as Point})
const edges: [number,number][] = []
directed.forEach(([a,b],i)=>directed.forEach(([c,d],j)=>{if(j>i&&((a===d&&b===c)||(a===c&&Math.abs(distance(vertices[b],vertices[d])-2)<.001)))edges.push([i,j])}))
/** Decorative geometry only: these nodes are not detected players or measured trajectories. */
export default function FootballNetwork({variant='ball',tilt=false}:{variant?:'ball'|'pitch'|'collective'|'staticPitch';tilt?:boolean}) {
 const ref=useRef<HTMLCanvasElement>(null)
 useEffect(()=>{
  const canvas=ref.current,ctx=canvas?.getContext('2d');if(!canvas||!ctx)return
  let frame=0,w=0,h=0,time=0,last=0,visible=true
  const motion=matchMedia('(prefers-reduced-motion: reduce)')
  let tx=0,ty=0,sx=0,sy=0,baseBeta:number|undefined,baseGamma:number|undefined
  const orient=(e:DeviceOrientationEvent)=>{if(e.beta==null||e.gamma==null||motion.matches)return;baseBeta??=e.beta;baseGamma??=e.gamma;tx=Math.max(-.45,Math.min(.45,(e.gamma-baseGamma)*.018));ty=Math.max(-.3,Math.min(.3,(e.beta-baseBeta)*.012))}
  if(tilt)window.addEventListener('deviceorientation',orient)
  function draw(){
   if(!ctx)return;ctx.clearRect(0,0,w,h)
   sx+=(tx-sx)*.08;sy+=(ty-sy)*.08
   const point=(x:number,y:number,r=1.8,alpha=.8)=>{ctx.beginPath();ctx.arc(x,y,r,0,Math.PI*2);ctx.fillStyle=`rgba(88,255,222,${alpha})`;ctx.shadowColor='#00efca';ctx.shadowBlur=r>1.4?8:0;ctx.fill();ctx.shadowBlur=0}
   const line=(a:number[],b:number[],alpha:number)=>{ctx.beginPath();ctx.moveTo(a[0],a[1]);ctx.lineTo(b[0],b[1]);ctx.strokeStyle=`rgba(0,221,193,${alpha})`;ctx.lineWidth=.75;ctx.stroke()}
   if(variant==='ball'){
    const angle=time*.14+.4+sx,scale=Math.min(w,h)*.39
    const projected=ball.map(([x,y,z])=>{const xx=x*Math.cos(angle)+z*Math.sin(angle),zz=z*Math.cos(angle)-x*Math.sin(angle);const yy=y*Math.cos(.35+sy)-zz*Math.sin(.35+sy);return [w*.52+xx*scale,h*.49+yy*scale,zz*Math.cos(.35+sy)+y*Math.sin(.35+sy)]})
    edges.forEach(([i,j],index)=>{const a=projected[i],b=projected[j],depth=(a[2]+b[2])/2;line(a,b,.05+Math.max(0,depth)*.5);if(index%7===0&&depth>0){const t=(time*.35+index*.17)%1;point(a[0]+(b[0]-a[0])*t,a[1]+(b[1]-a[1])*t,1.8,.8);point(b[0]+(a[0]-b[0])*t,b[1]+(a[1]-b[1])*t,1.2,.5);if(Math.abs(t-.5)<.08){const strength=1-Math.abs(t-.5)/.08;point((a[0]+b[0])/2,(a[1]+b[1])/2,2+strength*2,strength*.8)}}})
    ctx.font='8px monospace';ctx.textAlign='center';projected.forEach(([x,y,z],i)=>{if(z>.2&&i%3===0){ctx.fillStyle=`rgba(126,245,224,${z*.52})`;ctx.fillText(['01','0x','{}','10','::'][Math.floor(time*.8+i)%5],x+8,y-5)}})
    for(let i=0;i<16;i++){const phase=(time*.2+i*.618)%1,a=i*2.39996,rr=scale*(1.06+phase*.25),x=w*.52+Math.cos(a)*rr,y=h*.49+Math.sin(a)*rr*.86;point(x,y,.7,(1-phase)*.35);if(i%4===0){ctx.fillStyle=`rgba(60,188,191,${(1-phase)*.25})`;ctx.fillText(i%2?'010':'0x1',x+8,y)}}
    projected.forEach(([x,y,z],i)=>point(x,y,z>0?1.6:1,.2+Math.max(0,z)*.75+.05*Math.sin(time+i)))
    for(let i=0;i<65;i++){const z=1-2*(i+.5)/65,a=i*2.39996+angle,rr=Math.sqrt(1-z*z);const x=rr*Math.cos(a),depth=rr*Math.sin(a);point(w*.52+x*scale,h*.49+(z*.94-depth*.34)*scale,.6,.12+Math.max(0,depth)*.32)}
   }else if(variant==='staticPitch'){
    const left=w*.19,top=h*.14,pw=w*.64,ph=h*.7
    ctx.strokeStyle='rgba(98,207,193,.48)';ctx.lineWidth=.9;ctx.shadowColor='#53d4c0';ctx.shadowBlur=5
    ctx.strokeRect(left,top,pw,ph)
    ctx.beginPath();ctx.moveTo(left,top+ph/2);ctx.lineTo(left+pw,top+ph/2);ctx.stroke()
    ctx.beginPath();ctx.arc(left+pw/2,top+ph/2,pw*.17,0,Math.PI*2);ctx.stroke()
    for(const bottom of [false,true]){
     const edge=bottom?top+ph:top,sign=bottom?-1:1
     const box=(width:number,depth:number)=>{ctx.beginPath();ctx.moveTo(left+pw*(1-width)/2,edge);ctx.lineTo(left+pw*(1-width)/2,edge+sign*ph*depth);ctx.lineTo(left+pw*(1+width)/2,edge+sign*ph*depth);ctx.lineTo(left+pw*(1+width)/2,edge);ctx.stroke()}
     box(.58,.16);box(.26,.06)
    }
    ctx.shadowBlur=0
   }else if(variant==='collective'){
    const cx=w*.51,cy=h*.49,r=Math.min(w,h)*.34
    // Decorative shared orbital field; no implied player positions or measurements.
    const orbit=(a:number,ring:number)=>{
     const tilt=[-.48,.38,.92][ring],x=Math.cos(a)*r,y=Math.sin(a)*r*.36
     return [cx+x*Math.cos(tilt)-y*Math.sin(tilt),cy+x*Math.sin(tilt)+y*Math.cos(tilt),Math.sin(a)]
    }
    const halo=ctx.createRadialGradient(cx,cy,0,cx,cy,r*.7)
    halo.addColorStop(0,'#75ffe92b');halo.addColorStop(.3,'#00d5c51b');halo.addColorStop(1,'#00a9c000')
    ctx.fillStyle=halo;ctx.fillRect(cx-r,cy-r,r*2,r*2)
    for(let ring=0;ring<3;ring++){
     for(let i=0;i<120;i++){
      const a=i*Math.PI/60+time*(.07+ring*.015),p=orbit(a,ring),q=orbit(a+.025,ring)
      line(p,q,.09+Math.max(0,p[2])*.18)
      if(i%3===0)point(p[0],p[1],.65,.16+Math.max(0,p[2])*.35)
     }
     for(let n=0;n<3;n++){
      const a=time*(.27+ring*.06)+n*Math.PI*2/3+ring,p=orbit(a,ring)
      for(let tail=12;tail>=0;tail--){const q=orbit(a-tail*.025,ring);point(q[0],q[1],tail===0?2:1,(1-tail/13)*.8)}
      if(n===0){const t=(time*.22+ring/3)%1;point(p[0]+(cx-p[0])*t,p[1]+(cy-p[1])*t,1.2,Math.sin(t*Math.PI)*.65)}
     }
    }
    point(cx,cy,3,.9)
    for(let i=0;i<45;i++){const a=i*2.39996+time*.025,rr=r*(.2+Math.sqrt(i/45)*.95);point(cx+Math.cos(a)*rr,cy+Math.sin(a)*rr*.76,.5,.12+.12*Math.sin(time+i))}
   }else{
    // Orthographic 2.5D pitch: length runs diagonally, with a shallow base.
    const project=(x:number,y:number)=>[w*.5+x*w*.32+(y-.5)*w*.19,h*.48-x*h*.13+(y-.5)*h*.48]
    const corners=[project(-1,0),project(1,0),project(1,1),project(-1,1)]
    const shape=(pts:number[][],fill:string)=>{ctx.beginPath();pts.forEach((p,i)=>i?ctx.lineTo(p[0],p[1]):ctx.moveTo(p[0],p[1]));ctx.closePath();ctx.fillStyle=fill;ctx.fill()}
    const base=corners.map(([x,y])=>[x,y+7]);shape([corners[2],corners[3],base[3],base[2]],'#073642');shape([corners[1],corners[2],base[2],base[1]],'#0b4650')
    const surface=ctx.createLinearGradient(0,h*.2,w,h*.8);surface.addColorStop(0,'#09242e');surface.addColorStop(.55,'#103f45');surface.addColorStop(1,'#06212b')
    ctx.beginPath();corners.forEach((p,i)=>i?ctx.lineTo(p[0],p[1]):ctx.moveTo(p[0],p[1]));ctx.closePath();ctx.fillStyle=surface;ctx.fill()
    for(let i=0;i<10;i+=2)shape([project(-1,i/10),project(1,i/10),project(1,(i+1)/10),project(-1,(i+1)/10)],'#5cdec508')
    corners.forEach((a,i)=>line(a,corners[(i+1)%4],.7))
    line(project(-1,.5),project(1,.5),.55)
    const rect=(x1:number,y1:number,x2:number,y2:number)=>{const ps=[project(x1,y1),project(x2,y1),project(x2,y2),project(x1,y2)];ps.forEach((a,i)=>line(a,ps[(i+1)%4],.48))}
    rect(-.58,0,.58,.17);rect(-.58,.83,.58,1);rect(-.27,0,.27,.065);rect(-.27,.935,.27,1)
    for(let i=0;i<48;i++){const a=i*Math.PI/24,b=(i+1)*Math.PI/24;line(project(Math.cos(a)*.27,.5+Math.sin(a)*.105),project(Math.cos(b)*.27,.5+Math.sin(b)*.105),.55)}
    for(const y of [.115,.5,.885]){const p=project(0,y);point(p[0],p[1],1,.65)}
    // Raised goal frames clarify the pitch's depth without adding a stadium.
    for(const y of [0,1]){const a=project(-.18,y),b=project(.18,y),aa=[a[0],a[1]-7],bb=[b[0],b[1]-7];line(a,aa,.7);line(aa,bb,.7);line(bb,b,.7)}
    const nodes=[[-.68,.72],[-.35,.4],[.12,.6],[.35,.25],[.72,.53],[-.6,.2],[.62,.82],[0,.85],[-.12,.14]]
    nodes.forEach(([x,y],i)=>{nodes.forEach(([xx,yy],j)=>{if(j>i&&Math.hypot(x-xx,y-yy)<.8){const a=project(x,y),b=project(xx,yy);line(a,b,.22);const flow=(time*.23+i*.13+j*.07)%1;point(a[0]+(b[0]-a[0])*flow,a[1]+(b[1]-a[1])*flow,1.3,.7)}});const pulse=(time*.4+i*.27)%1;if(pulse<.35){const p=project(x,y);ctx.beginPath();ctx.arc(p[0],p[1],3+pulse*28,0,Math.PI*2);ctx.strokeStyle=`rgba(20,235,204,${(.35-pulse)*1.4})`;ctx.stroke()}})
    nodes.forEach(([x,y],i)=>{const p=project(x,y);point(p[0],p[1],2.2,.8);if(i){const prev=project(...nodes[i-1] as [number,number]);line(prev,p,.4);const t=(time*.16+i*.2)%1;point(prev[0]+(p[0]-prev[0])*t,prev[1]+(p[1]-prev[1])*t,1.5,.9)}})
   }
  }
  function tick(now:number){if(now-last>32){time+=Math.min((now-last)/1000,.05);last=now;draw()}frame=requestAnimationFrame(tick)}
  function update(){cancelAnimationFrame(frame);draw();if(variant!=='staticPitch'&&!motion.matches&&visible&&!document.hidden){last=performance.now();frame=requestAnimationFrame(tick)}}
  const resize=new ResizeObserver(()=>{const rect=canvas.getBoundingClientRect();w=rect.width;h=rect.height;const dpr=Math.min(devicePixelRatio||1,2);canvas.width=w*dpr;canvas.height=h*dpr;ctx.setTransform(dpr,0,0,dpr,0,0);update()});resize.observe(canvas)
  const observer=new IntersectionObserver(([entry])=>{visible=entry.isIntersecting;update()});observer.observe(canvas)
  motion.addEventListener('change',update);document.addEventListener('visibilitychange',update)
  return()=>{window.removeEventListener('deviceorientation',orient);cancelAnimationFrame(frame);resize.disconnect();observer.disconnect();motion.removeEventListener('change',update);document.removeEventListener('visibilitychange',update)}
 },[variant,tilt])
 return <canvas ref={ref} className="football-network" aria-hidden="true"/>
}
