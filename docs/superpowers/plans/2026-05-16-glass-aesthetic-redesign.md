# 极简玻璃风格重设计 — 实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 对 HRB Tools 进行纯样式层 UI 重构，采用毛玻璃质感 + 浮动卡片 + Mac 风格标题栏的设计语言。

**方法：** 6 步渐进式迁移，每步独立可验证。先改 CSS 变量体系，再改造标题栏 → Tab 栏 → 面板容器 → 组件微调 → 全量验证。

**涉及文件：**
- `src/styles.css` — 所有样式修改
- `src/index.html` — 标题栏按钮 + panel-inner 包裹层
- `src/main.js` — renderTabBar() 中去掉 label、添加 title

**不修改：** 功能逻辑、事件委托、Rust 后端

---

### 任务 1：更新 CSS 变量体系

**文件：** `src/styles.css:1-83`

- [ ] **Step 1: 修改 `:root` 变量**

将 `:root` 块（styles.css 第 1-53 行）中的以下变量更新：

```css
:root {
    /* 颜色 — 暗色模式 */
    --bg: #1a1e2e;                    /* 原 #212539 → 加深 */
    --bg-alt: #1a1e2e;               /* 原 #1a1e2e → 与 bg 统一 */
    --surface: rgba(255,255,255,0.06); /* 原 0.04 → 略提升 */
    /* 其他不变 */

    /* 新增变量（放在 --shadow 之后） */
    --glass-bg: rgba(255,255,255,0.04);
    --glass-border: rgba(255,255,255,0.08);
    --radius-glass: 14px;

    /* radius-xl 改为 16px */
    --radius-xl: 16px;
}
```

只需要修改的值：`--bg`、`--bg-alt`、`--surface`、`--radius-xl`
需要新增的变量：`--glass-bg`、`--glass-border`、`--radius-glass`

- [ ] **Step 2: 修改 `body.light` 变量**

```css
body.light {
    --bg: #f0f2f5;                    /* 原 #f5f6f8 */
    --surface: rgba(255,255,255,0.7);  /* 原 0.04 */
    /* --bg-alt、其他颜色不变 */

    --glass-bg: rgba(255,255,255,0.6);
    --glass-border: rgba(0,0,0,0.06);
}
```

- [ ] **Step 3: 验证**

重启应用（`cargo tauri dev`），检查暗色/亮色切换后背景色正确。

- [ ] **Step 4: 提交**

```bash
git add src/styles.css
git commit -m "style: update CSS variables for glass aesthetic (--bg, --glass-bg, --radius-xl)"
```

---

### 任务 2：改造标题栏 — Mac 风格圆点控制按钮

**文件：** `src/index.html:18-25`、`src/styles.css:117-153`

- [ ] **Step 1: 替换 index.html 中的窗口控制按钮**

将：

```html
<button class="title-bar-btn" id="settingsBtn" title="设置">&#9881;</button>
<button class="title-bar-btn" id="minimizeBtn" title="最小化">&#x2014;</button>
<button class="title-bar-btn" id="maximizeBtn" title="最大化">&#x25A1;</button>
<button class="title-bar-btn title-bar-close" id="closeBtn" title="关闭">&#x2715;</button>
```

改为：

```html
<div class="window-controls">
    <button class="win-ctrl win-close" id="closeBtn" title="关闭">
        <span class="win-ctrl-icon">&#x2715;</span>
    </button>
    <button class="win-ctrl win-minimize" id="minimizeBtn" title="最小化">
        <span class="win-ctrl-icon">&#x2014;</span>
    </button>
    <button class="win-ctrl win-maximize" id="maximizeBtn" title="最大化">
        <span class="win-ctrl-icon">&#x25A1;</span>
    </button>
</div>
<span class="title-bar-text">HRB Tools</span>
```

(注意把 settingsBtn 移到标题栏最右侧，与窗口控制分开)

设置按钮保留原样，放在最右侧：

```html
<span class="title-bar-spacer"></span>
<button class="title-bar-btn" id="settingsBtn" title="设置">&#9881;</button>
```

完整标题栏变为：

