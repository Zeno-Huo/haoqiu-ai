export type AnalysisMode = 'practical' | 'demo'

const MODE_KEY = 'haoqiu_ai_analysis_mode'

export function getAnalysisMode(): AnalysisMode {
  try { return localStorage.getItem(MODE_KEY) === 'demo' ? 'demo' : 'practical' } catch { return 'practical' }
}

export function setAnalysisMode(mode: AnalysisMode): void {
  try { localStorage.setItem(MODE_KEY, mode); window.dispatchEvent(new CustomEvent('haoqiu-analysis-mode', { detail: mode })) } catch { /* 页面仍可继续使用 */ }
}

export function subscribeAnalysisMode(listener: (mode: AnalysisMode) => void): () => void {
  const handler = (event: Event) => listener((event as CustomEvent<AnalysisMode>).detail)
  window.addEventListener('haoqiu-analysis-mode', handler)
  return () => window.removeEventListener('haoqiu-analysis-mode', handler)
}

