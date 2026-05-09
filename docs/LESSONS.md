# 踩坑教训 — 代码开发前必读

本文件记录本项目反复出现的 bug 模式。**每次修改代码前必须先读一遍。**

---

## Tauri 注意事项

### 命名约定：命令参数 ≠ 结构体字段

Tauri 2.0 对两个层级的命名处理不同：

| 层级 | 格式 | 谁负责 | 示例 |
|------|------|--------|------|
| 命令参数名（`invoke` 顶层 key） | **camelCase** | Tauri 宏 | `game_name` → `invoke('xxx', { gameName: ... })` |
| 结构体字段（嵌套对象 / 返回值） | **snake_case** | serde 默认 | `AppConfig.backup_root` → `{ config: { backup_root: ... } }` |
| 无下划线字段（`success`, `message`） | 两种一致 | 不纠结 | — |

**常见错误：**
- 把结构体字段也改成 camelCase → `currentConfig.gameNames` 读到 `undefined` → `.length` 抛异常
- 把命令参数写成 snake_case → Tauri 报 `missing required key gameName`

### `window.__TAURI__` 不存在

Tauri 2.10 已移除 `window.__TAURI__`，只有 `window.__TAURI_INTERNALS__`。

```js
// ❌ 错误
import { invoke } from '@tauri-apps/api/core';
window.__TAURI__.core.invoke();

// ✅ 正确
const invoke = (cmd, args) => window.__TAURI_INTERNALS__.invoke(cmd, args);
```

### 不要配 `devUrl`

`tauri.conf.json` 中的 `devUrl` 会让 Tauri 尝试连接外部 dev server。当前项目没有 dev server，配了会导致 `cargo tauri dev` 卡住。删掉 `devUrl`，Tauri 会直接从 `frontendDist`（`./src`）提供文件。

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

**症状：** import 失败时整个 JS 不执行，所有事件监听器都不注册，表现为"所有按钮都没反应"。

### main.js 面板严格隔离

`main.js` 包含三个完全独立的功能面板，共用同一个文件但**没有任何共享状态或逻辑**：

| 面板 | 核心函数 | HTML 容器 |
|------|---------|----------|
| 时间转换 | `renderTimezoneSets`, `saveTimezoneValues`, `restoreTimezoneValues`, `initTimezoneDefaults` | `#timezoneSets` |
| 存档管理 | `renderGameTabs`, `renderSlotTabs`, `renderFileTags`, `refreshBackupList` | `#gameTabs`, `#slotTabs`, `#fileTags`, `#backupList` |
| 待办工具 | `renderTodos`, `openTodoEditModal`, `toggleTodoDone` | `#todoList` |

**2026-05-09 事故：** 修改存档管理时，子代理意外删除了时间转换面板的多个函数，导致输入值丢失、清空按钮消失。

**规则：**
- 修改 `main.js` 前，先用 `// ====================` 分隔注释定位目标区块
- 三个面板区块互不相关，**修改一个绝不能动另一个的代码**
- 代码审查必须 diff 对比原始文件，确认未改动的区块确实未被触碰
- 如果函数被多个面板共用（如 `escapeHtml`, `setButtonLoading`），修改时需确认两端兼容
- 时间转换区块（L60~L280 附近）与存档管理区块（L280~EOF 附近）互不相关

---

## 架构与设计

### 实体关联用 ID，不要用名称

**任何可改名的实体，关联关系必须用不可变 ID，不能用名称。**

| 场景 | 错误做法（名称） | 正确做法（ID） |
|------|-----------------|---------------|
| 游戏/存档位标识 | `selectedGame = "塞尔达"` | `selectedGameId = "uuid-xxx"` |
| 备份目录路径 | `backup_root/塞尔达/存档1/` | `backup_root/{game_id}/{slot_id}/` |
| 前端键 | `filePathBySlot["塞尔达:存档1"]` | `filePathBySlot["uuid:uuid"]` |
| 配置文件关联 | 用名称数组关联 | 用 ID 做唯一标识 |

**为什么：** 名称是可变的（改名功能），一旦改名：
- 磁盘目录找不到了 → 备份列表消失
- 内存键对不上了 → 文件路径丢失
- 配置引用了不存在的名称 → 数据断裂

**规则：**
- 任何用户可编辑名称的实体，必须有不可变 ID（UUID）
- 目录路径、存储键、跨实体引用一律用 ID
- `name` 只用于 UI 展示，不作为关联依据
- 前端用 `crypto.randomUUID()` 生成

---

## 依赖管理

### 引入依赖前评估数据量级

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

## 依赖管理

### 引入依赖前评估数据量级
