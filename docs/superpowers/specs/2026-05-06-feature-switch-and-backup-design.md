# 功能切换与游戏存档管理 — 设计文档

## 概述

在现有"日期时间转 Unix 时间戳"功能基础上，新增：

1. **顶部 Tab 标签切换**，在两个功能模块间切换
2. **游戏存档备份管理**模块：按游戏名分区、选择文件、备份、列表管理、恢复

## 架构

```
┌─────────────────────────────────────────────────────┐
│  index.html                                         │
│  ┌───────┬─────────────────────────────────────┐    │
│  │ Tab栏 │  时间转换  │  存档管理  │             │    │
│  └───────┴─────────────────────────────────────┘    │
│  ┌─────────────────────────────────────────────┐    │
│  │           功能面板（切换显示）                  │    │
│  └─────────────────────────────────────────────┘    │
│  main.js  ← invoke →  main.rs (Tauri commands)     │
└─────────────────────────────────────────────────────┘
```

采用方案 A：纯 Tauri 后端驱动，Rust 处理全部文件操作和配置持久化，前端仅负责 UI。

## 前端设计

### Tab 栏

页面顶部两个标签，默认选中"时间转换"。

### 存档管理面板布局

- **选择游戏**：下拉列表（历史游戏名），旁边 "+" 按钮新增游戏名
- **文件路径**：文本框（手动输入） + "浏览"按钮（调用系统文件对话框选择单个文件）
- **保存存档**：备份到 `备份根目录/游戏名/日期+时分秒文件夹/原文件名`
- **存档列表**：每行显示备份时间，提供恢复/删除/重命名按钮
- **设置备份目录**：底部按钮，弹出目录选择对话框

### 现有面板保留

时间转换面板的 HTML 结构包裹在一个容器 div 中，用于 Tab 切换时的显示/隐藏。

## 后端设计（Rust）

### 新增数据结构

```rust
struct AppConfig {
    backup_root: String,
    game_names: Vec<String>,
}

struct BackupInfo {
    folder_name: String,
    display_name: String,
    created_at: String,
    original_file_path: String,
}

struct OpResult {
    success: bool,
    message: String,
}
```

### 新增 Tauri Commands

| 命令 | 输入 | 输出 | 说明 |
|------|------|------|------|
| `get_config` | 无 | `AppConfig` | 读取持久化配置 |
| `set_config` | `AppConfig` | `OpResult` | 保存配置 |
| `pick_file` | 无 | 路径字符串 | 系统文件选择对话框 |
| `pick_directory` | 无 | 路径字符串 | 系统目录选择对话框 |
| `create_backup` | `{game_name, file_path}` | `OpResult` | 复制文件到备份目录 |
| `list_backups` | `game_name` | `Vec<BackupInfo>` | 列出某游戏所有备份 |
| `delete_backup` | `{game_name, folder_name}` | `OpResult` | 删除备份文件夹 |
| `rename_backup` | `{game_name, folder_name, new_name}` | `OpResult` | 重命名备份文件夹 |
| `restore_backup` | `{game_name, folder_name}` | `OpResult` | 复制备份文件回原路径 |

### 备份目录结构

```
备份根目录/
  └── 游戏名/
      ├── 2026-05-06 15-30-22/
      │   ├── meta.json
      │   └── save001.dat
      └── 2026-05-05 10-22-15/
          ├── meta.json
          └── save001.dat
```

- 文件夹名：`YYYY-MM-DD HH-MM-SS`（冒号替换为横线，避免 Windows 路径问题）
- `meta.json`：存储 `{"original_file_path": "...", "display_name": "..."}`
- 备份的文件保持原名

## 数据流

### 备份流程
1. 用户选择游戏名、文件路径，点击"保存存档"
2. 前端 `invoke('create_backup', { game_name, file_path })`
3. Rust：检查文件存在 → 生成时间戳文件夹名 → 创建目录 → 复制文件 → 写入 meta.json
4. 返回 `OpResult`，前端刷新存档列表

### 恢复流程
1. 用户点击某条备份的"恢复"，确认
2. 前端 `invoke('restore_backup', { game_name, folder_name })`
3. Rust：读取 meta.json → 复制备份文件回原始路径
4. 返回结果

## 配置持久化

- 配置文件：`config.json`，存储在 Tauri app data 目录
- 内容：`backup_root`（备份根目录路径）、`game_names`（游戏名称列表）
- 启动时自动加载，修改时自动保存
- 读取失败时使用空默认值，不影响启动

## 错误处理

| 场景 | 处理 |
|------|------|
| 备份目录未设置 | 前端提示"请先设置备份目录" |
| 备份目录不存在 | 创建时自动递归创建 |
| 源文件不存在 | 返回错误信息 |
| 磁盘/IO 错误 | Rust 捕获，返回友好中文提示 |
| 配置 JSON 损坏 | 使用默认值，不阻止启动 |

## 文件改动范围

| 文件 | 改动类型 | 说明 |
|------|---------|------|
| `src/main.rs` | 大幅修改 | 新增 9 个 command、数据结构、配置功能 |
| `src/index.html` | 大幅修改 | 新增 Tab 栏、存档管理面板 |
| `src/main.js` | 大幅修改 | 新增存档相关事件处理和 Tab 切换 |
| `src/styles.css` | 大幅修改 | 新增 Tab、列表、标记等样式 |
| `Cargo.toml` | 修改 | 可能增加 `dirs` 或使用 Tauri 自带路径 API |
