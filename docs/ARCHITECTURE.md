# 项目详细架构参考

> 本文档存放**非每次必读**的详细参考信息。只在处理对应功能时才需要加载。
> 本文档整合了全部设计文档（2026-05-06 ~ 2026-05-17）的当前状态，代表项目的最终架构。
> 旧版设计文档（`docs/superpowers/specs/` 和 `docs/superpowers/plans/`）中的过期文件已清理，
> 本文档为单一权威参考。

---

## 知识分类指南

项目知识分布在三个层级，各自有不同的用途和加载方式：

### CLAUDE.md（每次必读）

包含**影响所有编码决策**的核心约束和上下文。必须是简短、高频使用的信息。

| 存什么 | 实例 | 不存什么 |
|--------|------|---------|
| 常用命令 | `cargo tauri dev` | 具体命令的实现细节 |
| 架构概述 | Tauri 2.0 + 无边框 + 五面板 | 每个面板的函数列表 |
| 核心约束 | 禁止 import、实体用 ID、无 devUrl | 约束的完整证明和案例 |
| 关键引用 | LESSONS.md / design-system.md / ARCHITECTURE.md | 被引用文件的全部内容 |
| 项目 skill 列表 | panel-isolation, backup-operations… | skill 的完整内容 |

### docs/ARCHITECTURE.md（按需读取 — 处理对应功能时加载）

包含**特定功能领域的详细参考**。信息量大、不需要每次都读。

| 存什么 | 实例 |
|--------|------|
| 完整的数据结构字段定义 | AppConfig / TodoItem 的每个字段 |
| 功能分组命令表 | 全部 28 个 command 的列表 |
| 特定机制的完整说明 | DST 计算规则、备份恢复协议、提醒生产者/消费者流程 |
| 配置持久化流程 | 前端内存副本 + set_config 全量写回 + 原子写入 |
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

`src/main.rs` 中约 28 个 `#[tauri::command]`，按功能分组（`invoke_handler` 中建议按此顺序排列）：

| 分组 | 命令 | 说明 |
|------|------|------|
| **时间转换** | `convert_to_timestamp`, `convert_to_datetime` | 双向时间转换（多时区套件） |
| **配置** | `get_config`, `set_config` | 读写 `config.json`。`set_config` 中仅当 `auto_start` 实际变化时才 spawn `reg.exe` |
| **文件对话框** | `pick_file`, `pick_directory` | 系统原生选择器 |
| **备份 CRUD** | `create_backup`, `list_backups`, `delete_backup`, `rename_backup`, `restore_backup` | 参数含 `gameId`/`slotId` |
| **哈希** | `compute_hash`, `recompute_backup_hash` | MD5 去重 |
| **置顶** | `toggle_backup_pin`, `toggle_game_pin` | 游戏/备份置顶切换 |
| **文件管理** | `open_folder` | 系统文件管理器打开目录 |
| **时区套件管理** | `add_timezone_set`, `remove_timezone_set`, `update_timezone_set`, `toggle_timezone_pin` | 多时区转换套件 CRUD |
| **通知** | `send_notification` | 发送 Windows Toast 通知 |
| **日志** | `log_write` | 前端日志批量写入文件 |
| **节假日** | `get_holiday_data` | 获取节假日配置 |
| **窗口** | `window_minimize`, `window_toggle_maximize`, `window_close` | 自定义标题栏窗口控制 |

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

**不要**使用 `import { invoke } from '@tauri-apps/api/core'`（Tauri 2.10+ 已移除）。

---

## 2. 数据结构

> 相关 skill：`.claude/skills/id-based-entities/` — 添加新实体时参考

### 2.1 AppConfig（顶级配置）

