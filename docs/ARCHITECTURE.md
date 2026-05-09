# 项目详细架构参考

> 本文档存放**非每次必读**的详细参考信息。只在处理对应功能时才需要加载。CLAUDE.md 中标注了何时应阅读本文档对应章节。

---

## 知识分类指南

项目知识分布在三个层级，各自有不同的用途和加载方式：

### CLAUDE.md（每次必读）

包含**影响所有编码决策**的核心约束和上下文。必须是简短、高频使用的信息。

| 存什么 | 实例 | 不存什么 |
|--------|------|---------|
| 常用命令 | `cargo tauri dev` | 具体命令的实现细节 |
| 架构概述 | Tauri 2.0 + 无边框 + 三面板 | 每个面板的函数列表 |
| 核心约束 | 禁止 import、实体用 ID、无 devUrl | 约束的完整证明和案例 |
| 关键引用 | LESSONS.md / design-system.md / ARCHITECTURE.md | 被引用文件的全部内容 |
| 项目 skill 列表 | panel-isolation, backup-operations… | skill 的完整内容 |

### docs/ARCHITECTURE.md（按需读取 — 处理对应功能时加载）

包含**特定功能领域的详细参考**。信息量大、不需要每次都读。

| 存什么 | 实例 |
|--------|------|
| 完整的数据结构字段定义 | AppConfig / TodoItem 的每个字段 |
| 功能分组命令表 | 全部 24 个 command 的列表 |
| 特定机制的完整说明 | DST 计算规则、备份恢复协议 |
| 配置持久化流程 | 前端内存副本 + set_config 全量写回 |
| 平台特定实现 | 窗口配置、系统托盘交互 |

### .claude/skills/（按需调用 — 处理对应任务时使用 Skill 工具）

包含**可执行的流程/规范**。有明确的触发条件、步骤和禁止项。

| 存什么 | 触发条件 |
|--------|---------|
| 面板隔离规则 | 即将修改 `main.js` 时 |
| 备份系统规范 | 处理备份 CRUD 相关功能时 |
| Tauri 命令添加流程 | 要加新 `#[tauri::command]` 时 |
| ID 化实体模式 | 添加新的可改名实体类型时 |

**判断标准：** 如果一条信息可以被"需要时再查"，放 ARCHITECTURE.md。如果它包含可执行的步骤或明确的禁止项，放 skill。如果每条任务都必须记住，放 CLAUDE.md。

---

## 1. 后端命令分组

> 相关 skill：`.claude/skills/tauri-command-pattern/` — 添加新命令时参考

`src/main.rs` 中约 24 个 `#[tauri::command]`，按功能分组：

| 分组 | 命令 | 说明 |
|------|------|------|
| 时间转换 | `convert_to_timestamp`, `convert_to_datetime` | 双向时间转换（多时区套件） |
| 配置 | `get_config`, `set_config` | 读写 `config.json` |
| 文件对话框 | `pick_file`, `pick_directory` | 系统原生选择器 |
| 备份操作 | `create_backup`, `list_backups`, `delete_backup`, `rename_backup`, `restore_backup` | 备份 CRUD，参数含 `gameId`/`slotId` |
| 哈希 | `compute_hash`, `recompute_backup_hash` | MD5 去重 |
| 置顶 | `toggle_backup_pin`, `toggle_game_pin` | 游戏/备份置顶切换 |
| 文件管理 | `open_folder` | 系统文件管理器打开目录 |
| 时区套件 | `add_timezone_set`, `remove_timezone_set`, `update_timezone_set`, `toggle_timezone_pin` | 多时区转换套件管理 |
| 通知 | `send_notification` | 发送 Windows Toast 通知 |
| 窗口 | `window_minimize`（隐藏到托盘）, `window_toggle_maximize`, `window_close`（退出应用） | 自定义标题栏窗口控制 |

### 1.1 Tauri 命名约定

Tauri 2.0 对两个层级的命名处理不同：

| 层级 | 格式 | 谁负责 | 示例 |
|------|------|--------|------|
| 命令参数名（`invoke` 顶层 key） | **camelCase** | Tauri 宏 | `game_name` → `invoke('xxx', { gameName: ... })` |
| 结构体字段（嵌套对象 / 返回值） | **snake_case** | serde 默认 | `AppConfig.backup_root` → `{ config: { backup_root: ... } }` |

### 1.2 IPC 调用方式

```js
const invoke = (cmd, args) => window.__TAURI_INTERNALS__.invoke(cmd, args);
```

