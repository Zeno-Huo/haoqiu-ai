// 通用工具函数

/** 秒 → mm:ss */
export function formatTime(seconds: number): string {
  const s = Math.max(0, Math.floor(seconds))
  const m = Math.floor(s / 60)
  const r = s % 60
  return `${m}:${r.toString().padStart(2, '0')}`
}

/** 秒 → 中文时长，如 12 分 30 秒 */
export function formatDuration(seconds: number): string {
  const m = Math.floor(seconds / 60)
  const r = Math.floor(seconds % 60)
  if (m === 0) return `${r} 秒`
  if (r === 0) return `${m} 分钟`
  return `${m} 分 ${r} 秒`
}

/** 今天日期 YYYY-MM-DD */
export function todayStr(): string {
  const d = new Date()
  const mm = (d.getMonth() + 1).toString().padStart(2, '0')
  const dd = d.getDate().toString().padStart(2, '0')
  return `${d.getFullYear()}-${mm}-${dd}`
}

/** 日期 YYYY-MM-DD → 中文 */
export function formatDate(date: string): string {
  const [y, m, d] = date.split('-')
  if (!y || !m || !d) return date
  return `${y} 年 ${Number(m)} 月 ${Number(d)} 日`
}
