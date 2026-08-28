import { Link, useParams } from 'react-router-dom'
import { getMatch } from '../lib/storage'

export default function TrainingResult() {
  const { id } = useParams()
  const match = id ? getMatch(id) : undefined
  if (!match) return <div className="page-shell grid place-items-center px-4"><Link className="btn-primary" to="/match/new?mode=training">重新开始</Link></div>
  return <div className="page-shell px-4 py-8"><div className="mx-auto max-w-xl">
    <header className="analysis-header"><Link to="/match/new?mode=training">← 返回</Link><h1>训练反馈</h1><p>{match.videoName}</p></header>
    <section className="training-report">
      <article className="is-good"><span>做得好的地方</span><h2>动作节奏比较稳定</h2><p>身体与球的距离保持得不错。</p></article>
      <article className="is-risk"><span>最大问题</span><h2>触球后的衔接偏慢</h2><p>第一下处理后，下一步动作准备不足。</p></article>
      <article className="is-next"><span>下一次只练这个</span><h2>连续触球训练</h2><p>每组 30 秒，只关注触球后的第二步。</p></article>
    </section>
    <div className="analysis-actions"><Link className="btn-primary" to="/match/new?mode=training">再分析一段</Link></div>
  </div></div>
}