```rust
struct AppConfig {
    backup_root: String,                    // 备份根目录路径
    games: Vec<GameConfig>,                 // 游戏列表，用 ID 关联
    timezone_sets: Vec<TimezoneSet>,        // 时区转换套件
    theme: String,                          // "system" / "dark" / "light"
    tab_order: Vec<String>,                 // Tab 排序 ["convert", "backup", "todo", "log", "settings"]
    todos: Vec<TodoItem>,                   // 待办列表
    holiday_data: Vec<HolidayYearConfig>,   // 节假日配置（逐年）
    auto_start: bool,                       // 开机自启
    minimize_to_tray: bool,                 // 最小化到托盘
    reminder_enabled: bool,                 // 启用提醒通知（默认 true）
    banners: Vec<BannerEntry>,              // 横幅列表（Rust 线程写入，JS 读取渲染）
    pending_reminders: Vec<PendingReminder>, // 待消费提醒队列（JS 写入，Rust 线程消费）
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

### 2.3 TimezoneSet

```rust
struct TimezoneSet {
    id: String,              // "beijing" 为默认套件，其余为 "set-{timestamp}"
    name: String,            // 显示名称
    timezones: Vec<String>,  // 包含的时区标识符列表
    pinned: bool,            // 是否置顶
}
```

- **北京时区套件** `id: "beijing"` — 时区锁定不可改不可删，硬编码于 Rust/JS 多处

### 2.4 TodoItem

```rust
struct TodoItem {
    id: String,                         // UUID
    text: String,                       // 待办内容
    done: bool,                         // 完成状态
    priority: i32,                      // 0=低 1=中 2=高
    paused: bool,                       // 暂停状态
    due_date: Option<String>,           // "YYYY-MM-DD"
    tags: Vec<String>,                  // 自由标签
    notes: String,                      // 备注
    reminder: Option<ReminderConfig>,   // 可选提醒
    repeat: Option<String>,             // null / "daily" / "weekly" / "monthly"
    sort_order: i32,                    // 手动排序
    created_at: String,                 // "YYYY-MM-DDTHH:mm"
    last_notified: Option<i64>,         // 上次通知时间戳(ms)，Rust 线程维护
}
```

### 2.5 ReminderConfig

```rust
struct ReminderConfig {
    datetime: Option<String>,       // 一次性/下次触发时间 "YYYY-MM-DDTHH:mm"
    sound: bool,                    // 是否播放声音
    day_mode: Option<String>,       // null / "fixed" / "last_day" / "second_last" / "third_last"（仅 monthly）
    workday_time: Option<String>,   // 工作日触发时间 "HH:mm"（仅 daily）
    restday_time: Option<String>,   // 休息日触发时间 "HH:mm" 或 null（跳过休息日，仅 daily）
}
```

### 2.6 PendingReminder（解耦架构 — JS 生产，Rust 消费）

```rust
struct PendingReminder {
    id: String,             // 对应 todo.id
    text: String,           // 待办文本（横幅展示用）
    fire_at: String,        // 触发时间 "YYYY-MM-DDTHH:mm"
    repeat: Option<String>, // null / "daily" / "weekly" / "monthly"（透传，Rust 线程据此决定推期行为）
    workday_time: Option<String>, // 透传
    restday_time: Option<String>, // 透传
    day_mode: Option<String>,     // 透传
    sound: bool,            // 是否播放声音
}
```

### 2.7 BannerEntry（Rust 生产，JS 消费）

```rust
struct BannerEntry {
    id: String,          // 唯一标识（用于前端去重）
    text: String,        // 显示文本
    todo_id: String,     // 关联待办 ID
    created_at: String,  // 创建时间 "YYYY-MM-DDTHH:mm:ss"
}
```

### 2.8 HolidayYearConfig

```rust
struct HolidayYearConfig {
    year: i32,                          // 年份
    holidays: Vec<HolidayPeriod>,       // 假期段列表
    makeup_days: Vec<String>,           // 补班日列表 "MMDD" 格式
}

