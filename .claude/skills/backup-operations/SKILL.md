---
name: backup-operations
description: 使用当要处理备份相关功能时（创建/恢复/列表/删除/重命名/重算哈希）。
---

# 备份系统操作指南

## 概述

本项目的备份系统涉及 Rust 后端 `src/main.rs` 中的备份 CRUD 命令，以及前端 `main.js` 中的存档管理面板。备份目录和元数据有严格的格式约定。

## 备份目录结构

```
备份根目录/
  └── {game_id}/              ← 游戏 UUID（非名称）
      └── {slot_id}/          ← 存档位 UUID（非名称）
          └── YYYY-MM-DD HH-MM-SS 序号/   ← 时间戳 + 空格 + 序号
              ├── meta.json   ← 元数据
              ├── save.dat    ← 源文件（1 到 N 个）
              └── ...
```

- **目录路径用 UUID，不是名称**——改名不会导致备份路径断裂
- 文件夹名格式：`YYYY-MM-DD HH-MM-SS 序号`（两部分：时间戳 + 序号）

## meta.json 格式

新格式（`files` 映射）：

```json
{
  "display_name": "YYYY-MM-DD HH:MM:SS 序号",
  "description": "序号",
  "files": {
    "save.dat": { "original_path": "D:/saves/save.dat", "content_hash": "abc123" },
    "config.ini": { "original_path": "D:/saves/config.ini", "content_hash": "def456" }
  },
  "pinned": false
}
```

旧格式（单文件，自动兼容读取）：

```json
{
  "display_name": "...",
  "original_file_path": "D:/saves/save.dat",
  "content_hash": "abc123"
}
```

## 哈希去重

- 使用 `md-5` crate 计算 MD5 哈希
- 备份前计算所有源文件哈希，与最近一次备份的哈希逐一比对
- **全部匹配** → 返回"存档未变化，无需重复备份"
- 前端通过 `hash-match`（= 当前文件）和 `hash-duplicate`（= 其他备份）badge 显示
- `key_file_patterns` 支持通配符：`*xxx`、`xxx*`、`*xxx*`

## 恢复协议

Rust 后端 `restore_backup` 命令使用特殊返回值与前端交互：

| 返回值 | 含义 | 前端处理 |
|--------|------|---------|
| `success: true` | 恢复成功 | 显示成功消息 |
| `SELECT_FILES:name\|path;;name2\|path2` | 多文件需用户选择 | 弹出文件选择弹窗，让用户勾选 |
| `NEED_BACKUP_CONFIRM:original_path` | 目标文件未备份 | 询问用户是否先备份再恢复 |

流程：

1. 调用 `restore_backup` 尝试恢复
2. 收到 `SELECT_FILES` → 显示文件选择弹窗 → 用户确认后带 `selectedFiles` 再次调用
3. 收到 `NEED_BACKUP_CONFIRM` → 用户选择"先备份"或"直接覆盖" → 相应操作后再次调用

## 重命名

- `rename_backup` 仅改文件夹名中的描述部分（时间戳不可变）
- 同时更新 `meta.json` 中的 `display_name` 和 `description`

## Rust 后端命令

| 命令 | 参数 | 说明 |
|------|------|------|
| `create_backup` | `gameId`, `slotId`, `filePaths` | 创建备份 |
| `list_backups` | `gameId`, `slotId` | 列备份（按置顶+时间排序） |
| `delete_backup` | `gameId`, `slotId`, `folderName` | 删目录 |
| `rename_backup` | `gameId`, `slotId`, `folderName`, `newDescription` | 改描述 |
| `restore_backup` | `gameId`, `slotId`, `folderName`, `skipBackup`, `selectedFiles` | 恢复 |
| `compute_hash` | `filePaths`, `patterns` | 计算哈希 |
| `recompute_backup_hash` | `gameId`, `slotId`, `folderName` | 重算 meta hash |
| `toggle_backup_pin` | `gameId`, `slotId`, `folderName` | 切换置顶 |