```html
<div class="title-bar">
    <div class="window-controls">
        <button class="win-ctrl win-close" id="closeBtn" title="关闭"><span class="win-ctrl-icon">&#x2715;</span></button>
        <button class="win-ctrl win-minimize" id="minimizeBtn" title="最小化"><span class="win-ctrl-icon">&#x2014;</span></button>
        <button class="win-ctrl win-maximize" id="maximizeBtn" title="最大化"><span class="win-ctrl-icon">&#x25A1;</span></button>
    </div>
    <span class="title-bar-text">HRB Tools</span>
    <span class="title-bar-spacer"></span>
    <button class="title-bar-btn" id="settingsBtn" title="设置">&#9881;</button>
</div>
```

- [ ] **Step 2: 更新 styles.css 标题栏样式**

替换 `.title-bar` 块（第 117-153 行）：

```css
.title-bar {
    display: flex;
    align-items: center;
    padding: 6px 16px;
    background: var(--titlebar-bg);
    border-bottom: 1px solid var(--border);
    -webkit-app-region: drag;
    flex-shrink: 0;
    user-select: none;
    gap: 12px;
}

.title-bar-text {
    font-size: 0.85rem;
    font-weight: 600;
    color: var(--text-muted);
    flex-shrink: 0;
    -webkit-app-region: no-drag;
}

.title-bar-spacer { flex: 1; }

.title-bar-btn {
    width: auto;
    margin: 0;
    padding: 5px 12px;
    font-size: 0.85rem;
    background: transparent;
    color: var(--text-muted);
    border: none;
    cursor: pointer;
    border-radius: 6px;
    line-height: 1;
    -webkit-app-region: no-drag;
    flex-shrink: 0;
    transition: background 0.15s, color 0.15s;
}
.title-bar-btn:hover { background: var(--surface-hover); color: var(--text); }

/* ─── Mac 风格窗口控制按钮 ─── */
.window-controls {
    display: flex;
    align-items: center;
    gap: 8px;
    -webkit-app-region: no-drag;
}

.win-ctrl {
    width: 14px;
    height: 14px;
    border-radius: 50%;
    border: none;
    padding: 0;
    margin: 0;
    cursor: pointer;
    position: relative;
    display: flex;
    align-items: center;
    justify-content: center;
    transition: filter 0.15s;
}

.win-ctrl .win-ctrl-icon {
    font-size: 9px;
    line-height: 1;
    opacity: 0;
    transition: opacity 0.15s;
    color: rgba(0,0,0,0.6);
    position: absolute;
}

.win-ctrl:hover .win-ctrl-icon { opacity: 1; }

.win-close    { background: #ff5f57; border: 1px solid #e04944; }
.win-minimize { background: #febc2e; border: 1px solid #dba222; }
.win-maximize { background: #28c840; border: 1px solid #1aaa34; }

.win-close:hover    { filter: brightness(1.1); }
.win-minimize:hover { filter: brightness(1.1); }
.win-maximize:hover { filter: brightness(1.1); }
```

- [ ] **Step 3: 验证**

重启应用。检查：
- 红黄绿圆点显示正确
- 悬停时显示对应图标
- 设置按钮在最右侧，功能正常
- 标题栏可拖拽区域无冲突
- 关闭/最小化/最大化功能正常

- [ ] **Step 4: 提交**

```bash
git add src/index.html src/styles.css
git commit -m "style: redesign title bar with Mac-style window controls (red/yellow/green dots)"
```

---

### 任务 3：改造 Tab 栏 — 图标-only + 毛玻璃激活态

**文件：** `src/main.js:61-79`、`src/styles.css:163-212`

- [ ] **Step 1: 更新 `renderTabBar()` 去掉文字标签、添加 title**

修改 `src/main.js` 第 68-76 行：

将：

```js
tabBar.innerHTML = order.map(id => {
    const def = TAB_DEFS[id];
    if (!def) return '';
    const active = id === currentTab ? ' active' : '';
    return `<div class="tab${active}" data-tab="${id}" role="button" tabindex="0">
        <span class="tab-icon">${def.icon}</span>
        <span class="tab-label">${def.label}</span>
    </div>`;
}).join('');
```

改为：