struct HolidayPeriod {
    start: String,   // "MMDD"（含跨年如 "1228"）
    end: String,     // "MMDD"（含跨年如 "0102"）
    name: String,    // 假期名称 "春节"等
}
```

### 2.9 OpResult

```rust
struct OpResult {
    success: bool,
    message: String,
}
```

所有写操作返回此结构。Tauri 要求命令返回值实现 `Serialize`，`OpResult` 简化了前端错误处理（统一检查 `result.success`）。

---

## 3. 前端架构

### 3.1 面板隔离

> 相关 skill：`.claude/skills/panel-isolation/` — 修改 main.js 前应先调用

五个完全独立的功能面板（`index.html` 中 5 个 `.panel` 容器），**共用同一个文件但没有任何共享状态或逻辑**：

| 面板 | Tab ID | 核心函数 | 容器 |
| --- | --- | --- | --- |
| 时间转换 | `convert` | `renderTimezoneSets`, `saveTimezoneValues`, `restoreTimezoneValues`, `initTimezoneDefaults` | `#timezoneSets` |
| 存档管理 | `backup` | `renderGameTabs`, `renderSlotTabs`, `renderFileTags`, `saveBackup`, `refreshBackupList` | `#gameTabs`, `#slotTabs`, `#fileTags`, `#backupList` |
| 待办工具 | `todo` | `renderTodos`, `openTodoEditModal`, `toggleTodoDone` | `#todoList` |
| 日志 | `log` | `window.__log`, `renderLogPanel`, `bindLogPanelEvents` | `#panel-log` |
| 设置 | `settings` | `toggleSettings`, `updateSettingsDisplay`, `applyTheme`, `renderSettingsTabBar`, 节假日管理 | `#panel-settings` |

**核心规则：** 修改一个面板绝对不能动另一个的代码。共用工具函数（`escapeHtml`, `setButtonLoading`, `shortenPath`）在 `// === 工具函数 ===` 区块中。

### 3.2 Tab 切换机制

**性能约束 — 四条规则缺一不可（详见 LESSONS.md）：**

1. **`switchTab` 必须有执行锁** — `_switchLock` 在双重 rAF 后才释放，5 秒超时兜底
2. **`will-change: opacity` 只能加在 `.panel.active`** — 禁止常驻 GPU 合成层
3. **`escapeHtml` 必须用纯字符串替换** — 禁止 DOM 版，避免 GC 暂停
4. **Tab click handler 必须有 300ms 防抖** — 配合执行锁双层防护

**CSS 实现：**

```css
.panel {
    display: block;
    position: absolute;
    top: 0; left: 0; right: 0; bottom: 0;
    opacity: 0;
    pointer-events: none;
    visibility: hidden;
    transition: opacity 0.2s ease;
}
.panel.active {
    opacity: 1;
    pointer-events: auto;
    visibility: visible;
    will-change: opacity;
}
```

所有面板始终在布局树中，切换仅触发合成层变化。

**设置面板切换：** 设置面板与其他 4 个面板互斥。通过 `toggleSettings()` 进入/退出：

- 进入：记录 `_previousTab`，切换 `switchTab('settings')`，隐藏 Tab 图标
- 退出：回到 `_previousTab`，恢复 Tab 图标
- 齿轮图标蓝色高亮表示"设置模式中"

### 3.3 事件委托

**所有子元素事件绑定必须放在 `setupEventDelegation()` 中，用 `e.target.closest('[data-action]')` 匹配。** 禁止在渲染函数中绑定事件或加单独的 `addEventListener`。

```js
function setupEventDelegation() {
    document.addEventListener('click', function(e) {
        var target = e.target.closest('[data-action]');
        if (!target) return;
        var action = target.dataset.action;
        if (action === 'deleteTodo') { deleteTodo(target.dataset.id); }
        else if (action === 'toggleDone') { toggleTodoDone(target.dataset.id); }
        // ...
    });
}
```

覆盖范围：游戏标签、存档位、文件标签、备份列表、待办列表的全部交互。

### 3.4 主题系统

**CSS 变量定义分层：**

```css
:root {
    --bg: #1a1a2e;
    --text: #e8e8f0;
    --accent: #4b8bf4;
    --accent-rgb: 75, 139, 244;
    --surface: #222244;
    --glass-bg: rgba(30, 30, 60, 0.55);
    --glass-border: rgba(255,255,255,0.08);
    /* ... */
}
body.light {
    --bg: #f5f5fa;
    --text: #1a1a2e;
    --accent: #3b82f6;  /* 同一色相（蓝），仅调明度 */
    /* ... */
}
```

**三态切换**（`applyTheme()`）：

- `"system"` → 监听 `prefers-color-scheme`
- `"dark"` → 强制暗色
- `"light"` → 强制亮色

**玻璃拟态：** `backdrop-filter: blur(16px)` + `rgba` 背景。暗色偏紫，亮色加径向渐变衬托通透感。

