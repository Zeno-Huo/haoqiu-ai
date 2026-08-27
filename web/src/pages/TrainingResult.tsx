import { Link, useParams } from 'react-router-dom'
import { getMatch } from '../lib/storage'

export default function TrainingResult() {
  const { id } = useParams(); const match = id ? getMatch(id) : undefined
  if (!match) return <div className="page-shell grid place-items-center px-4"><Link className="btn-primary" to="/match/new">重新开始</Link></div>
  return <div className="page-shell px-4 py-10"><div className="mx-auto max-w-xl"><section className="panel p-6"><p className="eyebrow">训练模式</p><h1 className="mt-2 text-2xl font-semibold">训练反馈已准备好</h1><div className="mt-6 grid gap-3"><div className="rounded-md border border-[var(--line)] bg-[var(--content)] p-4"><p className="text-xs text-[var(--text-muted)]">动作结论</p><p className="mt-2 text-base text-[var(--text-primary)]">本次训练片段已整理，建议结合画面回看动作。</p></div><div className="rounded-md border border-[var(--line)] bg-[var(--content)] p-4"><p className="text-xs text-[var(--text-muted)]">下一次练习</p><p className="mt-2 text-base text-[var(--text-primary)]">保持动作节奏稳定，重复练习并记录下一段视频。</p></div></div><Link className="btn-secondary mt-6" to="/">返回首页</Link></section></div></div>
}
