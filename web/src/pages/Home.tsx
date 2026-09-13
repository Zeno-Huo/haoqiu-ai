import { useState } from 'react'
import { Link } from 'react-router-dom'
import FootballNetwork from '../components/FootballNetwork'

export default function Home() {
  const [tilt,setTilt]=useState(false)
  const [motionMessage,setMotionMessage]=useState('')
  async function enableTilt(){
    const api=window.DeviceOrientationEvent as typeof DeviceOrientationEvent & {requestPermission?:()=>Promise<string>}
    if(!api){setMotionMessage('当前浏览器不支持重力感应');return}
    try{if(api.requestPermission&&await api.requestPermission()!=='granted'){setMotionMessage('未开启感应，足球继续自动旋转');return}setTilt(true);setMotionMessage('已开启，轻轻转动手机试试')}catch{setMotionMessage('请在 HTTPS 页面中开启重力感应')}
  }
  const modes = [
    {
      index: '01',
      label: '团队模式',
      kicker: '看球队',
      note: '快速总结，辅助决策',
      features: ['亮点与不足', '关键片段', '球员点评'],
      action: '上传视频，即刻分析',
      mode: 'instant',
      primary: true,
    },
    {
      index: '02',
      label: '个人模式',
      kicker: '看自己',
      note: 'AI动作追踪，深度分析，时间较长',
      features: ['表现评分', '跑动热图', '技术统计'],
      action: '上传个人跟拍视频',
      mode: 'personal',
      primary: false,
    },
  ]

  return (
    <div className="page-shell home-page">
      <main className="home-content">
        <section className="sphere-stage">
          <div className="particle-sphere-canvas"><FootballNetwork variant="ball" tilt={tilt}/></div>
          <button className="home-tilt-control" onClick={()=>void enableTilt()} disabled={tilt}>{motionMessage||'开启重力感应'}</button>
          <div className="home-hero-copy">
            <span className="home-kicker">✦&nbsp; 业余足球</span>
            <h1 className="home-title"><span>AI</span>视频分析</h1>
            <span className="home-title-rule" aria-hidden="true" />
            <p className="home-value">上传足球视频，智能分析比赛与表现</p>
          </div>
        </section>
        <nav className="home-mode-grid" aria-label="分析方式">
          {modes.map(({ index, label, kicker, note, features, action, mode, primary }) => (
            <Link key={mode} to={`/match/new?mode=${mode}`} className={`home-mode-card ${primary ? 'is-primary' : ''}`}>
              <span className="home-mode-top">
                <span className="home-mode-index" aria-hidden="true">{index}</span>
                <b className="home-mode-kicker">{kicker} <span aria-hidden="true">›</span></b>
              </span>
              <span className="home-mode-detail">
                <span className={`home-mode-icon ${mode}`} aria-hidden="true">
                  {mode === 'instant' ? (
                    <svg viewBox="0 0 56 56" fill="none"><rect x="7" y="32" width="9" height="15" rx="2" /><rect x="23" y="21" width="9" height="26" rx="2" /><rect x="39" y="10" width="9" height="37" rx="2" /></svg>
                  ) : (
                    <svg viewBox="0 0 56 56" fill="none"><circle cx="28" cy="19" r="9" /><path d="M12 47c1-10 7-16 16-16s15 6 16 16" /></svg>
                  )}
                </span>
                <span className="home-mode-copy">
                  <strong className="home-mode-label">{label}</strong>
                  <span className="home-mode-note">{note}</span>
                  <span className="home-mode-features">
                    {features.map((feature) => <span key={feature}>{feature}</span>)}
                  </span>
                  <span className="home-mode-action">{action}<span aria-hidden="true">→</span></span>
                </span>
              </span>
            </Link>
          ))}
        </nav>
      </main>
      <footer className="home-footer">zeno有限公司出品</footer>
    </div>
  )
}
