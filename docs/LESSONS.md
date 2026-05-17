# 踩坑教训 — 代码开发前必读

本文件记录本项目反复出现的 bug 模式。**每次修改代码前必须先读一遍。**

---

## Tauri 注意事项

### 命名约定

详见 `.claude/skills/tauri-command-pattern`（命令参数 camelCase vs 结构体 snake_case）。

### `window.__TAURI__` 不存在

详见 CLAUDE.md「约束」区（仅 `__TAURI_INTERNALS__`）。

### 不要配 `devUrl`

详见 CLAUDE.md「约束」区。

### WebView2 中 `draggable` 与 HTML5 DnD 不可靠

Tauri 的 WebView2（Edge Chromium）对 HTML5 Drag & Drop API 的支持不稳定。具体问题：

1. `draggable="true"` 在 `<button>` 和 `<div>` 上均可能无法启动拖拽，`setData()` 补了也不一定生效
2. **`draggable="true"` 会拦截低层级鼠标事件**——即使没有绑定 drag 事件，浏览器仍会拦截 `mousedown`→`mousemove` 序列，导致自定义的 `document.addEventListener('mousemove', ...)` 收不到事件
3. 同一行有 `draggable="true"` 和 `mousedown`/`mousemove`/`mouseup` 自定义拖拽时，症状表现为"拖不动"

**正确做法：**
- 在 Tauri 中实现拖拽排序，**用鼠标事件（mousedown/mousemove/mouseup）替代 HTML5 DnD API**
- 使用自定义拖拽时，**必须在元素上移除 `draggable="true"`**，否则浏览器会劫持鼠标事件
- 文档级事件（`document.addEventListener`）只绑定一次，不要在 `renderTabBar` 中重复绑定

**2026-05-09 复盘：** 第一次只补 `setData` 无效；第二次把 button 换成 div 仍然无效；第三次换成鼠标事件但没删 `draggable="true"` 依然无效；第四步去掉 `draggable` 才生效。真正的问题始终是 `draggable="true"` 对鼠标事件的劫持。

chrono 的 `DateTime::timestamp()` 返回**秒**，`timestamp_millis()` 返回**毫秒**。

---

## 前端规范

### 禁止 ES 模块 import

项目**无 `package.json`、无 `node_modules`、无打包器**，前端是原生 HTML/JS/CSS。

```js
// ❌ 禁止 —— 浏览器无法解析裸模块标识符
import { invoke } from '@tauri-apps/api/core';

// ✅ 必须 —— 使用 Tauri 内部 IPC
const invoke = (cmd, args) => window.__TAURI_INTERNALS__.invoke(cmd, args);
```

```html
<!-- ❌ 禁止 -->
<script type="module" src="main.js"></script>

<!-- ✅ 必须 -->
<script src="main.js"></script>
```

**症状：** `import` 失败 → 整个 JS 不执行 → 所有按钮没反应（详见 CLAUDE.md 约束区）。

### main.js 面板严格隔离

**2026-05-09 事故：** 修改存档管理时，子代理意外删除了时间转换面板的多个函数，导致输入值丢失、清空按钮消失。

操作规范详见 `.claude/skills/panel-isolation`（4 个独立面板 + 基础设施区块的隔离规则）。

---

## 架构与设计

### 实体关联用 ID，不要用名称

**2026-05-09 事故（与面板隔离同一次）：** 游戏改名后备份目录路径断裂，列表消失。实现模式详见 `.claude/skills/id-based-entities`。

`chrono-tz` 内嵌完整 IANA 时区数据库，在 Release 构建中贡献约 **2-3MB** 的静态数据。本项目只用 7 个时区（Asia/Shanghai、Asia/Kolkata、Asia/Tokyo、UTC、America/New_York、Europe/London、Australia/Sydney）。

**教训：** 全量时区库只为了 3 个 DST 场景（纽约/伦敦/悉尼）不值得。用固定偏移 + 手动 DST 规则替代，美国/欧盟/澳洲的夏令时规则固定可算，几十行代码就能省 2-3MB。

---

## 工作流程

### 修改前先给计划

用户偏好：做任何代码修改前，先说明计划和涉及的文件，等确认再动手。

---

## 复盘记录

### 2026-05-10：日志搜索框 CSS 反复修改无效

**症状：** 日志面板搜索框太小看不清，改了 3 轮才修好。

**项目上下文（通用原则见全局 CLAUDE.md — 调试时一次只改一个变量）：**
- 父容器 `.log-toolbar` 是 `display:flex`，搜索框和筛选下拉框在 flex 布局中争夺空间
- 第 1 轮加了 `.log-search-wrap` DOM 包装层，`overflow:hidden` 裁剪了输入框 → 完全消失
- 第 2 轮搜索框 `min-width:120px` 但 select 没约束宽度 → select 撑满剩余空间
- 最终方案：search input `flex:1; min-width:120px`，select `width:75px; flex-shrink:0`，不加包装层，纯 CSS 解决
- 教训：不改 DOM 结构能解决的不要加包装层——多一层 DOM 就多一个变量

### 2026-05-10：日志持久化的预期差异

