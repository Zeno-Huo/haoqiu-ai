import { Link, useNavigate, useParams } from 'react-router-dom'
import { getMatch } from '../lib/storage'

function formatBytes(value?: number) {
  if (!value) return '演示片段'
  if (value < 1024 * 1024) return `${Math.ceil(value / 1024)} KB`
  return `${(value / 1024 / 1024).toFixed(1)} MB`
}

function formatDuration(value?: number) {
  if (!value || !Number.isFinite(value)) return '未读取'
  const minutes = Math.floor(value / 60)
  const seconds = Math.round(value % 60).toString().padStart(2, '0')
  return `${minutes}:${seconds}`
}

export default function VideoQuality() {
  const { id } = useParams()
  const navigate = useNavigate()
  const match = id ? getMatch(id) : undefined

  if (!match) {
    return <div className="page-shell grid place-items-center px-4"><section className="panel max-w-md p-6 text-center"><p className="text-[var(--text-secondary)]">找不到这段视频记录。</p><Link className="btn-primary mt-5" to="/match/new">重新选择视频</Link></section></div>
  }

  const meta = match.videoMeta
  const portrait = Boolean(meta?.width && meta?.height && meta.height > meta.width)
  const narrow = Boolean(meta?.width && meta.width < 960)
  const needsReshoot = portrait || narrow
  const notes = [
    portrait ? '当前为竖屏。球队复盘建议横屏拍摄，画面能覆盖更多人和场地。' : '画幅方向适合继续测试；后续仍建议横屏固定拍摄。',
    narrow ? '分辨率偏低。后续测试建议至少使用 1080p，远处球员会更容易识别。' : '分辨率信息已读取。实际识别效果仍取决于光线、距离和画面覆盖。',
  ]

  return (
    <div className="page-shell px-4 py-10">
      <div className="mx-auto max-w-3xl">
        <header className="mb-7">
          <p className="eyebrow">步骤 2 / 3 · 画面检查 · 本地演示</p>
          <h1 className="mt-2 text-3xl font-semibold text-[var(--text-primary)]">查看画面检查与拍摄建议</h1>
          <p className="mt-2 text-sm leading-6 text-[var(--text-muted)]">这里只读取浏览器中的文件信息；视频没有上传，后续仅生成演示数据，真实分析待接入。</p>
        </header>

        <section className="panel p-5 sm:p-6">
          <div className="flex items-start gap-3 border-b border-[var(--line)] pb-5">
            <span className="upload-icon !m-0 shrink-0" aria-hidden>✓</span>
            <div className="min-w-0"><p className="truncate font-medium text-[var(--text-primary)]">{match.videoName}</p><p className="mt-1 text-xs text-[var(--text-muted)]">本地文件 · 不会上传到云端</p></div>
          </div>
          <dl className="mt-5 grid gap-px overflow-hidden rounded-md border border-[var(--line)] bg-[var(--line)] sm:grid-cols-3">
            <div className="bg-[var(--content)] p-4"><dt className="text-xs text-[var(--text-muted)]">时长</dt><dd className="mt-2 font-score text-xl text-[var(--text-primary)]">{formatDuration(meta?.durationSeconds)}</dd></div>
            <div className="bg-[var(--content)] p-4"><dt className="text-xs text-[var(--text-muted)]">画幅</dt><dd className="mt-2 font-score text-xl text-[var(--text-primary)]">{meta?.width && meta?.height ? `${meta.width}×${meta.height}` : '未读取'}</dd></div>
            <div className="bg-[var(--content)] p-4"><dt className="text-xs text-[var(--text-muted)]">文件大小</dt><dd className="mt-2 font-score text-xl text-[var(--text-primary)]">{formatBytes(meta?.sizeBytes)}</dd></div>
          </dl>
          <div className="mt-6 rounded-md border border-[var(--line)] bg-[var(--content)] p-4">
            <p className="text-sm font-medium text-[var(--text-primary)]">拍摄建议</p>
            <ul className="mt-3 space-y-2 text-sm leading-6 text-[var(--text-secondary)]"><li>横屏、固定支架拍摄，尽量不要频繁跟球摇动。</li><li>机位离地约 2–3 米，尽量覆盖双方多人和较多场地。</li><li>夜场优先保证灯光；远景球员过小会影响后续识别。</li></ul>
          </div>
          <div className="mt-4 space-y-2">{notes.map((note) => <p key={note} className="border-l-2 border-[var(--attack)] pl-3 text-sm leading-6 text-[var(--text-secondary)]">{note}</p>)}</div>
          <p className="mt-4 border-l-2 border-[var(--attack)] pl-3 text-sm leading-6 text-[var(--text-secondary)]">低机位、过暗和严重抖动无法仅凭文件信息自动判断；如存在这些情况，这段视频仅适合基础回看，不应视为可完成真实分析。</p>
          <p className={`mt-4 rounded-md border px-4 py-3 text-sm ${needsReshoot ? 'border-[var(--attack)] text-[var(--attack)]' : 'border-[var(--ai)] text-[var(--ai)]'}`}>{needsReshoot ? '建议重拍：当前画幅或分辨率不理想；仍可继续查看本地演示数据。' : '演示可继续：画面信息适合进入本地演示流程，真实分析仍待接入。'}</p>
          <div className="mt-7 flex flex-col-reverse gap-3 sm:flex-row sm:justify-end"><Link className="btn-secondary" to="/match/new">换一段视频</Link><button className="btn-primary" onClick={() => navigate(`/match/${match.id}/analyzing`)}>创建演示任务 <span aria-hidden>→</span></button></div>
        </section>
      </div>
    </div>
  )
}
