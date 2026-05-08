# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

> **代码开发前必须阅读 [LESSONS.md](./LESSONS.md)** — 本项目反复踩过的坑和硬性约束。
> **UI/样式修改前必须阅读 [docs/design-system.md](./docs/design-system.md)** — 颜色令牌、排版、组件标准、主题规则。

## 常用命令

- `cargo tauri dev` – 启动 Tauri 开发服务器
- `cargo tauri build` – 构建生产版本
- `cargo build` – 仅编译 Rust 后端
- `cargo test` – 运行测试（当前无测试用例，仅验证编译）

## 架构概述

Tauri 2.0 桌面应用，**无边框窗口**（自定义标题栏），左侧 Tab 切换两个功能面板，右上角齿轮设置弹窗。前端无 npm/打包器，纯原生 HTML/CSS/JS。

### 后端（src/main.rs）

全部 Rust 代码在单个文件中，用 `// ====================` 分隔区块。约 22 个 `#[tauri::command]`：

| 分组 | 命令 | 说明 |
|------|------|------|
| 时间转换 | `convert_to_timestamp`, `convert_to_datetime` | 双向时间转换（多时区套件） |
| 配置 | `get_config`, `set_config` | 读写 `config.json`（存于 `%APPDATA%/com.hrbTools.app/`） |
| 文件对话框 | `pick_file`, `pick_directory` | 系统原生选择器（`rfd` crate） |
| 备份操作 | `create_backup`, `list_backups`, `delete_backup`, `rename_backup`, `restore_backup` | 备份 CRUD，参数含 `gameId`/`slotId` |
| 哈希 | `compute_hash`, `recompute_backup_hash` | MD5 去重（`md-5` crate） |
| 置顶 | `toggle_backup_pin`, `toggle_game_pin` | 游戏/备份置顶切换 |
| 文件管理 | `open_folder` | 系统文件管理器打开目录 |
| 时区套件 | `add_timezone_set`, `remove_timezone_set`, `update_timezone_set`, `toggle_timezone_pin` | 多时区转换套件管理 |
| 窗口 | `window_minimize`, `window_toggle_maximize`, `window_close` | 自定义标题栏窗口控制 |

**关键数据结构：**

- `AppConfig` — `backup_root`、`games: Vec<GameConfig>`、`timezone_sets: Vec<TimezoneSet>`、`theme: String`
- `GameConfig` — `id`（UUID）、`name`、`slots: Vec<SlotConfig>`、`pinned`
- `SlotConfig` — `id`（UUID）、`name`、`file_path`、`next_backup_number`、`key_file_patterns`
- `TimezoneSet` — `id`（"beijing" 或 UUID）、`timezone`、`datetime_format`、`pinned`、`sort_order`
- `BackupInfo` — `folder_name`、`display_name`、`description`、`original_file_path`、`content_hash`、`pinned`
- `OpResult` — `success`、`message`

### 前端

- **index.html** — 自定义标题栏（`#title-bar`）+ 设置弹窗（`#settingsOverlay`）+ 左侧 Tab 栏 + 时间转换面板（`#timezoneSets`）+ 存档管理面板（双层游戏/存档位标签 + 备份列表）
- **main.js** — IPC 封装 (`window.__TAURI_INTERNALS__.invoke`)；时区套件渲染/事件委托；存档管理（游戏/存档位 ID 化标签、备份 CRUD、哈希去重、置顶）；设置弹窗（备份根目录 + 主题切换）；按钮防重复（`setButtonLoading`/`resetButton`）
- **styles.css** — CSS 变量主题系统（`:root` 暗色 + `body.light` 亮色），包含颜色、排版、圆角、间距四组令牌

### 备份目录结构

```
备份根目录/
  └── {game_id}/              ← 游戏 UUID（非名称）
      └── {slot_id}/          ← 存档位 UUID（非名称）
          └── YYYY-MM-DD HH-MM-SS 描述/   ← 时间戳 + 空格 + 序号
              ├── meta.json   ← { original_file_path, display_name, description, content_hash }
              └── save.dat
```

ID 化意味着改游戏/存档位名不会导致备份路径断裂。详见 [LESSONS.md](./LESSONS.md) 第 7 条。

### 配置结构（config.json）

```json
{
  "backup_root": "D:/backups",
  "theme": "system",
  "games": [
    {
      "id": "uuid",
      "name": "游戏1",
      "pinned": false,
      "slots": [
        { "id": "uuid", "name": "存档1", "file_path": "D:/saves/file.dat",
          "next_backup_number": 3, "key_file_patterns": [] }
      ]
    }
  ],
  "timezone_sets": [
    { "id": "beijing", "timezone": "Asia/Shanghai", "datetime_format": "", "pinned": false, "sort_order": 0 },
    { "id": "india", "timezone": "Asia/Kolkata", "datetime_format": "", "pinned": false, "sort_order": 1 }
  ]
}
```

- 北京套件 `id: "beijing"` — 时区锁定不可改不可删
- 主题 `"system"` / `"dark"` / `"light"` — 默认跟随系统

### 主题系统

CSS 变量定义在 `:root`（暗色默认），亮色覆盖在 `body.light`。三态切换通过 JS `applyTheme()` 实现，`"system"` 模式监听 `prefers-color-scheme: dark`。禁止硬编码色值——所有颜色必须通过 CSS 变量引用。

### 依赖

- `tauri = "2"` / `tauri-build = "2"` — 桌面框架
- `serde` / `serde_json` — JSON
- `chrono`（`serde` feature）/ `chrono-tz` — 时间解析
- `rfd = "0.17"` — 系统对话框
- `md-5 = "0.10"` — 内容哈希去重

### 窗口配置（tauri.conf.json）

- 700×580 固定大小，不可缩放
- 无边框（`decorations: false`），自定义标题栏
- 前端文件指向 `./src`（无 `devUrl`）
