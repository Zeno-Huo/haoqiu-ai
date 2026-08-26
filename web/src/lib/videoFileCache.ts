// File 无法放入 localStorage；只在当前页面会话内暂存，刷新后明确要求重新选择。
const filesByMatchId = new Map<string, File>()

export function cacheVideoFile(matchId: string, file: File): void {
  filesByMatchId.set(matchId, file)
}

export function getCachedVideoFile(matchId: string): File | undefined {
  return filesByMatchId.get(matchId)
}

export function clearCachedVideoFile(matchId: string): void {
  filesByMatchId.delete(matchId)
}
