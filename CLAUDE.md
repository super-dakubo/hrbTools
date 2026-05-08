# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

> **代码开发前必须阅读 [LESSONS.md](./LESSONS.md)** — 记录了本项目反复踩过的坑和硬性约束。
> **UI/样式修改前必须阅读 [docs/design-system.md](./docs/design-system.md)** — 颜色令牌、排版、组件标准、主题规则。

## 常用命令

- `cargo tauri dev` – 启动 Tauri 开发服务器（Rust 后端 + 网页前端）
- `cargo tauri build` – 为当前平台构建生产版本二进制文件
- `cargo build` – 仅编译 Rust 后端
- `cargo test` – 运行测试（当前无测试用例，仅验证编译）

## 架构概述

Tauri 2.0 桌面应用，包含两个功能模块，通过顶部 Tab 标签页切换：

- **时间转换**（默认 Tab）— 日期时间字符串 → Unix 时间戳
- **存档管理** — 游戏存档备份、列表管理、恢复

代码保持扁平结构：`src/main.rs`（Rust 后端）、`src/index.html`、`src/main.js`、`src/styles.css`（前端）。

### 后端（src/main.rs）

全部代码在单个文件中，用分隔注释 `// ====================` 区分区块。包含 11 个 `#[tauri::command]`：

| 分组 | 命令 | 说明 |
|------|------|------|
| 时间转换 | `convert_to_timestamp` | 时间字符串 → 毫秒时间戳 |
| 时间转换 | `convert_to_datetime` | 毫秒时间戳 → 时间字符串（双向转换） |
| 配置 | `get_config`, `set_config` | 读写持久化配置到 `config.json`（存储在 Tauri app data 目录） |
| 文件对话框 | `pick_file`, `pick_directory` | 调用系统原生文件/目录选择器（基于 `rfd` crate） |
| 备份操作 | `create_backup` | 复制文件到 `备份根目录/游戏名/时间戳文件夹/`，写入 `meta.json` |
| 备份管理 | `list_backups`, `delete_backup`, `rename_backup`, `restore_backup` | 列出/删除/重命名/恢复备份 |

关键数据结构：`AppConfig`（备份根目录 + 游戏列表）、`BackupInfo`（文件夹名、显示名、原始路径）、`OpResult`（操作结果）。

需要 `use chrono::TimeZone` trait 才能调用 `from_local_datetime`。

### 前端

- **index.html** — Tab 栏 + 两个面板（`#panel-convert` / `#panel-backup`），通过 `.panel.active` 控制显示
- **main.js** — 分区组织：Tab 切换、时间转换、配置管理、游戏管理、文件选择、备份操作、存档列表、备份管理操作、工具函数。直接使用 `window.__TAURI_INTERNALS__.invoke()` 调用后端（无 npm 依赖），详细命名规则见下文"命名约定"
- **styles.css** — 按组件分区：Tab 栏、面板、共用组件、时间转换、消息提示、存档管理、存档列表

### 备份目录结构

```
备份根目录/
  └── 游戏名/
      └── 2026-05-06 15-30-22/
          ├── meta.json    ← {"original_file_path": "...", "display_name": "..."}
          └── save.dat     ← 原文件保持原名
```

文件夹名用 `YYYY-MM-DD HH-MM-SS` 格式（冒号替换为横线避免 Windows 路径问题）。

### 配置持久化

配置保存为 `config.json` 于 Tauri app data 目录（Windows: `%APPDATA%/com.hrbTools.app/`），结构：

```json
{
  "backup_root": "D:/backups",
  "game_names": ["游戏A", "游戏B"]
}
```

启动时 `loadConfig()` 自动加载，失败时使用空默认值。

### 依赖

- `tauri = "2.0"` — 桌面框架
- `tauri-build = "2"` — 构建时依赖
- `serde` / `serde_json` — JSON 序列化
- `chrono`（开启 `serde` feature）/ `chrono-tz` — 时间解析与时区
- `rfd = "0.17"` — 系统原生文件对话框

### 命名约定

见 [LESSONS.md](./LESSONS.md) 第 1 条。核心：命令参数用 camelCase，结构体字段用 snake_case。

### 无构建步骤

见 [LESSONS.md](./LESSONS.md) 第 2-4 条。无 npm/打包器，禁止 ES module import，用 `window.__TAURI_INTERNALS__`。

### 平台特定

- `#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]` 在 Windows release 构建中隐藏控制台窗口
- `tauri.conf.json` 中 `build.frontendDist` 指向 `./src`（前端文件无构建步骤）
- 图标文件位于 `icons/`（32x32.png, 128x128.png, icon.ico）
