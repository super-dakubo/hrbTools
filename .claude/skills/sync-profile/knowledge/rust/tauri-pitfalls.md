# Rust / Tauri 踩坑手册

> 适用于 Rust + Tauri 2.0 桌面应用开发。其他语言项目不需要此文件。

## Tauri 命名约定：命令参数 ≠ 结构体字段

Tauri 2.0 对两个层级的命名处理不同：

| 层级 | 格式 | 谁负责 | 示例 |
|------|------|--------|------|
| 命令参数名（invoke 顶层 key） | camelCase | Tauri 宏 | `game_name` → `invoke('xxx', { gameName: ... })` |
| 结构体字段（嵌套对象 / 返回值） | snake_case | serde 默认 | `AppConfig.backup_root` → `{ config: { backup_root: ... } }` |

**常见错误：**
- 把结构体字段也改成 camelCase → 前端读到 undefined
- 把命令参数写成 snake_case → Tauri 报 missing required key

## `#[tauri::command]` 缺失

**适用：** Tauri 2.x

每个 Tauri 命令函数必须有 `#[tauri::command]` 属性宏。漏掉会导致编译错误 `cannot find macro '__cmd__xxx'`。

## `load_*` 函数必须是只读的

名称为 `load_*` / `get_*` / `read_*` 的函数不能有副作用。

**反面案例：** `load_config()` 内部调用 `set_auto_start()`，后者执行 `reg.exe` 命令。
在无控制台窗口的 Tauri GUI 应用中，创建子进程有约 3.3 秒额外开销。
由于几乎所有操作都调 `load_config`，导致全互联通卡顿。

**修复：** 只读路径中移除写操作，只放在明确的写操作中执行。

## `window.__TAURI__` 不存在

**适用：** Tauri 2.10+

Tauri 2.10 已移除 `window.__TAURI__`，只有 `window.__TAURI_INTERNALS__`。

```js
// ❌ 错误
window.__TAURI__.core.invoke();

// ✅ 正确
const invoke = (cmd, args) => window.__TAURI_INTERNALS__.invoke(cmd, args);
```

## 禁止 ES 模块 import

项目无 package.json / 无打包器，前端是原生 HTML/JS/CSS。

```js
// ❌ 禁止
import { invoke } from '@tauri-apps/api/core';

// ✅ 必须
const invoke = (cmd, args) => window.__TAURI_INTERNALS__.invoke(cmd, args);
```

import 失败时整个 JS 不执行，表现为"所有按钮都没反应"。

## 不要配 devUrl

**适用：** 无外部 dev server 的项目

tauri.conf.json 中的 devUrl 会让 Tauri 尝试连接外部 dev server。
当前项目没有 dev server，配了会导致 cargo tauri dev 卡住。
删掉 devUrl，Tauri 会直接从 frontendDist（./src）提供文件。

## 实体关联用 ID，不要用名称

**适用：** 任何用户可改名的实体

任何可改名的实体，关联关系必须用不可变 ID（UUID），不能用名称。

| 场景 | 错误做法 | 正确做法 |
|------|---------|---------|
| 游戏/存档位标识 | selectedGame = "塞尔达" | selectedGameId = "uuid-xxx" |
| 备份目录路径 | backup_root/塞尔达/ | backup_root/{game_id}/ |
| 前端键 | filePathBySlot["塞尔达:存档1"] | filePathBySlot["uuid:uuid"] |

**为什么：** 名称可改，一旦改名→磁盘目录找不到、内存键对不上、数据断裂。

## chrono-tz 内嵌全量时区数据库

**适用：** Release 构建中贡献约 2-3MB 静态数据。如果只用少数几个时区，全量时区库不值得。

**替代：** 用固定偏移 + 手动 DST 规则替代。美国/欧盟/澳洲的夏令时规则固定可算，几十行代码就能省 2-3MB。

## Tab 切换性能：四条规则

**适用：** opacity 合成层切换 + innerHTML 渲染的面板式 UI

1. switchTab 必须有执行锁（_switchLock + 5 秒超时兜底）
2. will-change: opacity 只能加在 .panel.active（避免常驻 GPU 合成层）
3. escapeHtml 必须用纯字符串替换（不用 DOM 版，避免 GC 暂停）
4. Tab click handler 必须有防抖（300ms 内重复点击忽略）

**注意：** 开发机（独立显卡）可能掩盖问题，release 在用户集成显卡上才暴露。