**症状：** 用户以为所有日志都写入文件，实际只有 WARN+ 写入。叠加缓冲区 splice bug 导致切换筛选条件后数据变空。

**项目上下文（通用原则见全局 CLAUDE.md — 涉及用户可见行为的设计决策必须先确认）：**
- 计划文件 Task 3 中有一行 `// 只写 WARN+ 到文件` 的注释，AI 据此实现但没有向用户确认
- `doFlush` 中 `buffer.splice(0, buffer.length)` 在 flush 后清空了内存缓冲区
- 两个问题叠加：splice 让内存数据丢失，WARN+ 过滤让文件数据不全
- 修复：`doFlush` 改为写入全部级别（去掉 level filter），缓冲区保存数据直到内存上限（2000 条），用 splice 只裁剪超出部分

---

## 性能约束

### 先测量再优化，不要猜根因

2026-05-10 修复 release 版本全互联通卡顿的教训。

**最终根因：** `load_config()` 中每次调用 `set_auto_start()`，它内部执行 `std::process::Command::new("reg").output()`。在无控制台窗口的 Tauri GUI 应用中创建子进程有约 3.3 秒额外开销。由于几乎所有操作（启动、切备份 Tab、保存存档、改设置）都会调 `load_config`，导致看似全互联通都卡。

**修复：** 一行代码——从 `load_config` 移除 `set_auto_start`，只在 `set_config` 中执行。配置变更时同步注册表即可，没必要每次读配置都跑一次 `reg.exe`。

**验证数据：**
```
list_backups: load_config=3.294s, internal=253µs, total=3.295s
set_config: 3318ms
compute_hash: 4.7ms  ← 不调 load_config，快
```

**关键教训：**
- 不要在没有测量数据的情况下猜根因。前 7 次尝试（JS 内联、CSS 合成层、防抖、IPC 预热等）全是猜测，花费了 4+ 小时
- 遇到性能问题，第一件事是**加计时埋点**。用数据定位瓶颈，而不是靠理论分析
- 纯前端的猜测（JS 内联、CSS）解决不了 Rust 端的性能问题。如果先从 Rust 端入手，可以更快定位
- 双方都有问题：AI 应该更早提议加 Rust 端计时，用户应该更早描述"所有操作都慢"而非仅"切换卡顿"

### 不要在只读路径中执行写操作

`set_auto_start` 被放在 `load_config` 中是为了"确保注册表与应用配置一致"。但 `load_config` 是一个只读操作（被 `get_config` 和 `list_backups` 等调用），不应该在里面执行注册表写入。

**规则：**
- 名称为 `load_*`/`get_*`/`read_*` 的函数必须是只读的，不能有副作用
- 系统命令（`reg.exe` 等）只能在明确的写操作中执行，且不应高频调用
- GUI 应用中 `std::process::Command::output()` 创建子进程的开销远大于预期（~3.3s），应避免频繁调用

### Tab 切换：四条规则缺一不可

2026-05-10 修复 release 版本快速切 tab 卡死几秒的问题。修改涉及 src/main.js 和 src/styles.css。

**四条规则：**

1. **`switchTab` 必须有执行锁** — `_switchLock` 在切换完成（双重 rAF 后）才释放。锁期间忽略所有切换请求，避免并发全量 innerHTML 渲染阻塞主线程。加 5 秒超时解锁作为异常兜底。

2. **`will-change: opacity` 只能加在 `.panel.active`** — 现代 Chromium 在 `transition: opacity` 动画开始时自动提升到合成层，结束后释放。对全部 4 个面板永久声明 `will-change` 等于常驻 4 个 GPU 合成层，按"重叠传染"规则导致更多隐式提升。只需活动面板保持合成层，非活动面板让浏览器自动管理。

3. **`escapeHtml` 必须用纯字符串替换** — DOM 版（`document.createElement('div')` + `textContent` + `innerHTML`）每次调用创建临时节点，Tab 切换时调用数百次触发频繁 GC 暂停。纯正则需要替换：`&` → `&amp;`，`<` → `&lt;`，`>` → `&gt;`，`"` → `&quot;`，`'` → `&#39;`。

4. **Tab click handler 必须有防抖** — 300ms 内重复点击直接忽略，配合执行锁形成双层防护（防抖挡掉大部分连点，锁挡住竞态穿透）。

**验证方式：**
- `cargo tauri build` 构建 release 版本
- 快速连点不同 tab 20 次 → 不卡顿
- 日志面板查看 `TabSwitch PERF` 记录，确认无重叠调用
- Chrome DevTools Layers 面板确认只有 1 个合成层

**2026-05-10 复盘：** 此问题在 display:none→position:absolute 改造后仍存在，根因不是布局重算而是 4 个问题叠加。修改时有几条经验：
- `will-change` 滥用对集成显卡影响显著，开发机独立显卡可能在 dev 中掩盖问题，release 在用户集成显卡上才暴露
- 防抖 + 执行锁是两层独立防护，只加一层在高频场景下仍有窗口期

---

## 依赖管理

### 引入依赖前评估数据量级
