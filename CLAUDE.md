# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

> **代码开发前必须阅读 [LESSONS.md](./docs/LESSONS.md)** — 本项目反复踩过的坑和硬性约束。特别关注：
> - 「Tab 切换：四条规则缺一不可」— 性能核心
> - 「实体关联用 ID，不要用名称」— 数据一致性
> - 「不要在只读路径中执行写操作」— `load_*`/`get_*` 无副作用
> - 「引入依赖前评估数据量级」— chrono-tz 2-3MB 的教训
> **README 截图见 [screenshots/](./screenshots/) 目录** — 截图和演示 GIF 放这里。
> **UI/样式修改前必须阅读 [docs/design-system.md](./docs/design-system.md)** — 颜色令牌、排版、组件标准、主题规则。
> **处理特定功能时先查 [docs/ARCHITECTURE.md](./docs/ARCHITECTURE.md) 对应章节** — 数据结构、命令列表、持久化、DST、备份、窗口等详细参考。
>
> **项目 skill 位于 `.claude/skills/`** — 通过 `/skill-name` 或 Skill 工具调用：
> - `panel-isolation` — 修改 main.js 时遵守面板隔离
> - `backup-operations` — 备份系统操作规范
> - `tauri-command-pattern` — 添加新 Tauri 命令
> - `id-based-entities` — 添加可改名实体时用 ID 关联
>
> **Rust 关键词 hook（`settings.local.json`）** — 涉及 Rust 编译错误/领域问题时自动注入诊断框架，详见 config-observations.md
>
> **所有设计文档已整合为 [docs/ARCHITECTURE.md](./docs/ARCHITECTURE.md)** — 处理功能时查对应章节
>
> **自动记忆系统**位于 `C:\Users\PC_WIN10\.claude\projects\d--code-hello-world\memory\` — 跨会话持久化用户偏好和经验教训。
>
> **全局 superpowers skill**（`.claude/plugins/`）：`brainstorming`、`writing-plans`、`subagent-driven-development`、`test-driven-development`、`systematic-debugging` 等，按需用 Skill 工具调用。
>
> **权限分层** — 全局 `Bash(cargo *)` 覆盖所有 cargo 子命令，项目级 `.claude/settings.local.json` 放 `git push`、`taskkill` 及常用通配（`node *`、`cat *`、`sed *`、`cp *`、`mv *`）。图标生成用 `Bash(python *)`（stdlib 无额外依赖）。不在此放 npm 或不相关命令。新增常用命令时优先考虑全局配置。复合命令（`&&` 串联）按完整字符串匹配，分步执行更安全。
>
> **`cargo tauri dev` 无 hot-reload** — 改前端文件（index.html / main.js / styles.css）后重启或按 Ctrl+R 刷新 WebView。Rust 端修改自动重新编译。
> **启动加载遮罩** — loading spinner 遮罩，`loadConfig()` 完成后自动淡出。这是 Release 模式 `reg.exe` 冷启动 ~3.3s 的有意设计，不要移除。

## 常用命令

- `cargo tauri dev` – 启动 Tauri 开发
- `cargo tauri build` – 生产构建
- `cargo check` – 快速检查 Rust 编译错误
- `cargo build` – 仅编译 Rust 后端
- `cargo test` – 运行测试（当前仅验证编译）
- `gh release create v0.1.0 target/release/bundle/nsis/*.exe target/release/bundle/msi/*.msi` – 发布新版本
- `taskkill /im tauri_dev.exe /f` – 强制终止 dev 进程（开发时常用）

## 架构概述

Tauri 2.0 桌面应用（**仅 Windows**），无 npm/打包器，纯原生 HTML/CSS/JS + Rust 单文件后端。

**无边框窗口**（`decorations: false`），自定义标题栏，左侧 Tab 栏（支持鼠标拖拽排序）。面板切换必须用 `position: absolute` + `opacity` 合成层，禁止 `display: none/block`（避免布局重算）。

**根字号：** `html { font-size: 18px }`（默认 16px），所有 `rem` 值以此基准缩放。

### 源文件一览

| 文件 | 行数 | 说明 |
|------|------|------|
| [src/index.html](src/index.html) | 210 | HTML 骨架 + 内联启动 IPC 脚本，5 面板 DOM（时间转换/备份/待办/日志/设置） |
| [src/styles.css](src/styles.css) | ~1950 | CSS 变量主题系统（暗色/亮色）+ 全部组件样式，玻璃拟态设计 |
| [src/main.js](src/main.js) | ~2860 | 全部前端逻辑，`// ===` 分隔 23+ 区块 + 事件委托 |
| [src/main.rs](src/main.rs) | ~1910 | 全部 Rust 逻辑，13 个功能分区，28 个 Tauri 命令 |
| [icons/](icons/) | — | App/托盘图标：32x32.png、128x128.png、icon.ico。重构时运行 `python tools/gen_icon.py` 重新生成 |
| [tools/gen_icon.py](tools/gen_icon.py) | 132 | 纯 Python 图标生成脚本（stdlib 无依赖），绘制蓝色渐变圆角方块 + 白色字母 H |

### AppConfig 持久化

读写配置必须用 `load_config(&app)`/`save_config(&app, &config)`，禁止直接操作文件。前端内存副本 `currentConfig` 修改后必须调 `saveConfigToBackend()` 持久化。

核心结构：
```rust
AppConfig { backup_root, games: Vec<GameConfig>, timezone_sets, theme, tab_order, todos, holiday_data: Vec<HolidayYearConfig>, auto_start, minimize_to_tray, reminder_enabled }
GameConfig { id: UUID, name, slots: Vec<SlotConfig>, pinned }
SlotConfig { id: UUID, name, file_paths: Vec<String>, next_backup_number, key_file_patterns: Vec<String> }
```

**`set_auto_start` 条件执行：** `set_config` 命令中 **仅当 `auto_start` 值实际变化时才 spawn `reg.exe`**。`reg.exe` 子进程在 GUI 应用中约 3.3 秒，不要在任何读路径或保存路径中无条件调用。注册表写入路径追加 `--minimized` 参数以实现开机自启时保持隐藏。

**配置备份：** `save_config` 在写入 config.json 前自动复制 `config.json → config.json.bak`（写入备份发生在写之前，不影响正常写入路径）。备份失败仅 `log_error`，不阻塞写入。

### 前端（src/main.js）分区

`// ==================== 区块名 ====================` 分隔，用 Grep 搜索 `=== 区块名` 定位目标区块：

| 区块 | 分隔标记 | 核心函数 |
|------|---------|----------|
| Tab 栏 / Tab 图标 | `=== 状态 ===` ~ `=== Tab 拖拽 ===` | `renderTabBar`（内联 SVG，必须含 `width="24" height="24"`，用 `currentColor` 跟随主题色）、`switchTab`、拖拽排序 |
| 时间转换面板 | `=== 时间转换 ===` | `renderTimezoneSets`, `saveTimezoneValues` |
| 存档管理 | `=== 配置管理 ===` ~ `=== 哈希 ===` | `renderGameTabs`, `renderSlotTabs`, `renderFileTags` |
| 备份操作 + 列表 | `=== 备份操作 ===` / `=== 备份列表 ===` | `saveBackup`, `refreshBackupList`, 恢复弹窗 |
| 设置面板（第 5 面板） | `=== 设置面板切换 ===` | `toggleSettings`/`renderSettingsTabBar`/`applyTheme`/`updateSettingsDisplay` + 齿轮/Tab 栏退出交互。设置采用卡片分组（`.settings-group`），通用设置和节假日配置分两张卡片展示 |
| 按钮防重复 + 消息提示 | `=== 按钮防重复 ===` / `=== 消息提示 ===` | `setButtonLoading`, `showSuccess`/`showError` |
| 工具函数 | `=== 工具函数 ===` | `escapeHtml`, 时间格式化等 |
| 节假日管理 | `=== 节假日管理 ===` | `renderHolidayYears`, `openHolidayEditor`, `parseAndPreviewHolidayJSON` |
| 待办工具面板 | `=== 待办工具 ===` | `renderTodos`, `openTodoEditModal`, `toggleTodoDone` |
| 事件委托 | `=== 事件委托 ===` | `setupEventDelegation`（一次性绑定，替代每次渲染后重新绑定监听器） |
| 启动（init） | `=== 启动 ===` | `DOMContentLoaded` → rAF 分步初始化 |
| 日志系统（IIFE + 面板渲染） | `=== 日志系统 ===` + `=== 日志面板渲染 ===` | `window.__log`, `renderLogPanel`, `bindLogPanelEvents` |

**事件委托模式：** 所有子元素事件绑定必须放在 `setupEventDelegation()` 中，用 `e.target.closest('[data-action]')` 匹配。禁止在渲染函数中绑定事件或加单独的 `addEventListener`。这是整个前端的事件架构核心，覆盖游戏标签、存档位、文件标签、备份列表、待办列表的全部交互。旧代码中的 `bind*Events()` 函数（如 `bindTabEvents`）已经废弃，新增交互直接在 `setupEventDelegation` 中添加 handler。

**异步操作锁模式：** 所有防止重复提交的锁变量必须用 try-finally 释放，不可在 catch 之后释放。超时和 IPC 响应竞态必须用 `settled` 守卫变量（谁先到谁执行，后到的检查 `settled` 后跳过）。现有实例：`_switchLock`、`_saveInProgress`、`_backupListLock`。

**日志流水线：** `window.__log`（环形缓冲区 2000 条）→ IPC `log_write` → `%APPDATA%/com.hrbTools.app/logs/YYYY-MM-DD.log`（10MB 自动轮转）

- 写全部级别到文件，每 10 秒或满 100 条自动 flush；INFO 及以上输出控制台
- 启动时自动加载今日日志文件到缓冲区（`loadFromFile()`）
- 日志面板（第 4 Tab）：搜索、级别筛选、打开日志目录、清屏、导出
- 所有 Tab 切换用双重 rAF 记录 PERF 日志（dom/action/render 分段耗时）

### 节假日系统

节假日数据（`config.holiday_data`）在设置面板中通过 JSON 编辑，包含假期段（`start`/`end` 为 MMDD 格式，支持跨年如 `1228-0102`）和补班日（`makeup_days`）。JS 端 `getDayType()` 与 Rust 端 `get_day_type()` **各自实现一份完全独立的判定逻辑**（含补班优先、假期段判定、周末判定），修改时必须同时更新两端保持同步。

**提醒架构 — 生产者/消费者解耦：**

```text
JS syncPendingReminders() → pending_reminders
→ Rust 线程每 5s 消费到期项
    → notify-rust + Beep → banners → save_config()
    → eval("__onReminderFired()")
→ JS get_config() → renderBanners()
```

**设计约束（改提醒逻辑时必须遵守）：**

- JS 生产 `pending_reminders`，Rust 消费。两方不共享同一个对象的同一个字段
- `syncPendingReminders()` 检查每个待办是否已有对应 `pending_reminder`，存在则跳过
- 5 分钟陈旧跳过：`now - fire_at > 300_000` 的直接丢弃，防关机后批量触发
- Rust 线程消费后 `save_config()` 持久化，JS 只读刷新（`get_config`），不写
- 每日提醒支持设工作日/休息日两个时间，可选"休息日不提醒"

**提醒类型推期行为：**

- 一次性（`repeat = null`）：不推期，消费后标记完成
- 每日（`"daily"`）：按 `get_day_type` 选 `workday_time`/`restday_time`，扫描下一天
- 每周（`"weekly"`）：+7 天
- 每月（`"monthly"`）：`checked_add_months` + day_mode clamp
- 月尾模式：`day_mode = "last"`/`"second_last"`/`"third_last"`

**`recalculateNextDue(todo)`** — 同时推进 `due_date` 和 `reminder.datetime` 到下一周期。`reminder.datetime` 推进独立于 `due_date`（有提醒没截止日期的待办也能推进）。每周最多推 52 轮，每月最多 12 轮，防止异常数据死循环。在 `renderTodos` 中自动对过期周期任务执行推期，确保永不显示"已过期"。

### 待办编辑弹窗

- **无保存/取消按钮** — 修改即自动保存（300ms debounce 的 `autoSave()`）
- **`_saveInProgress` 防重叠** — `autoSave()` 中 `saveConfigToBackend()` 未完成时跳过后续 keystroke 触发的保存，避免 IPC 堆积。修改此逻辑时注意保持此保护
- **关闭方式** — 仅右上角 X 按钮，`closeModal()` 自动清理空的新建待办
- **滚动隔离** — modal 为 flex 容器，仅 `.todo-edit-body` 区域可滚动，header 固定顶部不参与滚动
- **新建流程** — 点"添加待办"打开空弹窗，`autoSave` 首次保存时生成 `crypto.randomUUID()` 并写入配置

### 后端（src/main.rs）

- `tauri::command` 参数名必须用 **camelCase**，结构体字段必须用 **snake_case**（Tauri 宏 vs serde 差异）
- 写操作必须返回 `OpResult { success: bool, message: string }`
- 新增命令必须在 `main()` 的 `.invoke_handler(tauri::generate_handler![...])` 中注册
- `setup()` 中初始化：**`--minimized` 检查**（无此参数时 `window.show()` 显示窗口）+ **系统托盘**（显示/退出菜单，单击显示窗口）+ **提醒线程**（`std::thread::spawn`，每 5 秒轮询 config.json，检查待办提醒时间并发送通知）
- **`sanitize_path_component()`** — 所有从 `game_id`/`slot_id`/`folder_name` 等用户参数构建文件系统路径的命令，必须先调用此函数检查路径穿越
- **Win32 FFI** — `unsafe extern "system" { fn Beep(...) }` 受 `#[cfg(target_os = "windows")]` 保护，调用点也需同样防护

### 约束

- **禁止 `import` / `<script type="module">`** — 用 `window.__TAURI_INTERNALS__.invoke(cmd, args)` 代替
- **实体用 ID 关联** — 任何可改名实体必须有不可变 UUID，目录路径/存储键/引用一律用 ID 不用名称
- **无 `devUrl`** — 配了会导致 `cargo tauri dev` 卡住（无外部 dev server）
- **无 `console.log` 调试** — 用 `window.__log.info/perf/warn/error()`
- **`load_*`/`get_*` 函数禁止有副作用** — 不能在里面执行写操作或系统命令

### 性能约束（Tab 切换）

四条规则**缺一不可**（详见 LESSONS.md「Tab 切换」）：
1. **`switchTab` 必须有执行锁** — `_switchLock` 在双重 rAF 后才释放，5 秒超时兜底
2. **`will-change: opacity` 只能加在 `.panel.active`** — 禁止常驻 GPU 合成层
3. **`escapeHtml` 必须用纯字符串替换** — 禁止 DOM 版，避免 GC 暂停
4. **Tab click handler 必须有 300ms 防抖** — 配合执行锁双层防护

### 备份目录结构

```
{backup_root}/{game_id}/{slot_id}/{timestamp_folder_name}/
├── meta.json    ← 文件列表、hash、创建时间、备注
├── save.dat     ← 源文件（1 到 N 个）
└── ...
```

### 主题

暗色值必须写在 `:root`，亮色覆盖必须写在 `body.light`。主题切换必须用 `applyTheme()` 函数。**禁止硬编码色值**。

常用变量速查：`--bg`（背景）、`--text`（主文字）、`--text-secondary`（次要文字）、`--accent`（强调色，暗 `#4b8bf4` / 亮 `#3b82f6`）、`--border`（边框）、`--surface`（卡片底）、`--input-bg`（输入框）。需 `rgba()` 时用 `rgba(var(--accent-rgb), x)`。

**玻璃拟态：** `--glass-bg`（玻璃底）、`--glass-border`（玻璃边框）、`--radius-glass`（玻璃圆角 14px）。暗色 `backdrop-filter: blur(16px)`，亮色 `backdrop-filter: blur(12px)` + 径向渐变背景衬托通透感。

**语义变量：** `--holiday-accent`（节假日紫色高亮 `139, 92, 246`，暗/亮同值）用于 `.settings-group.holiday` 及相关元素，禁止硬编码紫色。

### 依赖

`tauri = "2"`（tray-icon feature）、`serde`（derive）、`serde_json`、`chrono`（serde feature）、`rfd = "0.17"`、`md-5 = "0.10"`、`notify-rust = "4"`

**Rust edition** `= "2024"`（Cargo.toml），注意此版本的新语法和语义变化。

### 窗口

960×720 不可缩放，无边框，默认隐藏（`visible: false`）。启动时检查 `--minimized` 参数：有则保持隐藏（开机自启场景），无则调用 `window.show()`（手动启动场景）。最小化隐藏到托盘，关闭完全退出。`config.minimize_to_tray` 控制开关。
