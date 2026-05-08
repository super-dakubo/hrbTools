# HRB Tools 设计系统

本文件记录项目的 UI/UX 标准。**任何涉及前端样式、布局、交互的修改，开发前必须先读本文件。**

---

## 1. 主题系统

### 三种模式

| 模式 | config 值 | 行为 |
|------|----------|------|
| 跟随系统 | `"system"`（默认） | 检测 Windows `prefers-color-scheme`，自动跟随 |
| 暗色模式 | `"dark"` | 强制暗色 |
| 亮色模式 | `"light"` | 强制亮色 |

### 实现机制

- CSS 变量定义在 `:root` 块（暗色默认），亮色覆盖在 `body.light` 块
- 所有颜色必须通过 CSS 变量引用，**禁止硬编码颜色值**
- JS `applyTheme(theme)` 负责切换 `body.light` class 和更新按钮文字
- 新增 UI 时，颜色一律用已有变量；如需新颜色令牌，先在此文档注册

### 系统模式检测

```js
window.matchMedia('(prefers-color-scheme: dark)')
```

---

## 2. 颜色令牌

### 语义色

| 变量 | 暗色值 | 亮色值 | 用途 |
|------|--------|--------|------|
| `--bg` | `#212539` | `#f0f2f5` | 主背景 |
| `--bg-alt` | `#1a1e2e` | `#e4e6e9` | 备选背景 |
| `--surface` | `rgba(255,255,255,0.04)` | `rgba(0,0,0,0.03)` | 卡片/面板底 |
| `--surface-hover` | `rgba(255,255,255,0.07)` | `rgba(0,0,0,0.06)` | hover 态 |
| `--input-bg` | `rgba(255,255,255,0.05)` | `rgba(0,0,0,0.04)` | 输入框背景 |
| `--titlebar-bg` | `rgba(0,0,0,0.3)` | `rgba(0,0,0,0.08)` | 标题栏 |
| `--tab-bar-bg` | `rgba(0,0,0,0.25)` | `rgba(0,0,0,0.04)` | 左侧 Tab 栏 |

### 文字色

| 变量 | 用途 |
|------|------|
| `--text` | 主文字 |
| `--text-secondary` | 标签、描述文字 |
| `--text-muted` | 占位符、提示 |
| `--text-dim` | 极淡文字 |

### 边框色

| 变量 | 用途 |
|------|------|
| `--border` | 细微分割线 |
| `--border-strong` | 输入框边框 |

### 功能色

| 变量 | 用途 |
|------|------|
| `--accent` | 主按钮、激活态（`#4b8bf4`） |
| `--accent-hover` | 按钮 hover（`#5c9af7`） |
| `--danger-bg/text/border` | 危险操作（删除等） |
| `--success-bg/text` | 成功提示 |
| `--error-bg/text` | 错误提示 |
| `--pin-color` | 置顶图钉（`#fbbf24`） |
| `--shadow` | 阴影 |
| `--scrollbar-thumb` | 滚动条 |

---

## 3. 排版

### 字号

| 变量 | 值 | 用途 |
|------|-----|------|
| `--font-xs` | `0.6rem` | 标签辅助文字、badge |
| `--font-sm` | `0.72rem` | 时间戳输入、存档路径 |
| `--font-base` | `0.8rem` | 正文、标签名、按钮 |
| `--font-md` | `0.9rem` | h3 标题、输入框 |
| `--font-lg` | `1.1rem` | h1 面板标题 |
| `--font-xl` | `1.3rem` | 转换结果大字 |

### 规则

- 全局字体：`system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif`
- 新增文字元素使用上述变量，不硬编码 `font-size`
- 标题用 `font-weight: 600`，正文 `400`-`500`

---

## 4. 圆角

| 变量 | 值 | 用途 |
|------|-----|------|
| `--radius-sm` | `4px` | 小按钮、badge、箭头按钮 |
| `--radius` | `6px` | 通用按钮、输入框、面板 |
| `--radius-lg` | `8px` | 卡片、弹窗 |
| `--radius-xl` | `12px` | 模态框 |
| `--radius-pill` | `15px` | 存档位胶囊标签 |

---

## 5. 间距

| 变量 | 值 | 用途 |
|------|-----|------|
| `--space-xs` | `4px` | 元素内间距、图标间距 |
| `--space-sm` | `6px` | Tab 间距、标签间距 |
| `--space-md` | `10px` | 面板内边距、区块间距 |
| `--space-lg` | `16px` | 面板 padding |
| `--space-xl` | `24px` | 内容区 padding |

---

## 6. 组件标准

### 按钮

| 类型 | Class | 颜色 | 尺寸 |
|------|-------|------|------|
| 主按钮 | `button` | `var(--accent)` | `padding: 0.6rem; font-size: var(--font-base)` |
| 小按钮 | `.btn-small` | `var(--accent)` | `padding: 0.45rem 0.8rem; font-size: var(--font-sm)` |
| 微型按钮 | `.btn-tiny` | 透明底 | `padding: 0.25rem 0.6rem; font-size: var(--font-xs)` |
| 危险按钮 | `.btn-danger` | `var(--danger-bg/text/border)` | `padding: 0.25rem 0.6rem; font-size: var(--font-sm)` |
| 置顶按钮 | `.btn-pin` | 透明底 | `padding: 0.2rem 0.35rem; font-size: var(--font-sm)` |

按钮通用规则：
- `border-radius: var(--radius)`（主）/ `var(--radius-sm)`（小）
- `disabled` 态：`opacity: 0.5; cursor: not-allowed`
- 异步操作必须调用 `setButtonLoading()` / `resetButton()` 防重复
- 所有按钮文字使用 `var(--text)`，确保主题适配

### 输入框

- 全局 `<input>, <select>`：`padding: 0.55rem 0.7rem`
- 边框：`1px solid var(--border-strong)`
- 背景：`var(--input-bg)`
- 文字：`var(--text)`
- 圆角：`var(--radius-lg)`
- focus：蓝色发光 `rgba(100,150,255,0.5)`

### 模态弹窗

- 遮罩：`position: absolute; inset: 0; background: rgba(0,0,0,0.6)`
- 弹窗：`background: var(--bg); border: 1px solid var(--border); border-radius: var(--radius-xl)`
- 标题：`font-size: var(--font-md); font-weight: 600`
- 关闭按钮：透明底，hover 变亮

---

## 7. 开发规范

### 新增 UI 前必读

1. 颜色：只用 CSS 变量，不写硬编码色值
2. 字号：用排版变量，不写裸 `font-size`
3. 圆角/间距：用对应变量
4. 主题适配：新增组件需在暗/亮两种模式下测试
5. 按钮防重复：异步操作的按钮必须加 loading 态

### 修改标准后

1. 更新本文件对应章节
2. 确认两种主题下效果一致
3. 提交时标注 `docs: update design-system`

### 自动化提示

- 新增 CSS 变量前，检查是否已有语义相近的令牌可复用
- 设计评审时，打开暗/亮两种模式截图对比

---

## 8. 窗口标准

- 尺寸：700×580（tauri.conf.json）
- 不可缩放：`resizable: false`
- 无边框：`decorations: false`
- 自定义标题栏：`.title-bar`，拖拽区域 `-webkit-app-region: drag`
- 窗口控制按钮：最小化、最大化、关闭（Rust 命令实现）
