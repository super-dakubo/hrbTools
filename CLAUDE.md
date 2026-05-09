# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

> **代码开发前必须阅读 [LESSONS.md](./docs/LESSONS.md)** — 本项目反复踩过的坑和硬性约束。
> **UI/样式修改前必须阅读 [docs/design-system.md](./docs/design-system.md)** — 颜色令牌、排版、组件标准、主题规则。
> **处理特定功能时阅读 [docs/ARCHITECTURE.md](./docs/ARCHITECTURE.md) 对应章节** — 数据结构、命令列表、持久化、DST、备份、窗口等详细参考。
>
> **项目 skill 位于 `.claude/skills/`** — 通过 `/skill-name` 或 Skill 工具调用。当前可用：
> - `panel-isolation` — 修改 main.js 时遵守面板隔离
> - `backup-operations` — 备份系统操作规范
> - `tauri-command-pattern` — 添加新 Tauri 命令
> - `id-based-entities` — 添加可改名实体时用 ID 关联
> - `simplify` — 审查代码质量、去重、效率优化
>
> **全局 superpowers skill**（`.claude/plugins/`）也均可用：`brainstorming`、`writing-plans`、`subagent-driven-development`、`test-driven-development`、`systematic-debugging` 等，按需使用 Skill 工具调用。
>
> **权限配置** — 本项目权限采用分层设计：通用 git/cargo 命令在全局配置中授权，项目级 `.claude/settings.local.json` 仅放 Tauri 特有命令（`cargo tauri dev/build`）和远端推送。不在此放 npm 或不相关命令。新增常用命令时优先考虑全局配置。

## 常用命令

- `cargo tauri dev` – 启动 Tauri 开发服务器（无 hot-reload，修改前端文件后需重启或 Ctrl+R 刷新）
- `cargo tauri build` – 构建生产版本
- `cargo build` – 仅编译 Rust 后端
- `cargo test` – 运行测试（当前无测试用例，仅验证编译）

## 架构概述

Tauri 2.0 桌面应用（**仅 Windows**），**无边框窗口** + 自定义标题栏，左侧 Tab 拖动排序，右上角齿轮设置弹窗。

### 后端（src/main.rs）

全部 Rust 代码在单个文件中，用 `// ====================` 分隔区块。配置存于 `%APPDATA%/com.hrbTools.app/config.json`。

### 备份存储结构

存档备份目录结构为 `{backup_root}/{game_id}/{slot_id}/{file_hash}_{file_name}`。各层含义：
- `game_id` / `slot_id` — UUID，由 `crypto.randomUUID()` 生成，不可变
- `file_hash` — 文件 MD5 前 16 位，用于去重（同名同哈希的备份只存一份）
- 每层目录下有 `meta.json` 存储元数据

操作备份文件时不要手动拼路径，通过 Tauri 命令交互。

### 前端

- **无 npm/打包器**——纯原生 HTML/CSS/JS，禁止 `import` 语句和 `<script type="module">`
- 三个功能面板（时间转换、存档管理、待办工具）共用 `main.js`，但**互不共享状态，修改一个绝不能动另一个的代码**
- main.js 中三个面板用 `// ====================` 分隔：时间转换（约 L60-L280）、存档管理（约 L280-L1300）、待办工具（约 L1370-EOF）

### 约束

- **禁止 `import`** — 用 `window.__TAURI_INTERNALS__.invoke(cmd, args)` 代替
- **实体用 ID 关联** — 游戏名/存档位名可改，关联必须用 UUID（详见 LESSONS.md 第 7 条）
- **无 `devUrl`** — 配了会导致 `cargo tauri dev` 卡住

### 主题

CSS 变量定义在 `:root`（暗色），亮色覆盖在 `body.light`。通过 JS `applyTheme()` 三态切换。**禁止硬编码色值**。

常用变量速查：`--bg`（背景）、`--text`（主文字）、`--accent`（强调色）、`--border`（边框）、`--surface`（卡片底）、`--input-bg`（输入框）。需 `rgba()` 时用 `rgba(var(--accent-rgb), x)`。

### 依赖

`tauri = "2"`, `serde`, `chrono`, `rfd = "0.17"`, `md-5 = "0.10"`, `notify-rust = "4"`

### 窗口

780×640 不可缩放，无边框。最小化隐藏到托盘，关闭完全退出。`config.minimize_to_tray` 控制开关。