```js
tabBar.innerHTML = order.map(id => {
    const def = TAB_DEFS[id];
    if (!def) return '';
    const active = id === currentTab ? ' active' : '';
    return `<div class="tab${active}" data-tab="${id}" role="button" tabindex="0" title="${def.label}">
        <span class="tab-icon">${def.icon}</span>
    </div>`;
}).join('');
```

- [ ] **Step 2: 更新 styles.css Tab 栏样式**

替换 `.tab-bar` 块（第 163-212 行）：

```css
.tab-bar {
    display: flex;
    flex-direction: column;
    gap: 10px;
    padding: 24px 8px;
    background: transparent;
    border-right: 1px solid var(--border);
    width: 64px;
    flex-shrink: 0;
}

.tab {
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: 4px;
    padding: 12px 4px;
    background: transparent;
    border: none;
    border-radius: 12px;
    cursor: pointer;
    color: var(--text-secondary);
    transition: background 0.2s, color 0.2s, opacity 0.15s;
    width: 100%;
}

.tab.dragging {
    opacity: 0.35;
    transform: scale(0.92);
    transition: opacity 0.15s, transform 0.15s;
}

.tab.drop-indicator {
    border-top: 3px solid var(--accent);
    box-shadow: 0 -2px 8px rgba(var(--accent-rgb), 0.25);
}

.tab:hover {
    background: rgba(255,255,255,0.05);
    color: var(--text);
}

.tab.active {
    background: rgba(255,255,255,0.08);
    backdrop-filter: blur(4px);
    -webkit-backdrop-filter: blur(4px);
    color: var(--text);
}

.tab-icon { font-size: 1.8rem; line-height: 1; }
```

删除 `.tab-label` 相关样式（第 212 行）。

- [ ] **Step 3: 验证**

重启应用。检查：
- Tab 栏宽度变为 64px
- 只显示图标，无文字标签
- hover 显示 tooltip（浏览器原生 title）
- 拖拽排序功能正常
- 激活态有毛玻璃效果

- [ ] **Step 4: 提交**

```bash
git add src/main.js src/styles.css
git commit -m "style: redesign tab bar — icon-only, 64px wide, glass active state"
```

---

### 任务 4：添加 `.panel-inner` 玻璃卡片容器

**文件：** `src/index.html`、`src/styles.css`

- [ ] **Step 1: 在 index.html 的 4 个面板中添加 .panel-inner 包裹**

面板位置：
1. `#panel-convert` — 第 41 行
2. `#panel-backup` — 第 50 行
3. `#panel-todo` — 第 90 行
4. `#panel-log` — 第 115 行

每个面板修改方式相同，以 `#panel-convert` 为例：

```html
<div class="panel active" id="panel-convert">
    <div class="panel-inner">
        <div class="timezone-sets" id="timezoneSets">
            <!-- 动态生成 .tz-set -->
        </div>
        <button class="tz-add-btn" id="addTimezoneBtn">+ 新增时区</button>
        <div id="startupTiming" style="margin-top:8px;font-size:0.7rem;color:var(--text-dim,#888);text-align:center;"></div>
    </div>
</div>
```

对 `#panel-backup`、`#panel-todo`、`#panel-log` 做同样操作。

**注意待办面板** — 当前 `#panel-todo.active` 使用 flex 布局。包裹后 `.panel-inner` 需要透传 flex。

- [ ] **Step 2: 添加 .panel-inner CSS 样式**

在 `styles.css` 的 `.panel` 样式之后（第 242 行之后）添加：

```css
/* ==================== 玻璃卡片容器 ==================== */
.panel-inner {
    background: var(--glass-bg);
    border: 1px solid var(--glass-border);
    border-radius: var(--radius-glass);
    padding: 24px 28px;
    backdrop-filter: blur(12px);
    -webkit-backdrop-filter: blur(12px);
    height: 100%;
}

/* 待办和日志面板需要 flex 布局 */
#panel-todo.active .panel-inner,
#panel-log .panel-inner {
    display: flex;
    flex-direction: column;
    height: 100%;
}

#panel-todo .todo-list,
#panel-log .log-entries {
    flex: 1;
    min-height: 0;
}

.panel {
    overflow-y: auto;
}
```

同时更新 `.panel` 本身（第 224-242 行），去掉之前的 padding 等效偏移（`top: 24px; left: 28px; right: 28px; bottom: 24px` 中的 `left/right` 保持不变，因为 `.panel-inner` 现在提供内边距）：

