# 协作约定：Codex 开发 / 我部署上线（2026-09-12 起）

## 0. 唯一真源（最重要的一条）

**所有代码只有一个工作目录，一个分支基线：**

```
目录：/Users/luowenhui/WorkBuddy/好球Ai/haoqiu-ai/
基线分支：codex/real-detection-integration
```

规则：

- Codex **必须**在这个目录里开发，不允许在别的目录另开副本。
- 之前 `~/Documents/ChatGPT/好球Ai/haoqiu-backend-handoff` 这类副本是**分叉事故的根源**（线上 9/9、仓库 8/30、Codex 目录又是另一个版本）。该目录已退役。
- 开工前先同步基线，再开分支：
  ```sh
  cd /Users/luowenhui/WorkBuddy/好球Ai/haoqiu-ai
  git checkout codex/real-detection-integration
  git checkout -b feat/xxx
  ```

**⚠️ 不要用 `git pull origin main` 当同步手段。** 实测（2026-09-12）：

- 本仓库**没有** `main` 的可用上游——本地缓存的 `origin/main` 停在 `bc1eb55`（8/23），而 GitHub main 是 `1322947`；本地仓库里连 `1322947` 都是刚从交接目录 fetch 进来的。
- 原因是历史推送一直走 git database API（沙箱 `git push` 被代理拦），**远端 commit 由 API 构造，本地仓库从不 fetch 回来**，两条历史没有共同祖先。
- 另外 GitHub main 上还残留一个本地已删除的死文件 `web/src/lib/useDetectionFlow.ts`（YOLO 时代遗留，无人引用）——**镜像不等于真源**。

所以：**本地工作区就是真源，GitHub 是我推上去的镜像。** 任何人以 GitHub 为起点开工，都会拿到一份和线上不一致的代码。

---

## 1. 角色分工

| 环节 | 负责 |
|---|---|
| 需求拆解、写代码、前端设计 | Codex |
| 本地自测（编译 / 测试 / 页面截图） | Codex |
| commit（在本地 feature 分支上） | Codex |
| 设计定稿的**验收**（看截图/预览） | **用户** |
| 构建、部署、线上校验、回滚 | 我 |
| **所有 GitHub 推送**（任何分支，含 main） | 我 |
| 环境变量、密钥 | 我 |

Codex **不做**：部署、改环境变量、**推 GitHub（任何分支都不推）**、提交密钥。

**Codex 的交付物 = 本地分支名 + commit sha**，不是 PR 或 GitHub 链接。
它交付后代码只在你这台机器上；要留档是我来推，推完由我把链接给你。

---

## 2. 一轮的完整流程

```
① 用户提需求（含 UI 期望；UI 位置/布局由用户拍板）
        ↓
② Codex 从基线分支 codex/real-detection-integration 开 feat/xxx，只写代码 + 自测（本地 commit）
        ↓
③ Codex 交付：给出分支名 + commit sha + 页面截图/预览
        ↓
④ 用户看预览，确认设计（不满意 → 回 ②）
        ↓
⑤ 我接手做发布前检查（见第 4 节）+ 构建 + 部署
        ↓
⑥ 我做线上校验（hash 比对 + 文件完整性 + 浏览器实测）→ 报结果
        ↓
⑦ 需要长期保留 → 我推 GitHub；出问题 → 我回滚（见第 6 节）
```

**关键闸门在 ④ 和 ⑤ 之间**：设计没被用户点头，不进部署；我这边检查不通过，也不进部署。

---

## 3. 交付契约（Codex 每次必须报这 5 项）

1. **分支名 + commit sha**
2. **改了哪些路径**（例如 `web/src/components/InstantDashboard.tsx`）——必须是白名单内的
3. **自测结果**：`npm run build` 是否通过；如有测试，多少项通过
4. **预览**：截图或本地预览地址（设计类改动必须给）
5. **是否新增 env / 依赖**（新增就要告诉我，我来配线上，不要自己动）

缺任何一项 → 我不开始部署。

---

## 4. 我的发布前检查清单

### 前端（`web/`）

1. `git diff --stat main...feat/xxx` —— 确认**只动了 `web/`**（碰了后端或 VLM 要单独走）
2. 构建（必须用 `npm ci` + 摘掉 shim，否则 npm 会被沙箱拦）：
   ```sh
   cd /Users/luowenhui/WorkBuddy/好球Ai/haoqiu-ai/web
   env -u NODE_OPTIONS PATH=/Users/luowenhui/.workbuddy/binaries/node/versions/22.22.2-2/bin:$PATH npm ci --no-audit --no-fund
   env -u NODE_OPTIONS PATH=/Users/luowenhui/.workbuddy/binaries/node/versions/22.22.2-2/bin:$PATH npm run build
   ```
