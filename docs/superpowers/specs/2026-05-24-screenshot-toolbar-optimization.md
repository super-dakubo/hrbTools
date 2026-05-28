# 截图工具栏优化

## 概述

优化截图面板的工具栏：来源下拉列表样式、布局改为单行、添加切换动效。

## 改动清单

### 1. CSS — `src/styles.css`

**布局修复：**
- `.ss-toolbar`: `flex-wrap: wrap` → `flex-wrap: nowrap`，强制所有控件在一行

**下拉样式统一：**
- `.ss-toolbar select`: `background: var(--surface)` → `background: var(--glass-bg)`
- 添加 `backdrop-filter: blur(8px)`，与 toolbar 容器保持一致
- `border-radius: 8px` → `10px`（比输入框略大，作为视觉重心）
- `min-width: 160px` → `min-width: 120px`，保证不会撑破一行
- 保留自定义 SVG 箭头和 `appearance: none`

**切换动效：**
- 新增 CSS class `.ss-grid.switching`:
  - `opacity: 0; transform: translateY(6px); transition: none`
- `.ss-grid` 添加基础过渡:
  - `transition: opacity 0.3s ease, transform 0.3s ease`

### 2. JS — `src/main.js`

**`renderToolbar()` — options 加 emoji 前缀：**
- 不再直接使用 `escapeHtml(s.name)` 作为 option 文本
- 根据 source 的 name/path 特征分配 emoji（路径含 `Genshin`/`原神` → 📷，`StarRail`/`星穹` → 🎮，`Zenless`/`绝区零` → 🗺️，`Steam` → 🖥️，其余 → 📁）
- emoji 映射规则作为 `_ssEmojiForSource(name, path)` 函数

**`renderGrid()` — 切换动画：**
- 在 `scanScreenshots` 成功回调 / 切换来源时调用动画序列：
  1. 给 `.ss-grid-container` 添加 `.switching` 类
  2. `requestAnimationFrame` 等待一帧
  3. `requestAnimationFrame` 移除 `.switching` 类（触发 transition）

### 3. 不修改的部分

- 两行布局变为一行是唯一布局改动，其他布局不变
- 搜索框、添加按钮、刷新按钮样式不变
- 截图网格卡片样式不变
- 所有事件绑定逻辑不变
- 所有后端 Rust 代码不变