**不要**使用 `import { invoke } from '@tauri-apps/api/core'`（Tauri 2.10 已移除）。

---

## 2. 数据结构

> 相关 skill：`.claude/skills/id-based-entities/` — 添加新实体时参考

### 2.1 AppConfig

```rust
struct AppConfig {
    backup_root: String,         // 备份根目录路径
    games: Vec<GameConfig>,      // 游戏列表
    timezone_sets: Vec<TimezoneSet>,  // 时区转换套件
    theme: String,               // "system" / "dark" / "light"
    tab_order: Vec<String>,      // Tab 排序 ["convert", "backup", "todo"]
    todos: Vec<TodoItem>,        // 待办列表
    auto_start: bool,            // 开机自启
    minimize_to_tray: bool,      // 最小化到托盘
    reminder_enabled: bool,      // 启用提醒通知（默认 true）
}
```

### 2.2 GameConfig / SlotConfig

```rust
struct GameConfig {
    id: String,           // UUID，不可变
    name: String,         // 游戏名（用户可改）
    slots: Vec<SlotConfig>,
    pinned: bool,
}

struct SlotConfig {
    id: String,              // UUID，不可变
    name: String,            // 存档位名（用户可改）
    file_paths: Vec<String>, // 源文件路径（多文件）
    next_backup_number: u32, // 下次备份序号
    key_file_patterns: Vec<String>, // 关键文件匹配模式
}
```

### 2.3 TodoItem

```rust
struct TodoItem {
    id: String,                    // UUID
    text: String,                  // 待办内容
    done: bool,                    // 完成状态
    priority: i32,                 // 0=低 1=中 2=高
    paused: bool,                  // 暂停状态（暂停时不触发通知）
    due_date: Option<String>,      // "YYYY-MM-DD"
    tags: Vec<String>,             // 自由标签
    notes: String,                 // 备注
    reminder: Option<ReminderConfig>, // 可选提醒
    repeat: Option<String>,        // null/"daily"/"weekly"/"monthly"
    sort_order: i32,               // 手动排序
    created_at: String,            // "YYYY-MM-DDTHH:mm"
    last_notified: Option<i64>,    // 上次通知时间戳(ms)
}
```

### 2.4 关键字段说明

- **北京时区套件** `id: "beijing"` — 时区锁定不可改不可删
- **主题** `"system"` / `"dark"` / `"light"` — 默认跟随系统 `prefers-color-scheme`
- **OpResult** — `{ success: bool, message: string }`，所有写操作返回此结构

---

## 3. 配置持久化

- 配置文件位置：`%APPDATA%/com.hrbTools.app/config.json`
- Rust 端读写文件，前端调用 `set_config` 全量写回
- 前端 JS 维护一份 `currentConfig` 内存副本，修改后必须调 `saveConfigToBackend()`
- 内存副本结构：`currentConfig.backup_root`、`currentConfig.games`、`currentConfig.todos` 等
- 新建模式在 JS 中构造临时对象，保存时才 `push` 到数组

### 后台提醒线程

在 `setup()` 中 `std::thread::spawn` 启动，每秒循环：

1. 读磁盘 `config.json`
2. 检查 `config.reminder_enabled` — 关闭则跳过本轮
3. 遍历待办，跳过 `done == true` 或 `paused == true` 的项
4. 检查 `reminder.datetime <= now && done == false && not notified`
5. 满足条件 → 发 `notify-rust` Toast 通知 → 更新 `last_notified`
6. 重复任务自动推期（daily/weekly/monthly）

**提醒线程独立读取磁盘文件，不与前端共享内存。** 前端对 config 的修改必须先 `saveConfigToBackend()` 持久化后，提醒线程才能感知。

---

## 4. DST 计算细节

不用 `chrono-tz`，手动实现 3 个时区的夏令时规则：

| 时区 | 规则 | UTC 偏移(冬) | UTC 偏移(夏) |
|------|------|-------------|-------------|
| `America/New_York` | 3月第2周日 ~ 11月第1周日 | -5h | -4h |
| `Europe/London` | 3月最后周日 ~ 10月最后周日 | +0h | +1h |
| `Australia/Sydney` | 10月第1周日 ~ 次年4月第1周日 | +10h | +11h |

固定偏移时区（上海/印度/东京/UTC）直接返回 `chrono::FixedOffset`，无需 DST 计算。

辅助函数：`nth_sunday_of_month(year, month, n)`、`last_sunday_of_month(year, month)`，参见 `src/main.rs:51-64`。

