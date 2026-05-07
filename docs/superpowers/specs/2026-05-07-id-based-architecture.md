# ID 化架构 + 路径记忆 — 设计规格

## 目标

用唯一 ID（UUID）替代名称作为游戏/存档位的关联键，解决改名后备份列表丢失和文件路径丢失两个问题。同时将存档文件路径持久化到配置中。

## 改动范围

- `src/main.rs`：数据结构（GameConfig/SlotConfig 加 id）、目录路径逻辑（所有命令）、移除旧格式兼容
- `src/main.js`：前端键从名称改为 ID、渲染数据驱动
- `tauri.conf.json`：窗口标题已改为 HRB Tools

## 数据结构

```rust
struct SlotConfig {
    id: String,                    // UUID，唯一标识
    name: String,
    file_path: String,             // 新增：记住存档文件路径
    next_backup_number: u32,
    key_file_patterns: Vec<String>,
}

struct GameConfig {
    id: String,                    // UUID，唯一标识
    name: String,
    slots: Vec<SlotConfig>,
    pinned: bool,
    sort_order: u32,
}
```

## 目录结构

```
备份根目录/
  └── {game_id}/         ← 用 ID，不是名称
      └── {slot_id}/     ← 用 ID，不是名称
          └── 2026-05-07 14-30-22 1/
              ├── meta.json
              └── save.dat
```

## 前端状态

```js
let selectedGameId = '';
let selectedSlotId = '';
let filePathBySlot = {};    // { "gameId:slotId": "D:/path" }
let currentHashBySlot = {}; // { "gameId:slotId": "abc123" }
```

## 关键规则

- **改名**：只改 `name`，`id` 不变，目录路径不变，前端键不变
- **新增游戏/存档位**：首次创建时生成 UUID（前端用 `crypto.randomUUID()`）
- **目录路径构造**：所有 Rust 命令从 `game_id + slot_id` 拼接路径
- **旧数据**：不兼容，直接清理（重新生成 config.json）

## ID 生成

- JS 端 `crypto.randomUUID()` 生成（无需后端依赖）
- 新增时一次性生成，后续永远不变
