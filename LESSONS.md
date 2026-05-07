# 踩坑教训 — 代码开发前必读

本文件记录本项目反复出现的 bug 模式。**每次修改代码前必须先读一遍。**

---

## 1. 命名约定：命令参数 ≠ 结构体字段

这是出错最多的坑。Tauri 2.0 对两个层级的命名处理不同：

| 层级 | 格式 | 谁负责 | 示例 |
|------|------|--------|------|
| 命令参数名（`invoke` 顶层 key） | **camelCase** | Tauri 宏 | `game_name` → `invoke('xxx', { gameName: ... })` |
| 结构体字段（嵌套对象 / 返回值） | **snake_case** | serde 默认 | `AppConfig.backup_root` → `{ config: { backup_root: ... } }` |
| 无下划线字段（`success`, `message`） | 两种一致 | 不纠结 | — |

**规则**：命令参数是 Tauri 管的（自动转驼峰），结构体字段是 serde 管的（不改名）。

**常见错误**：
- 把结构体字段也改成 camelCase → `currentConfig.gameNames` 读到 `undefined` → `.length` 抛异常
- 把命令参数写成 snake_case → Tauri 报 `missing required key gameName`

---

## 2. 禁止 ES 模块 import

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

**症状**：import 失败时整个 JS 不执行，所有事件监听器都不注册，表现为"所有按钮都没反应"。

---

## 3. `window.__TAURI__` 不存在

Tauri 2.10 已移除 `window.__TAURI__`，只有 `window.__TAURI_INTERNALS__`。不要尝试 `window.__TAURI__.core.invoke()`。

---

## 4. 不要配 `devUrl`

`tauri.conf.json` 中的 `devUrl` 会让 Tauri 尝试连接外部 dev server。当前项目没有 dev server，配了会导致 `cargo tauri dev` 卡住。删掉 `devUrl`，Tauri 会直接从 `frontendDist`（`./src`）提供文件。

---

## 5. `timestamp()` 是秒不是毫秒

chrono 的 `DateTime::timestamp()` 返回**秒**，`timestamp_millis()` 返回**毫秒**。

---

## 6. 修改前先给计划

用户偏好：做任何代码修改前，先说明计划和涉及的文件，等确认再动手。

---

## 7. 实体关联用 ID，不要用名称

这是本项目反复出现的架构级错误。**任何可改名的实体，关联关系必须用不可变 ID，不能用名称。**

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

**规则**：
- 任何用户可编辑名称的实体，必须有不可变 ID（UUID）
- 目录路径、存储键、跨实体引用一律用 ID
- `name` 只用于 UI 展示，不作为关联依据
- 前端用 `crypto.randomUUID()` 生成，后端可用 `uuid` crate（如需）