---

## 5. 备份系统

> 相关 skill：`.claude/skills/backup-operations/` — 修改备份功能时参考

### 5.1 目录结构

```
备份根目录/
  └── {game_id}/              ← 游戏 UUID（非名称）
      └── {slot_id}/          ← 存档位 UUID（非名称）
          └── YYYY-MM-DD HH-MM-SS 序号/   ← 时间戳 + 空格 + 序号
              ├── meta.json   ← 元数据
              ├── save.dat    ← 源文件（1 到 N 个）
              └── ...
```

- 目录使用 UUID 而非名称，改名不会导致备份路径断裂
- `meta.json` 使用 `"files"` 映射格式：`{ "文件名": { original_path, content_hash } }`
- 旧格式（单文件 `original_file_path`/`content_hash`）自动兼容读取

### 5.2 哈希去重

- 使用 `md-5` crate
- 备份前计算所有源文件哈希，与最近一次备份的哈希逐一比对
- 全部匹配 → 返回"存档未变化，无需重复备份"
- 置顶、哈希重复/匹配标记在 UI 中通过 badge 显示

### 5.3 恢复流程

1. 读取 `meta.json` 获取备份的文件列表及原始路径
2. 多文件时返回文件列表让用户选择（通过 `SELECT_FILES:` 协议）
3. 检查目标文件是否已备份（哈希比对），未备份则提示先备份（`NEED_BACKUP_CONFIRM:`）
4. 逐个 `std::fs::copy` 恢复

---

## 6. 前端详细结构

### 6.1 main.js 面板隔离

> 相关 skill：`.claude/skills/panel-isolation/` — 修改 main.js 前应先调用

三个完全独立的功能面板，**共用同一个文件但没有任何共享状态或逻辑**：

| 面板 | 核心函数 | HTML 容器 |
|------|---------|----------|
| 时间转换 | `renderTimezoneSets`, `saveTimezoneValues`, `restoreTimezoneValues`, `initTimezoneDefaults` | `#timezoneSets` |
| 存档管理 | `renderGameTabs`, `renderSlotTabs`, `renderFileTags`, `refreshBackupList` | `#gameTabs`, `#slotTabs`, `#fileTags`, `#backupList` |
| 待办工具 | `renderTodos`, `openTodoEditModal`, `toggleTodoDone` | `#todoList` |

修改一个面板绝对不能动另一个的代码。共用工具函数（`escapeHtml`, `setButtonLoading`, `shortenPath`）在 `// ==================== 工具函数 ====================` 区块中。

### 6.2 CSS 变量主题系统

CSS 变量定义在 `:root`（暗色，蓝色 `#4b8bf4`），亮色覆盖在 `body.light`（白色底 + 青绿 `#0d9488`）。

三态切换通过 JS `applyTheme()` 实现：
- `"system"` → 监听 `prefers-color-scheme: dark`
- `"dark"` → 强制暗色
- `"light"` → 强制亮色

**根字号：** `html { font-size: 18px }`（默认 16px），所有 `rem` 值以此基准缩放。

**颜色规则：**
- 禁止硬编码色值，所有颜色通过 CSS 变量引用
- 需 `rgba()` 时用 `rgba(var(--accent-rgb), 透明度)`，已提供 `--accent-rgb` 令牌
- 完整色板见 [design-system.md](./design-system.md)

### 6.3 按钮防重复

异步操作必须调用 `setButtonLoading(btn, text)` / `resetButton(btn, originalText)`：
```js
setButtonLoading(saveBackupBtn, '保存中...');
// ... async operation ...
resetButton(saveBackupBtn, '保存存档');
```

---

## 7. 窗口与托盘

| 配置 | 值 |
|------|-----|
| 窗口尺寸 | 780×640，固定不可缩放 |
| 边框 | 无（`decorations: false`），自定义标题栏 |
| 前端文件 | 指向 `./src`（无 `devUrl`） |
| 启动位置 | `setup()` 自动居中偏上（`window.outer_size()`） |

### 系统托盘交互

| 操作 | 行为 |
|------|------|
| 点击 ─（最小化） | `window.hide()` + 显示托盘 |
| 点击 ✕（关闭） | `app.exit(0)` 完全退出 |
| 点击托盘图标 | `window.show()` + `set_focus()` |
| 右键菜单 → 显示 | 恢复窗口 |
| 右键菜单 → 退出 | `app.exit(0)` |

`config.minimize_to_tray` 控制最小化按钮是否隐藏到托盘。
