# 好球Ai · 数据看板视觉炫酷升级（V1.3）

> 在 V1.2「亮点称号」基础上，把看板视觉升级为「吸引人、炫酷」。依据 impeccable 的 bolder.md / animate.md 规范。

## 一、美学方向

「**球场记分牌**」——电视转播数据面板的戏剧张力 + 荣誉勋章质感。英雄时刻 = 球员的「亮点大数字 + 称号勋章」。

## 二、视觉要点

1. **hero = 亮点大数字**：LED 记分牌风格——凹陷深色显示窗内放超大亮色数字（等宽/展示字体），`clamp` 做到 3~5 倍于辅助数据的字号。
2. **勋章**：金质奖章 + 光泽质感（径向渐变 + 高光），不是 emoji。
3. **背景**：深绿球场 + 草皮纹理（CSS subtle 纹理，如 repeating-linear-gradient 模拟草纹/割草纹），**非纯色平铺**。
4. **层级放大**：大的更大、小的更小——亮点数字压倒性主角，辅助数据一行 11px 小字，综合分弱化为右上角小方块。
5. **位置徽章**：前锋暖红 / 中场薄荷 / 后卫钢蓝三色胶囊，不抢金色主角。

## 三、动效（impeccable animate 规范）

1. **卡片 stagger 入场**：球员卡片 50–150ms 依次滑入 + 淡入。
2. **亮点数字 count-up**：0 → 实际值，约 600–900ms，`ease-out-expo`。
3. **勋章弹出**：scale 0.6 → 1 + 轻微 overshoot 感，`ease-out-expo`（**不用 bounce/elastic**）。
4. **全队总览数字也 count-up**。
5. **尊重 `prefers-reduced-motion`**：降级为无动效直接显示。

## 四、必须避免（AI slop 红线）

- ❌ 紫蓝渐变、玻璃态（glassmorphism）、霓虹光晕、渐变文字
- ❌ bounce / elastic 缓动
- ❌ 纯黑 #000 / 纯白 #fff
- ❌ 无目的堆特效、动画疲劳

## 五、技术

- 优先 CSS animation + 自写 count-up（requestAnimationFrame）；GSAP 已装可用但非必需。
- 移动端优先，60fps，动效用 transform/opacity（GPU 加速）。

## 六、验收

看板有明显「炫酷、吸引人」的观感；动效流畅不卡；`prefers-reduced-motion` 可用；`npm run build` 通过。
