import { Link } from 'react-router-dom'

export default function NotFound() {
  return (
    <div className="mx-auto max-w-xl px-4 py-24 text-center">
      <p className="text-6xl">⚽</p>
      <h1 className="mt-4 text-2xl font-bold text-slate-800">页面走丢了</h1>
      <p className="mt-2 text-sm text-slate-500">你访问的页面不存在，回首页继续看球吧。</p>
      <Link to="/" className="btn-primary mt-6">
        返回首页
      </Link>
    </div>
  )
}