3. 部署：`manageHosting(action=upload, localPath=web/dist, cloudPath="/")`
   （tcb CLI 登录态常失效、授权回写被沙箱拦，不作为首选）
4. **校验（防白屏，必做）**：
   - 线上首页引用的 JS/CSS hash **等于**本地 `dist` 产物
   - 逐个文件请求线上路径，全部 200（漏传就是白屏）
5. 浏览器实测：走一遍上传 → 分析 → 看板

### 后端（`haoqiu-api` / `haoqiu-vlm`）

1. **红线：绝不在本地旧源码上 `npm run build` 后部署**——本地 `cloudbase-backend` 源码长期落后于线上。
   回填（`ea8ad35`）落地并核验之前，`haoqiu-api` **只允许**按「下载线上包 → 定点修改 → 传回」的方式动。
2. `haoqiu-vlm/index.js` 是安全区，可以直接改后部署。
3. 部署：`manageFunctions(action=updateFunctionCode, functionRootPath=父目录)`；包内必须含 `haoqiu-vlm/task-store.js`。
4. **等约 1 分钟**，然后自检：`invokeFunction(haoqiu-vlm, {"selfTest":true})`。
5. 看线上版本：`getFunctionDetail` 的 `ModTime` + `CodeSize`。
6. 改后端的「卡死类」逻辑（调度/补发/claim）时，**必须**在浏览器里真跑一场，不能只看自检绿。

---

## 5. 给 Codex 的约束（可直接粘贴）

```
工作目录只用 /Users/luowenhui/WorkBuddy/好球Ai/haoqiu-ai。
开工前先 git fetch origin && git checkout main && git pull，再开 feat/xxx 分支。

允许改动：
- web/ 下任意前端代码（含组件、样式、页面）
- cloudbase-backend/haoqiu-vlm/index.js（VLM 分析逻辑）

禁止：
- 不要部署、不要改任何环境变量
- **不要推 GitHub —— 任何分支都不推**（含 main、含 feature 分支）；
  推送统一由我走 API 通道做，Codex 只 commit 到本地分支
- 不要在别处另建代码副本
- 不要 build 或部署 cloudbase-backend 的 TypeScript 部分（haoqiu-api），
  本地这份源码落后于线上，构建出来会覆盖线上更新的版本
- 不要提交任何密钥（仓库是 PUBLIC）
- UI 的位置/布局由用户决定，要挪动先问

交付时报告：分支名+commit sha、改动路径、自测结果、预览截图、是否新增 env/依赖。
```

---

## 6. 回滚

| 对象 | 手段 |
|---|---|
| 前端 | 重新部署上一个已知good的 commit 的 `dist`（或直接切回旧分支构建） |
| 后端 | 线上基线包 `~/WorkBuddy/好球Ai/online-baseline/haoqiu-api-2026-09-11-online.tar.gz`，解压后用 `updateFunctionCode` 回传 |
| 数据 | 任务 JSON 在 `db/rc_task/`，生命周期规则刻意不碰它 |

**上线前建议**：把当前线上包的导出包留一份到 `online-baseline/`（带日期），回滚永远有底。

---

## 7. 一次性动作：吸收 Codex 已有的 `ea8ad35`（已完成取回）

`ea8ad35` 的父提交正好是 GitHub main（`1322947`），二者内容等价，可以无损吸收。

**已完成（2026-09-12）**：已把交接目录的分支取回本仓库，成为本地分支 `codex/backend-backfill-1322947`（未合并、未部署）：

```sh
git fetch --update-shallow ~/Documents/ChatGPT/好球Ai/haoqiu-backend-handoff \
  codex/backend-backfill-1322947:codex/backend-backfill-1322947
```

（注：交接目录是浅克隆，必须带 `--update-shallow`，否则报 `shallow roots are not allowed to be updated`。
顺带一个收益：`1322947` 也随之进入本地仓库，弥补了本地缺失该 commit 的空白。）

**下一步（等缺口修完再做）**：把补丁落到基线分支上。已实测 `git diff 1322947 ea8ad35` 生成的补丁
对当前工作区 **可干净应用**，所以用 cherry-pick 即可：

```sh
git checkout codex/real-detection-integration
git cherry-pick ea8ad35          # 只 commit，不 push、不部署
```

之后 Codex 直接在这个分支上补完 `docs/开发需求-后端回填-补充修正.md` 的两处缺口。
之所以用 cherry-pick 而不是 merge：两边历史无共同祖先（unrelated histories），merge 会把每个文件都当成"双方新增"而大面积冲突。
