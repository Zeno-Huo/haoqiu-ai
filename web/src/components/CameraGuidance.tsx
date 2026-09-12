import '../report.css'
export default function CameraGuidance({ compact = false }: { compact?: boolean }) {
  return <details className={`camera-guidance ${compact ? 'is-compact' : ''}`}>
    <summary>高机位更准，平地手持可能有偏差<span aria-hidden="true"> ⓘ</span></summary>
    <p>球队内测参考：高机位约 80%–90%，平地手持约 60%。受画质与遮挡影响，不代表每段视频的准确率。</p>
  </details>
}