### 3.5 日志系统

**前端环形缓冲区 → Tauri IPC `log_write` → 文件：**

```
window.__log.buffer (2000 条上限, O(1) 写入)
  → 每 10 秒或满 100 条 flush
  → IPC log_write (string[] 批量)
  → %APPDATA%/com.hrbTools.app/logs/YYYY-MM-DD.log
  → 10MB 自动轮转 (.log → .1.log → .2.log)
```

**日志级别：** DEBUG(0) / INFO(1) / PERF(2) / WARN(3) / ERROR(4)

**API：** `window.__log.info/perf/warn/error(source, message)` — 替代 `console.log`

**日志面板功能：** 搜索、级别筛选、打开日志目录、清屏、导出。反向列表（最新在上），最多显示 500 条。

**CSS 变量：** `--log-error: #ff4444`, `--log-warn: #ffaa00`, `--log-perf: #44aaff`

### 3.6 待办编辑弹窗

- **无保存/取消按钮** — 修改即自动保存（300ms debounce 的 `autoSave()`）
- **`_saveInProgress` 防重叠** — `autoSave()` 中 `saveConfigToBackend()` 未完成时跳过后续 keystroke
- **关闭方式** — 仅右上角 X 按钮，`closeModal()` 自动清理空的新建待办
- **滚动隔离** — modal 为 flex 容器，仅 `.todo-edit-body` 区域可滚动
- **新建流程** — 点"添加待办"打开空弹窗，`autoSave` 首次保存时生成 `crypto.randomUUID()`

### 3.7 节假日编辑弹窗

- 独立 modal（`#holidayModal`），与待办编辑弹窗复用同一套 modal 样式
- JSON 编辑：假期段（start/end 为 MMDD，支持跨年）+ 补班日（makeup_days）
- `parseAndPreviewHolidayJSON()` — 实时解析和预览

### 3.8 设置面板

- 第 5 个面板（`#panel-settings`），通过点击标题栏齿轮进入
- 卡片分组：`.settings-group`，通用设置和节假日配置分两张卡片
- 通用设置卡片：备份根目录、主题、开机自启、托盘、提醒开关
- 节假日卡片：年份列表 + 编辑/删除 + 添加年份
- 退出方式：左上角"← 退出设置"或再次点击齿轮

### 3.9 按钮防重复

```js
setButtonLoading(btn, text);   // 禁用按钮 + 显示加载文本
resetButton(btn, originalText); // 恢复按钮
```

所有异步操作必须调用，防止用户重复点击。

### 3.10 UI 动画

当前仅实现待办删除的离场动画：

```css
@keyframes todoLeave {
    from { opacity: 1; transform: translateY(0); }
    to   { opacity: 0; transform: translateY(-6px); }
}
.todo-item.leaving { animation: todoLeave 0.2s ease-in forwards; }
```

`deleteTodo()` 先添加 `leaving` 类，200ms `setTimeout` 后执行实际删除。

---

## 4. 提醒系统（解耦架构）

**核心设计：生产者-消费者解耦（2026-05-17 重构）。**

```
JS (生产者)                 Rust 线程 (消费者)           JS (展示)
  │                            │                          │
  ├─ syncPendingReminders()    │                          │
  │   ├─ 遍历待办              │                          │
  │   └─ 写入 pending_reminders│                          │
  │                            ├─ 每 5 秒轮询 config.json │
  │                            ├─ 消费到期的 reminder     │
  │                            │  ├─ notify-rust 通知      │
  │                            │  ├─ Beep(880,200) 声音   │
  │                            │  ├─ 写入 banners          │
  │                            │  ├─ 周期推期后重新入队    │
  │                            │  └─ save_config()         │
  │                            │                          │
  │                            ├─ eval("__onReminderFired()")
  │◄───────────────────────────┘                          │
  ├─ __onReminderFired()                                  │
  │   ├─ get_config() → 刷新                              │
  │   └─ renderBanners()                                  │
  │                            │                          │
  │                            │                          ├─ renderBanners()
  │                            │                          ├─ 用户关闭横幅
  │                            │                          └─ 仅 UI 操作
```

