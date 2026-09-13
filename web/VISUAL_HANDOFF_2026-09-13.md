# 前端视觉交付

基线：8b78032（WorkBuddy 最新本地交接）。分支 codex/frontend-visual-0913。仅 web/，不推送、不部署，无新增依赖或环境变量。

## 已实现
- 上传：沿用首页 mode，无重复选择；精简球场纹理选择区，弱机位提醒。选完视频后保留必要球衣提示。文件选择、时长校验、上传协议保持现有链路。
- 加载：两模式共用 AnalysisLoading；大数字、真实阶段进度、独立转圈、5秒轮播、错误停止动效、减少动画偏好支持。百分比是当前上传/分析阶段进度，不是伪造全流程时长。
- 结果：总评分、真实 AI 总结、紧凑横向队友卡、亮点不足和建议；个人保留四项评分，删除次数展示。按用户定稿不恢复关键片段、不开发训练。
- 解析：接入 strength/weakness；预留 ratings / dimension_scores 的 participation/attack/defense/decision（0–10）。后端当前未输出分项分数，生产显示 —；预览示例严格位于 DEV 路由。
- 分享：本地图片，不分享不能跨设备读取的会话报告地址。

## 有意差异与限制
- 取消分析改为返回首页：当前上传与任务流程未提供可保证中断的取消契约。返回不代表服务端任务已停止。
- 图片是装饰素材，团队不使用球员头像；沿用现有个人图，团队新素材不带号码以避免与结果号码混淆。
- 文案 2–5 分钟前加推荐，避免暗示短于2分钟不能上传。选中后增加识别所需输入。
- 真实缺数据、目标切换等必要状态使用事实提示。定稿以外无口号/次数/关键片段。
- 桌面居中最大680px，手机按实际屏宽显示，非将1024像素设计图等比放大。

## 验证与视觉对照
构建：npm run build --prefix web -- --emptyOutDir 通过（tsc + Vite）。数据解析7个断言通过：亮点、不足、分数、0分、越界、数值字符串、缺评分不从次数生成。git diff --check 通过。

IAB 390×844：检查上传初态禁用按钮、球队/个人切换、缺数据、分享图片生成/关闭、加载正常与报错样式；CSS 实测 vr-spin / none。未发起真实视频上传、VLM付费调用，端到端云分析留给 WorkBuddy 发布验收。

参考为用户本轮四张定稿（临时附件）：
- codex-clipboard-f6886b42-8799-41cd-b0be-4b21e158b175.png：球队
- codex-clipboard-5166417c-2b49-4829-8309-466f128d9e22.png：个人
- codex-clipboard-878caae9-c89e-4bda-ab98-b7bff2e402dc.png：上传
- codex-clipboard-3db026df-ae38-4805-af61-1d7f85d79201.png：加载

截图 /tmp/hq-team-0913.png、/tmp/hq-personal-0913.png、/tmp/hq-upload-0913.png、/tmp/hq-loading-0913.png。view_image 已检查参考个人图与当前手机截图，并检查上传、球队、加载截图。1024×1536 检查 DOM 无横向溢出且图片加载；IAB 原尺寸截图会出现缩放/裁切，因此视觉验收以390×844手机截图为准。

对照记录：
1. 信息层级：总评分→AI总结→队友/分项评分→亮点不足→建议，与定稿一致。
2. 文案：无口号、无重复模式选择、无头像；必要差异已列上方。
3. 颜色：近黑绿、薄荷评分、琥珀改进，保持定稿。
4. 卡片：球队横向号码/点评/评分；个人2×2评分，无次数。
5. 图像：人物在右、渐隐底部、避免遮挡评分；团队用背影强调团结。
6. 加载：大数字和转圈分离，轮播区层级低于阶段标题。
7. 空态/交互：不展示虚构8分，不伪装取消；分享生成真实本地图片。

交付路径：src/components/{InstantDashboard,AnalysisLoading,VisualIcon,Layout}.tsx；src/pages/{MatchNew,InstantAnalysis,SingleTracking,DesignPreview}.tsx；src/lib/{instantAnalysis,exportMatchPoster}.ts；src/visual-refresh.css；public/report-team-v2.png。
