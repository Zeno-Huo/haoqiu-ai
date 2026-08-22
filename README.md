# 好球Ai

AI 足球多人比赛个人表现分析助手 —— 手机录一场业余比赛，生成全队数据看板与球员个人复盘。

> 一句话：一台手机、一场比赛，全队表现一屏看懂。

---

## 技术栈

- **前端**：Vite + React 18 + TypeScript + Tailwind CSS，路由 `react-router-dom`（HashRouter）。
- **数据**：`localStorage` 持久化（无后端、无数据库），纯静态 SPA。
- **AI 分析**：本地模拟引擎 `web/src/lib/engine.ts` 的 `analyzeMatch()`（确定性伪随机），预留接口后续替换为真实视觉模型。

## 如何运行

```bash
cd web
npm install
npm run dev        # 开发模式（默认 http://localhost:5173）
npm run build      # 生产构建 → dist/
```

预览构建产物：

```bash
cd web && npx vite preview   # 或 python3 -m http.server 4180 -d dist
```

## 目录结构

```
好球Ai/
├── README.md                     # 本文件
├── docs/                         # 需求文档（按时间顺序，见下）
│   ├── 开发需求-MVP-Phase1.md
│   ├── 开发需求-MVP-Phase1-看板改版.md          # V1.1 单队/去五维/客观数据
│   ├── 开发需求-MVP-Phase1-看板亮点称号.md      # V1.2 位置+称号+亮点
│   ├── 开发需求-MVP-Phase1-看板炫酷升级.md      # V1.3 炫酷视觉
│   ├── 开发需求-MVP-Phase1-看板V1.4比分胜负.md  # V1.4 比分+球队评分+胜负总结
│   └── 真实AI接入方案.md                       # 真实 AI 方向（未实施）
└── web/
    ├── index.html / package.json / vite.config.ts / tailwind.config.js / tsconfig.json
    ├── public/
    ├── verify_engine.cjs         # 引擎回归测试脚本
    └── src/
        ├── main.tsx / App.tsx    # 入口 + 路由
        ├── types.ts              # 全部数据类型
        ├── index.css             # Tailwind + 自定义 OKLCH 组件样式
        ├── components/Layout.tsx
        ├── hooks/useCountUp.ts   # 数字 count-up 动效 hook
        ├── lib/
        │   ├── engine.ts         # 模拟分析引擎（analyzeMatch / buildMatchSummary）
        │   ├── seed.ts           # 确定性伪随机
        │   ├── storage.ts        # localStorage 持久化（key: haoqiu_ai_matches_v3）
        │   └── utils.ts
        └── pages/
            ├── Home.tsx          # 首页
            ├── MatchNew.tsx      # 创建比赛（两步：信息→名单）
            ├── Analyzing.tsx     # 分析进度（快速进度条）
            ├── MatchReport.tsx   # 数据看板（核心）
            └── NotFound.tsx
```

## 已实现功能（截至 V1.4）

1. **首页** + **创建比赛**（两步向导）：
   - 比赛信息：名称 / 日期 / 类型(5v5·7v7·11v11) / 队名 / 比赛时长(分钟) / 比分(我方:对方)
   - 球员名单：号码 + 姓名 + 位置（前锋/中场/后卫），一键示例名单
2. **分析进度**：快速进度条（约 1.6s 走完）→ 跳转看板。
3. **数据看板**（`MatchReport.tsx`）：
   - 顶部：比分大字 + 胜负标签 + 球队整体评分(1-10)
   - 全队数据总览：总拿球/总传球/总射门/总失误/全队均分
   - 比赛总结：赢→「最大亮点」+「不足」；输→「最大可提升点」；平→亮点+不足（`buildMatchSummary`，每句可追溯到数据）
   - 球员卡片（双列）：亮点大数字（LED 记分牌质感）+ 称号勋章 + 位置徽章 + 综合分 1-10 + 客观数据 + 分析点评
4. **炫酷视觉**：草皮纹理背景、金质勋章、数字 count-up、卡片 stagger 入场（纯 CSS + 自写 rAF hook，无额外依赖）。

## 核心产品约定（重要，改代码前先理解）

- **单队分析**：只录/只分析自己的队，不录对手球员。
- **客观数据指标**（`PlayerStats`）：拿球、拿球成功、失误、传球(成功·总)、射门(正·总)、突破、拦截、抢断。
- **评分**：综合分 1–10（保留 1 位小数），由客观数据推导，不做五维定性评分。
- **位置维度**：前锋看射门/突破、中场看传球/拿球、后卫看拦截/抢断。
- **称号系统**（全队评比，并列共享）：射手/突破王/传球大师/拿球王/拦截王/抢断王。
- **模拟数据**：当前是本地模拟引擎，非真实视频分析（见 `真实AI接入方案.md`）。

## 需求文档阅读顺序

1. `开发需求-MVP-Phase1.md` — 初始 PRD 拆解（原始设计：两队/五维/报告，部分已废弃）
2. `看板改版.md`（V1.1）— 改为单队 + 客观数据 + 1-10 评分（**当前方向的基础**）
3. `看板亮点称号.md`（V1.2）— 位置 + 称号 + 亮点放大
4. `看板炫酷升级.md`（V1.3）— 视觉/动效（impeccable 规范）
5. `看板V1.4比分胜负.md`（V1.4）— 比分 + 球队评分 + 胜负总结 + 双列
6. `真实AI接入方案.md` — 真实 AI 方向（云端视觉大模型 API，**未实施**）

## 下一步 / 待办

- **真实 AI 接入**（最大方向）：见 `真实AI接入方案.md`。方案：前端上传视频 → Python 后端(FastAPI) 抽帧 → 通义千问 VL(qwen-vl-max) 理解 → 生成分析报告。当前后端未落地。
- **遗留小问题**：
  1. `engine.ts` `buildEvents` 的 `maxT = Math.max(duration-1, 10)` 下限 10，超短视频(<11s)事件时间可能超出时长（产品最短 1 分钟，实际不触发）。
  2. 并列同一称号时卡片各挂一枚勋章，视觉略重复。
  3. 位置默认「中场」，无空态。
  4. 比分显示「我方队名 vs 对手」，无对手队名字段。
  5. `Home.tsx` 第 117 行能力展示区仍写着已删除的「精彩片段」（功能已删，文案残留）。
  6. `MatchReport.tsx` 在 render 中直接调用 `navigate()`（`if (!match.analysis) { navigate(...); return null }`），属副作用反模式，应移到 `useEffect`。
  7. `MatchNew.tsx` 初始名单 `makeRows(5)` 与默认比赛类型 7v7（应 8 人）不一致。

## 已知边界

- 无后端 / 无账号 / 无多用户。
- 数据存 localStorage，换设备/清缓存即丢。
- 未接真实视频分析（模拟数据）。
