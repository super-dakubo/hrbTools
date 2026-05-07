# 游戏存档横向标签栏 — 设计规格

## 目标

将存档管理面板中的纵向游戏列表改为横向标签栏，支持每个游戏下的多个存档位（角色存档），每个存档位独立管理备份链。

## 改动范围

- **前端**：`src/index.html`、`src/styles.css`、`src/main.js`
- **后端**：`src/main.rs`（数据结构 + 命令签名）
- **不动**：左侧全局 Tab 栏、时间转换面板
- **旧数据**：不兼容，直接清掉

---

## 界面布局

```
┌──────────────────────────────────────────────┐
│ ⏰时间转换 │ 💾存档管理                      │  ← 左侧全局 Tab（不变）
├──────────────────────────────────────────────┤
│                                              │
│  💾 游戏存档备份                             │
│                                              │
│  ┌─ 塞尔达 ─── 原神 ─── 星露谷 ── + ──────┐ │  ← 第一层：游戏标签（矩形）
│  │ ×              ×          ×              │ │     横向滚动，底部蓝色下划线激活
│  └──────────────────────────────────────────┘ │
│                                              │
│  存档位  ◉角色A  ○角色B  +                  │  ← 第二层：存档位标签（胶囊）
│                                              │
│  存档文件  [________________] [浏览]         │
│  备份位置  D:\backups            [设置目录]  │
│  [保存存档]                                  │
│                                              │
│  备份记录 — 塞尔达 / 角色A                   │
│  ┌──────────────────────────────────────────┐ │
│  │ 2026-05-07 14:30  .../save.dat 恢复...   │ │
│  │ 2026-05-06 10:15  .../save.dat 恢复...   │ │
│  └──────────────────────────────────────────┘ │
└──────────────────────────────────────────────┘
```

- 容器宽度从 580px → 720px
- 游戏标签溢出时横向滚动
- 存档位标签使用胶囊样式（border-radius: 15px）

---

## 数据结构

### 配置结构（config.json）

```rust
struct SlotConfig {
    name: String,
}

struct GameConfig {
    name: String,
    slots: Vec<SlotConfig>,
}

struct AppConfig {
    backup_root: String,
    games: Vec<GameConfig>,
}
```

### 备份目录结构

```
备份根目录/
  └── 游戏名/
      └── 存档位名/
          └── 2026-05-07 14-30-22/
              ├── meta.json    ← { "original_file_path": "...", "display_name": "..." }
              └── save.dat
```

### 前端状态

```js
let selectedGame = '';       // 当前选中的游戏名
let selectedSlot = '';       // 当前选中的存档位名
let filePathBySlot = {};     // { "塞尔达:角色A": "D:/saves/file.dat" } — 每个存档位记住路径
```

---

## 交互行为

1. **切换游戏标签** → 更新 `selectedGame`，自动选该游戏第一个存档位，恢复记住的文件路径，刷新备份列表
2. **切换存档位标签** → 更新 `selectedSlot`，恢复记住的文件路径，刷新备份列表
3. **删除游戏** → 点标签上的 ×，`confirm()` 确认，从配置中移除
4. **删除存档位** → 点胶囊上的 ×，`confirm()` 确认（最后一个存档位不允许删除）
5. **新增游戏** → 点击末尾 `+`，标签位置变为 `<input>` 内联编辑，回车确认
6. **新增存档位** → 点击末尾 `+`，胶囊位置变为 `<input>` 内联编辑，回车确认
7. **保存存档** → 传入 `gameName + slotName`，文件路径在切换时自动记忆

---

## Rust 命令变更

| 命令 | 参数变更 |
|------|----------|
| `get_config` | 返回值结构变化（`games` 替代 `game_names`） |
| `set_config` | 传入结构变化 |
| `create_backup` | 新增参数 `slotName: String` |
| `list_backups` | 新增参数 `slotName: String` |
| `delete_backup` | 新增参数 `slotName: String` |
| `rename_backup` | 新增参数 `slotName: String` |
| `restore_backup` | 新增参数 `slotName: String` |

所有命令参数使用 camelCase（Tauri 自动转换），结构体字段使用 snake_case。

---

## CSS 变更清单

**新增**：`.game-tabs`、`.game-tab`、`.game-tab-add`、`.slot-tabs`、`.slot-tag`、`.slot-tag-add`

**移除**：`.game-list`、`.game-item`、`.game-item.active`、`.game-item-name`、`.btn-delete-game`

**调整**：`.container` max-width 580px → 720px

---

## 不做什么

- 不安装新依赖
- 不修改左侧全局 Tab 和时间转换面板
- 不兼容旧 config.json 格式
- 不保留旧的纵向游戏列表样式