### 4.1 提醒类型

| 类型 | repeat 值 | 触发行为 | 推期行为 |
| --- | --- | --- | --- |
| 一次性 | `null` | 到期触发，不删除 reminder 数据 | 不推期 |
| 每日 | `"daily"` | 按 day_type 选 workday_time / restday_time | 扫描下一天，按 day_type 取对应时间，跳过无时间的日 |
| 每周 | `"weekly"` | 到期触发 | +7 天 |
| 每月 | `"monthly"` | 到期触发 | `checked_add_months` + day_mode（last/second_last/third_last clamp）|

### 4.2 关键逻辑

- **`syncPendingReminders()`** — 有则不建：检查每个待办是否已有对应 `pending_reminder`，存在则跳过
- **5 分钟陈旧跳过** — `now - fire_at > 300_000` 的 `pending_reminder` 直接丢弃，防止关机后批量触发
- **Rust 线程持久化** — 触发后同步 `save_config()` 更新 `todo.reminder.datetime`（推期后）
- **JS 只读刷新** — `__onReminderFired` 只调 `get_config` 刷新列表，不做 `saveConfigToBackend`
- **`fired_cooldown`** — Rust 内存级 5 分钟冷却，防止重复触发（配合 `last_notified` 双层防护）
- **日类型（daily only）** — 通过 `get_day_type` 判断节假日+补班+周末，选对应时间

### 4.3 配置改动（set_auto_start 条件执行）

`set_config` 命令中**仅当 `auto_start` 值实际变化时才 spawn `reg.exe`**。`reg.exe` 子进程在 GUI 应用中约 3.3 秒开销。任何时候修改 `set_config` 保存路径，都不要无条件调 `set_auto_start`。

---

## 5. 节假日系统

### 5.1 数据格式

```json
{
  "year": 2026,
  "holidays": [
    { "start": "0101", "end": "0103", "name": "元旦" },
    { "start": "0128", "end": "0203", "name": "春节" }
  ],
  "makeup_days": ["0125", "0208"]
}
```

- `start`/`end` 为 MMDD 格式，支持跨年（如 `1228`-`0102`）
- 补班日 `makeup_days` 为字符串列表

### 5.2 判定逻辑（JS 和 Rust 各自独立实现，需保持同步）

```
1. 补班日优先 → 返回 workday
2. 假期段判定（遍历 holidays，含跨年）→ 返回 restday
3. 周末判定 → 返回 restday
4. 否则 → 返回 workday
```

两端判定逻辑结构完全一致，修改时必须同时更新。

---

## 6. DST 计算

不用 `chrono-tz`，手动实现 3 个时区的夏令时规则：

| 时区 | 规则 | UTC 偏移(冬) | UTC 偏移(夏) |
|------|------|-------------|-------------|
| `America/New_York` | 3月第2周日 ~ 11月第1周日 | -5h | -4h |
| `Europe/London` | 3月最后周日 ~ 10月最后周日 | +0h | +1h |
| `Australia/Sydney` | 10月第1周日 ~ 次年4月第1周日 | +10h | +11h |

固定偏移时区（上海 +8 / 印度 +5:30 / 东京 +9 / UTC +0）直接返回 `chrono::FixedOffset`。

辅助函数：

- `nth_sunday_of_month(year, month, n)` — 第 n 个周日
- `last_sunday_of_month(year, month)` — 最后周日（注意去掉冗余 `pred_opt` 的 bug 已修复）
- `last_day_of_month(year, month)` — 月末日期

**时区一致性：** 所有计算使用 `FixedOffset`（不混用系统时区），避免跨天边界（23:00-00:00）的行为不一致。

---

## 7. 备份系统

> 相关 skill：`.claude/skills/backup-operations/` — 修改备份功能时参考

### 7.1 目录结构

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

### 7.2 哈希去重

- 使用 `md-5` crate
- 备份前计算所有源文件哈希，与最近一次备份的哈希逐一比对
- 全部匹配 → 返回"存档未变化，无需重复备份"
- `compute_file_hash` 使用缓冲读取（`BufReader` + 8KB 缓冲区），避免大文件 OOM

### 7.3 恢复流程