保持 `.content` 的 padding 提供外间距，`.panel` 的 `top/left/right/bottom` 改为统一 `16px`（缩小外间距，让玻璃卡片的 `1px border + 24px padding` 提供呼吸感）：

```css
.panel {
    display: block;
    position: absolute;
    top: 16px;
    left: 16px;
    right: 16px;
    bottom: 16px;
    overflow-y: auto;
    opacity: 0;
    pointer-events: none;
    visibility: hidden;
    transition: opacity 0.2s ease, visibility 0.2s ease;
}
.panel.active {
    opacity: 1;
    pointer-events: auto;
    visibility: visible;
    will-change: opacity;
}
```

- [ ] **Step 3: 验证**

重启应用。检查：
- 每个面板内容显示在玻璃卡片内
- 卡片有毛玻璃效果（blur）
- 面板切换动画正常
- 待办面板 flex 布局正常（列表占满剩余空间）
- 日志面板 flex 布局正常
- 内容滚动正常，无嵌套滚动条

- [ ] **Step 4: 提交**

```bash
git add src/index.html src/styles.css
git commit -m "style: add .panel-inner glass card containers for all panels"
```

---

### 任务 5：组件样式微调 — 按钮、输入框、弹窗、待办、加载、横幅

**文件：** `src/styles.css`

- [ ] **Step 1: 按钮样式更新**

修改通用按钮（第 289-312 行）：

```css
button {
    background: var(--accent);
    color: #fff;
    border: none;
    width: 100%;
    padding: 0.55rem 1.8rem;
    font-size: var(--font-md);
    font-weight: 600;
    border-radius: 24px;
    cursor: pointer;
    transition: background 0.15s, opacity 0.15s;
    margin-top: 0.3rem;
}

button:hover { background: var(--accent-hover); }
button:active { opacity: 0.9; }

button:disabled {
    opacity: 0.5;
    cursor: not-allowed;
}
button:disabled:hover { background: var(--accent); }
```

`.btn-small`（第 322-329 行）：

```css
.btn-small {
    width: auto;
    padding: 0.5rem 1rem;
    font-size: var(--font-sm);
    flex-shrink: 0;
    margin-top: 0;
    border-radius: 16px;
}
```

- [ ] **Step 2: 输入框 + 选择框样式更新**

修改 `input, select`（第 268-284 行）：

```css
input, select {
    width: 100%;
    padding: 0.55rem 0.9rem;
    border: 1px solid var(--border-strong);
    border-radius: 10px;
    font-size: var(--font-md);
    background: var(--input-bg);
    color: var(--text);
    transition: border-color 0.2s, box-shadow 0.2s;
}

input:focus, select:focus {
    outline: none;
    border-color: rgba(var(--accent-rgb), 0.5);
    box-shadow: 0 0 0 2px rgba(var(--accent-rgb), 0.15);
}
```

- [ ] **Step 3: 弹窗样式更新**

修改 `.modal`（第 941-948 行）：

```css
.modal {
    background: var(--glass-bg);
    border: 1px solid var(--glass-border);
    border-radius: 16px;
    width: 420px;
    box-shadow: 0 24px 60px var(--shadow);
    overflow: hidden;
    backdrop-filter: blur(16px);
    -webkit-backdrop-filter: blur(16px);
}
```

- [ ] **Step 4: 待办组件微调**

修改 `.todo-item`（第 1181 行附近）：

```css
.todo-item {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 12px 14px;
    border-radius: 10px;
    transition: background 0.15s;
    cursor: default;
}
```

修改 `.todo-check`（第 1208 行附近）：

```css
.todo-check {
    width: 22px;
    height: 22px;
    border: 2px solid var(--border-strong);
    border-radius: 50%;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    cursor: pointer;
    flex-shrink: 0;
    font-size: 14px;
    color: transparent;
    transition: background 0.15s, border-color 0.15s;
}
```

修改待办编辑弹窗 `.todo-edit-modal`（第 1336 行）：

