import { Link } from 'react-router-dom'
import { listMatches } from '../lib/storage'
import { formatDate } from '../lib/utils'
import type { Match } from '../types'

const STEPS = [
  { icon: '📝', title: '填写比赛信息', desc: '队名、比赛类型与时长，几十秒搞定' },
  { icon: '👥', title: '录入球员名单', desc: '号码 + 姓名，支持一键生成示例名单' },
  { icon: '📊', title: '生成数据看板', desc: '客观数据 + 1-10 综合评分，一屏看懂' },
]

function RecentMatches({ matches }: { matches: Match[] }) {
  if (matches.length === 0) return null
  return (
    <section className="mt-12">
      <div className="mb-4 flex items-center justify-between">
        <h2 className="text-lg font-bold text-slate-800">最近比赛</h2>
        <Link to="/match/new" className="text-sm font-medium text-pitch-700 hover:underline">
          新建比赛 →
        </Link>
      </div>
      <div className="grid gap-3 sm:grid-cols-2">
        {matches.slice(0, 4).map((m) => (
          <Link
            key={m.id}
            to={m.analysis ? `/match/${m.id}` : `/match/${m.id}/analyzing`}
            className="card flex items-center justify-between gap-3 p-4 transition hover:shadow-cardlg"
          >
            <div className="min-w-0">
              <p className="truncate font-semibold text-slate-800">{m.name}</p>
              <p className="mt-1 text-xs text-slate-400">
                {formatDate(m.date)} · {m.type} · {m.players.length} 人
              </p>
            </div>
            <span
              className={`shrink-0 rounded-full px-2.5 py-1 text-xs font-semibold ${
                m.analysis ? 'bg-pitch-50 text-pitch-700' : 'bg-amber-50 text-amber-700'
              }`}
            >
              {m.analysis ? '已出报告' : '待分析'}
            </span>
          </Link>
        ))}
      </div>
    </section>
  )
}

export default function Home() {
  const matches = listMatches()

  return (
    <div>
      {/* Hero */}
      <section className="pitch-gradient pitch-grid relative overflow-hidden text-white">
        <div className="mx-auto max-w-5xl px-4 py-16 sm:py-24">
          <div className="max-w-2xl animate-fade-in-up">
            <span className="inline-flex items-center gap-2 rounded-full bg-white/10 px-3 py-1 text-xs font-medium ring-1 ring-white/20">
              <span className="h-1.5 w-1.5 rounded-full bg-lime-300" />
              MVP 演示版 · AI 模拟分析引擎
            </span>
            <h1 className="mt-5 text-4xl font-black leading-tight tracking-tight sm:text-5xl">
              一台手机、一场比赛，
              <br className="hidden sm:block" />
              全队表现一屏看懂。
            </h1>
            <p className="mt-4 text-base text-lime-100/90 sm:text-lg">
              为你的球队生成客观数据看板与 1-10 综合评分，一场比赛的表现一屏看懂。
            </p>
            <div className="mt-8 flex flex-wrap items-center gap-3">
              <Link
                to="/match/new"
                className="inline-flex items-center gap-2 rounded-xl bg-white px-6 py-3.5 text-sm font-bold text-pitch-800 shadow-lg transition hover:bg-lime-50 active:scale-[0.98]"
              >
                创建一场比赛
                <span aria-hidden>→</span>
              </Link>
              <a
                href="#how"
                className="inline-flex items-center gap-2 rounded-xl bg-white/10 px-6 py-3.5 text-sm font-semibold text-white ring-1 ring-white/25 transition hover:bg-white/15"
              >
                了解流程
              </a>
            </div>
          </div>
        </div>
        {/* 装饰足球 */}
        <div className="pointer-events-none absolute -right-10 -top-10 h-56 w-56 rounded-full bg-white/5" />
        <div className="pointer-events-none absolute right-16 bottom-0 h-24 w-24 rounded-full bg-white/5" />
      </section>

      {/* 三步说明 */}
      <section id="how" className="mx-auto max-w-5xl px-4 py-14">
        <h2 className="text-center text-2xl font-bold text-slate-800">三步，赛后就拿到看板</h2>
        <p className="mt-2 text-center text-sm text-slate-500">无需专业设备，一部手机即可</p>
        <div className="mt-8 grid gap-4 sm:grid-cols-3">
          {STEPS.map((s, i) => (
            <div key={s.title} className="card relative p-6">
              <span className="absolute right-5 top-4 text-4xl font-black text-slate-100">{i + 1}</span>
              <div className="text-3xl">{s.icon}</div>
              <h3 className="mt-3 text-base font-bold text-slate-800">{s.title}</h3>
              <p className="mt-1.5 text-sm leading-relaxed text-slate-500">{s.desc}</p>
            </div>
          ))}
        </div>
      </section>

      {/* 能力展示 */}
      <section className="border-t border-slate-100 bg-white py-14">
        <div className="mx-auto max-w-5xl px-4">
          <h2 className="text-center text-2xl font-bold text-slate-800">看板里有什么</h2>
          <div className="mt-8 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            {[
              { t: '综合评分', d: '1–10 分（保留 1 位小数），一眼看懂本场表现' },
              { t: '客观数据看板', d: '拿球 / 传球 / 射门 / 突破 / 拦截 / 抢断' },
              { t: '全队总览', d: '总拿球、总传球、总射门、总失误' },
              { t: '精彩片段', d: '关键高光时刻按时间线逐一回看' },
            ].map((f) => (
              <div key={f.t} className="rounded-2xl bg-slate-50 p-5">
                <p className="font-bold text-slate-800">{f.t}</p>
                <p className="mt-1.5 text-sm text-slate-500">{f.d}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      <RecentMatches matches={matches} />

      <section className="mx-auto max-w-5xl px-4 py-14 text-center">
        <span className="inline-flex items-center gap-2 rounded-full bg-pitch-50 px-3 py-1.5 text-sm font-semibold text-pitch-700 ring-1 ring-pitch-200">
          <span className="h-2 w-2 rounded-full bg-pitch-600" />
          我的球队 · 单队视角
        </span>
        <p className="mt-4 text-sm text-slate-400">聚焦自己球队，客观数据看板一屏呈现</p>
      </section>
    </div>
  )
}
