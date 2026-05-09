# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

> **代码开发前必须阅读 [LESSONS.md](./docs/LESSONS.md)** — 本项目反复踩过的坑和硬性约束。
> **README 截图见 [screenshots/](./screenshots/) 目录** — 截图和演示 GIF 放这里。
> **UI/样式修改前必须阅读 [docs/design-system.md](./docs/design-system.md)** — 颜色令牌、排版、组件标准、主题规则。
> **处理特定功能时阅读 [docs/ARCHITECTURE.md](./docs/ARCHITECTURE.md) 对应章节** — 数据结构、命令列表、持久化、DST、备份、窗口等详细参考。
>
> **项目 skill 位于 `.claude/skills/`** — 通过 `/skill-name` 或 Skill 工具调用。当前可用：
> - `panel-isolation` — 修改 main.js 时遵守面板隔离
> - `backup-operations` — 备份系统操作规范
> - `tauri-command-pattern` — 添加新 Tauri 命令
> - `id-based-entities` — 添加可改名实体时用 ID 关联
>
> **全局 superpowers skill**（`.claude/plugins/`）也均可用：`brainstorming`、`writing-plans`、`subagent-driven-development`、`test-driven-development`、`systematic-debugging` 等，按需使用 Skill 工具调用。
>
> **权限配置** — 本项目权限采用分层设计：通用 git/cargo 命令在全局配置中授权，项目级 `.claude/settings.local.json` 仅放 Tauri 特有命令（`cargo tauri dev/build`）和远端推送。不在此放 npm 或不相关命令。新增常用命令时优先考虑全局配置。
>
> **`cargo tauri dev` 无 hot-reload** — 修改前端文件（index.html / main.js / styles.css）后需重启或按 Ctrl+R 刷新 WebView。Rust 端修改会自动重新编译。

## 常用命令

- `cargo tauri dev` – 启动 Tauri 开发
- `cargo tauri build` – 生产构建
- `cargo build` – 仅编译 Rust 后端
- `cargo test` – 运行测试（当前仅验证编译）

## 架构概述

Tauri 2.0 桌面应用（**仅 Windows**），无 npm/打包器，纯原生 HTML/CSS/JS + Rust 单文件后端。

**无边框窗口**（`decorations: false`），自定义标题栏，左侧 Tab 栏（支持鼠标拖拽排序），右侧内容面板通过 `position: absolute` + `opacity` 合成层切换（避免 `display:none/block` 的布局重算）。

### 源文件一览

| 文件 | 说明 |
|------|------|
| [src/index.html](src/index.html) | HTML 骨架，4 面板 DOM（时间转换/存档管理/待办/日志）+ 设置弹窗 |
| [src/styles.css](src/styles.css) | CSS 变量主题系统（暗色/亮色）+ 全部组件样式 |
| [src/main.js](src/main.js) | 全部前端逻辑，`// ===` 分隔为 Tab/时间转换/存档/待办/日志 五大区块 |
| [src/main.rs](src/main.rs) | 全部 Rust 逻辑，27 个 Tauri 命令，6 个数据结构 |

### 前端（src/main.js）分区

`// ==================== 区块名 ====================` 分隔，用 Grep 搜索 `=== 区块名` 定位目标区块：

| 区块 | 分隔标记 | 核心函数 |
|------|---------|----------|
| Tab 栏管理 + 拖拽 | `=== Tab 栏管理 ===` | `renderTabBar`, `bindTabEvents`, `switchTab` |
| 时间转换面板 | `=== 时间转换 ===` | `renderTimezoneSets`, `saveTimezoneValues` |
| 存档管理面板 | `=== 配置管理 ===` ~ `=== 按钮防重复 ===` | `renderGameTabs`, `renderSlotTabs`, `refreshBackupList` |
| 待办工具面板 | `=== 待办工具 ===` | `renderTodos`, `openTodoEditModal`, `toggleTodoDone` |
| 启动（init） | `=== 启动 ===` | `DOMContentLoaded` → rAF 分步初始化 |
| 日志系统（IIFE + 面板渲染） | `=== 日志系统 ===` + `=== 日志面板渲染 ===` | `window.__log`, `renderLogPanel`, `bindLogPanelEvents` |

### 日志系统

前端环形缓冲区（`window.__log`，2000 条上限）→ Tauri IPC `log_write` → `%APPDATA%/com.hrbTools.app/logs/YYYY-MM-DD.log`（10MB 自动轮转）。

- 写入策略：全部级别写入文件，每 10 秒或满 100 条自动 flush（INFO 及以上输出到控制台）
- 启动时自动加载今日日志文件到缓冲区（`window.__log.loadFromFile()`）
- 日志面板：第 4 个 Tab，支持搜索、级别筛选、打开日志目录、清屏、导出（`export()`）
- 所有 Tab 切换通过双重 rAF 记录 PERF 日志（dom/action/render 分段耗时）

### 后端（src/main.rs）

- `tauri::command` 参数名用 **camelCase**, 结构体字段用 **snake_case**（Tauri 宏 vs serde 差异）
- 写操作统一返回 `{ success: bool, message: string }`
- 配置通过 `load_config(&app)` / `save_config(&app, &config)` 读写
- 后台提醒线程在 `setup()` 中 `std::thread::spawn` 启动，每秒轮询磁盘 config.json

### 约束

- **禁止 `import` / `<script type="module">`** — 用 `window.__TAURI_INTERNALS__.invoke(cmd, args)` 代替
- **实体用 ID 关联** — 任何可改名实体必须有不可变 UUID，目录路径/存储键/引用一律用 ID 不用名称
- **无 `devUrl`** — 配了会导致 `cargo tauri dev` 卡住（无外部 dev server）
- **无 `console.log` 调试** — 用 `window.__log.info/perf/warn/error()`

### 主题

CSS 变量定义在 `:root`（暗色），亮色覆盖在 `body.light`。JS `applyTheme()` 三态切换。**禁止硬编码色值**。

常用变量速查：`--bg`（背景）、`--text`（主文字）、`--accent`（强调色，暗 `#4b8bf4` / 亮 `#0d9488` 青绿）、`--border`（边框）、`--surface`（卡片底）、`--input-bg`（输入框）。需 `rgba()` 时用 `rgba(var(--accent-rgb), x)`。

### 依赖

`tauri = "2"`（tray-icon feature）、`serde`、`serde_json`、`chrono`（serde feature）、`rfd = "0.17"`、`md-5 = "0.10"`、`notify-rust = "4"`

### 窗口

780×640 不可缩放，无边框。最小化隐藏到托盘，关闭完全退出。`config.minimize_to_tray` 控制开关。