```css
.todo-edit-modal {
    background: var(--glass-bg);
    border: 1px solid var(--glass-border);
    border-radius: 16px;
    padding: 28px;
    width: 560px;
    max-width: 90vw;
    max-height: 90vh;
    overflow-y: auto;
    backdrop-filter: blur(16px);
    -webkit-backdrop-filter: blur(16px);
    box-shadow: 0 24px 60px var(--shadow);
}
```

- [ ] **Step 5: 加载遮罩样式更新**

修改 `.loading-spinner`（第 1552 行附近）：

```css
.loading-spinner {
    width: 48px;
    height: 48px;
    border: 5px solid var(--border);
    border-top-color: var(--accent);
    border-radius: 50%;
    animation: spin 0.8s linear infinite;
}
```

修改 `.loading-overlay`（第 1534 行）：

```css
.loading-overlay {
    position: fixed;
    inset: 0;
    z-index: 9999;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: 16px;
    background: var(--bg);
    transition: opacity 0.3s ease;
    backdrop-filter: blur(4px);
    -webkit-backdrop-filter: blur(4px);
}
```

- [ ] **Step 6: Toggle 开关样式更新**

修改 `.toggle-switch[data-state="on"]`（第 344 行附近），改为带微透明度的 accent 色：

```css
.toggle-switch[data-state="on"] {
    background: rgba(var(--accent-rgb), 0.85);
    border-color: rgba(var(--accent-rgb), 0.5);
}
```

- [ ] **Step 7: 提醒横幅样式更新**

修改 `.banner-item`（第 1098 行）：

```css
.banner-item {
    display: flex;
    align-items: center;
    background: transparent;
    color: var(--danger-text);
    padding: 8px 18px;
    font-size: var(--font-sm);
    font-weight: 500;
    gap: 10px;
    cursor: default;
    user-select: none;
    border-left: 4px solid var(--danger-text);
    border-radius: 6px;
    margin: 4px 16px;
    background: var(--danger-bg);
}

.banner-item-close {
    flex-shrink: 0;
    background: transparent;
    border: 1px solid rgba(248,113,113,0.3);
    color: var(--danger-text);
    font-size: 12px;
    line-height: 1;
    width: 22px;
    height: 22px;
    border-radius: 6px;
    cursor: pointer;
    display: flex;
    align-items: center;
    justify-content: center;
    padding: 0;
    transition: background 0.15s;
}
.banner-item-close:hover {
    background: rgba(248,113,113,0.15);
}
```

- [ ] **Step 8: 验证**

重启应用。全面检查：
- 所有按钮为胶囊圆角，:active 为 opacity 变化
- 输入框圆角 10px，focus 阴影 2px
- 设置弹窗圆角 16px，有毛玻璃效果
- 待办项圆角 10px，勾选圆圈 22px
- 加载 spinner 48px / 5px 边框
- Toggle 开关开启态带微透明
- 提醒横幅左侧彩色竖条样式
- 暗色/亮色切换全部正常

- [ ] **Step 9: 提交**

```bash
git add src/styles.css
git commit -m "style: refine component styles — glass modals, capsule buttons, rounded inputs"
```

---

### 任务 6：全量验证

- [ ] **Step 1: 暗色模式验证**

逐面板检查：
- **时间转换面板** — 时区卡片在玻璃容器中正常显示，下拉框/输入框样式正确
- **存档管理面板** — 游戏Tab/存档位/文件标签、按钮、备份列表全部可见无错位
- **待办面板** — 搜索栏、筛选、列表、编辑弹窗毛玻璃效果
- **日志面板** — 搜索、级别筛选、日志条目

- [ ] **Step 2: 亮色模式验证**

切换亮色模式，重复 Step 1 的全面检查。特别注意：
- 玻璃卡片在浅色背景下的可见性
- 文字对比度是否足够
- 输入框白色背景正确

- [ ] **Step 3: 功能回归**

快速验证核心功能未受影响：
- Tab 切换：点击每个 Tab 面板切换正确
- Tab 拖拽：拖拽排序
- 待办：新建/编辑/完成/删除
- 设置：打开/关闭弹窗，主题切换

- [ ] **Step 4: 最终提交**

```bash
git add -A
git commit -m "style: complete glass aesthetic redesign — full UI polish with frosted glass, Mac title bar, and unified component styles"
```