1. 读取 `meta.json` 获取备份的文件列表及原始路径
2. 多文件且未指定 `selected_files` 时，返回文件列表让用户选择（通过 `SELECT_FILES:` 协议）
3. 检查目标文件是否已备份（哈希比对），未备份则提示先备份（`NEED_BACKUP_CONFIRM:`）
4. 逐个 `std::fs::copy` 恢复

### 7.4 安全校验

`sanitize_path_component()` — 所有从 `game_id`/`slot_id`/`folder_name` 等用户参数构建文件系统路径的命令，必须先调用此函数检查路径穿越（`..`, `/`, `\`）。

---

## 8. 配置持久化

### 8.1 文件路径

`%APPDATA%/com.hrbTools.app/config.json`

### 8.2 读写策略

- **加载：** `load_config(&app)` — 反序列化 `config.json`，失败时写错误日志并返回默认值
- **保存：** `save_config(&app, &config)` — 先写临时文件（`.tmp`），再 `rename` 覆盖目标路径，防止崩溃时配置损坏
- **前端交互：** 前端维护 `currentConfig` 内存副本，修改后调用 `saveConfigToBackend()`（async）

### 8.3 提醒线程日志持久化

长时间运行的线程使用 `BufWriter<File>` 保持文件句柄打开，仅在日期变更时重新打开：

```rust
let mut log_file: Option<(String, BufWriter<File>)> = None;
```

避免每次写入都创建/销毁文件句柄。

---

## 9. App/托盘图标

- 位置：`icons/` 目录（32x32.png, 128x128.png, icon.ico）
- 设计：蓝色渐变（`#4b8bf4 → #2563eb`）圆角方块 + 白色字母 "H"
- 生成：`python tools/gen_icon.py`（纯 stdlib，无额外依赖）

---

## 10. 窗口与托盘

| 配置 | 值 |
|------|-----|
| 窗口尺寸 | 960×720，固定不可缩放 |
| 边框 | 无（`decorations: false`），自定义标题栏 |
| 根字号 | `html { font-size: 18px }`（所有 `rem` 以此基准） |
| 前端文件 | 指向 `./src`（无 `devUrl`） |
| 启动位置 | `setup()` 自动居中偏上 |
| 启动遮罩 | Loading spinner，`loadConfig()` 完成后淡出（Release 冷启动 ~3.3s，有意保留） |

### 系统托盘交互

| 操作 | 行为 |
|------|------|
| 点击 ─（最小化） | `window.hide()` + 显示托盘 |
| 点击 ✕（关闭） | `app.exit(0)` 完全退出 |
| 点击托盘图标 | `window.show()` + `set_focus()` |
| 右键菜单 → 显示 | 恢复窗口 |
| 右键菜单 → 退出 | `app.exit(0)` |

`config.minimize_to_tray` 控制最小化按钮是否隐藏到托盘。

---

## 11. 关键约束

### Tauri / Rust

- `#[tauri::command]` 参数名 camelCase，结构体字段 snake_case
- 写操作返回 `OpResult { success, message }`
- 新命令必须在 `.invoke_handler(tauri::generate_handler![...])` 中注册
- `extern "system"` 块必须加 `unsafe`（Rust 2024 edition 强制）
- FFI 声明和调用点都必须加 `#[cfg(target_os = "windows")]` 防护
- 禁止 `devUrl`（无外部 dev server，配了会导致 `cargo tauri dev` 卡住）
- 禁止引入非必要的重型依赖（`chrono-tz` 2-3MB 的教训）

### 前端

- 禁止 `import` / `<script type="module">` — 用 `window.__TAURI_INTERNALS__.invoke()`
- 禁止 `console.log` — 用 `window.__log.info/perf/warn/error()`
- 禁止硬编码色值 — 所有颜色通过 CSS 变量引用
- `escapeHtml` 必须用纯字符串替换（4 替换：`&` `<` `>` `"` `'`）
- 实体用 ID 关联（UUID），不用名称
- `load_*`/`get_*` 函数禁止有副作用

### 配置

- 读：`load_config(&app)` / 写：`save_config(&app, &config)` — 禁止直接操作文件
- 前端内存副本 `currentConfig` 修改后必须调 `saveConfigToBackend()`
