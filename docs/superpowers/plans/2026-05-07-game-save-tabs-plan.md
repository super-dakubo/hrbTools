# 游戏存档横向标签栏 — 实现计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 将存档管理面板从纵向游戏列表改为双层横向标签栏（游戏+存档位），增加哈希去重、备份置顶、游戏拖拽排序、设置弹窗。

**Architecture:** 分 5 阶段 —— Rust 后端数据结构+命令 → HTML 布局 → CSS 样式 → JS 逻辑 → 集成验证。每阶段内部可独立编译/预览。

**Tech Stack:** Tauri 2.0 + Rust (chrono, md-5, serde) + 原生 HTML/CSS/JS

---

## 文件结构

| 文件 | 职责 |
|------|------|
| `src/main.rs` | 数据结构（AppConfig/GameConfig/SlotConfig/BackupInfo）+ 15 个 Tauri 命令 |
| `src/index.html` | 顶部栏 + 左侧 Tab + 设置弹窗 + 双层标签 + 备份操作区 |
| `src/styles.css` | 所有样式，按组件分区 |
| `src/main.js` | 状态管理 + 标签切换 + CRUD + 哈希 + 置顶 + 拖拽 + 防重复 |

---

## 阶段一：Rust 后端

### Task 1: 更新数据结构

**Files:**
- Modify: `src/main.rs`

- [ ] **Step 1: 替换数据结构**

在 `src/main.rs` 找到现有 `AppConfig` / `BackupInfo` 定义（约第 40-70 行），整个替换：

```rust
// ==================== 配置 ====================

#[derive(Debug, Serialize, Deserialize, Clone)]
struct SlotConfig {
    name: String,
    #[serde(default = "default_next_backup_number")]
    next_backup_number: u32,
    #[serde(default)]
    key_file_patterns: Vec<String>,
}

fn default_next_backup_number() -> u32 { 1 }

#[derive(Debug, Serialize, Deserialize, Clone)]
struct GameConfig {
    name: String,
    #[serde(default = "default_slots")]
    slots: Vec<SlotConfig>,
    #[serde(default)]
    pinned: bool,
    #[serde(default)]
    sort_order: u32,
}

fn default_slots() -> Vec<SlotConfig> {
    vec![SlotConfig {
        name: "存档1".to_string(),
        next_backup_number: 1,
        key_file_patterns: vec![],
    }]
}

#[derive(Debug, Serialize, Deserialize, Clone)]
struct AppConfig {
    #[serde(default)]
    backup_root: String,
    #[serde(default)]
    games: Vec<GameConfig>,
}

impl Default for AppConfig {
    fn default() -> Self {
        AppConfig {
            backup_root: String::new(),
            games: vec![],
        }
    }
}
```

移除旧的 `AppConfig`（含 `game_names`）、旧的 `Default` impl。

- [ ] **Step 2: 更新 BackupInfo**

```rust
// ==================== 备份信息 ====================

#[derive(Debug, Serialize, Deserialize, Clone)]
struct BackupInfo {
    folder_name: String,
    display_name: String,
    description: String,
    created_at: String,
    original_file_path: String,
    content_hash: String,
    pinned: bool,
}
```

- [ ] **Step 3: 编译验证**

```bash
cargo build 2>&1
```

预期：编译失败（旧代码引用 `game_names` 等已删除字段，下一步修复）。

- [ ] **Step 4: Commit**

```bash
git add src/main.rs
git commit -m "feat: replace data structures with GameConfig/SlotConfig"
```

---

### Task 2: 添加 md-5 依赖和 compute_hash 命令

**Files:**
- Modify: `Cargo.toml`
- Modify: `src/main.rs`

- [ ] **Step 1: 添加 md-5 依赖**

在 `Cargo.toml` 的 `[dependencies]` 中添加：
```toml
md-5 = "0.10"
```

- [ ] **Step 2: 在 main.rs 顶部添加 use 声明**

在现有 `use` 块后添加：
```rust
use md5::{Md5, Digest};
```

- [ ] **Step 3: 添加 compute_hash 命令**

在文件末尾 `fn main()` 之前插入：
```rust
#[tauri::command]
fn compute_hash(file_path: String, patterns: Vec<String>) -> Result<String, String> {
    let path = std::path::Path::new(&file_path);
    if !path.exists() {
        return Err(format!("路径不存在: {}", file_path));
    }

    let hash = if path.is_file() {
        compute_file_hash(path)?
    } else {
        compute_dir_hash(path, &patterns)?
    };

    Ok(hash)
}

fn compute_file_hash(path: &std::path::Path) -> Result<String, String> {
    let bytes = std::fs::read(path)
        .map_err(|e| format!("读取文件失败: {}", e))?;
    let mut hasher = Md5::new();
    hasher.update(&bytes);
    Ok(format!("{:x}", hasher.finalize()))
}

fn compute_dir_hash(dir: &std::path::Path, patterns: &[String]) -> Result<String, String> {
    let mut entries: Vec<std::path::PathBuf> = std::fs::read_dir(dir)
        .map_err(|e| format!("读取目录失败: {}", e))?
        .filter_map(|e| e.ok())
        .filter(|e| e.file_type().map(|t| t.is_file()).unwrap_or(false))
        .map(|e| e.path())
        .collect();
    entries.sort();

    // 过滤匹配 patterns 的文件（空 patterns = 全部）
    let filtered: Vec<&std::path::PathBuf> = if patterns.is_empty() {
        entries.iter().collect()
    } else {
        entries.iter().filter(|p| {
            let fname = p.file_name().unwrap_or_default().to_string_lossy();
            patterns.iter().any(|pat| {
                let glob_pattern = glob::Pattern::new(pat).ok();
                glob_pattern.map(|g| g.matches(&fname)).unwrap_or(false)
            })
        }).collect()
    };

    let mut hasher = Md5::new();
    for entry in &filtered {
        let rel = entry.strip_prefix(dir).unwrap_or(entry);
        let rel_str = rel.to_string_lossy().replace('\\', "/");
        let file_hash = compute_file_hash(entry)?;
        hasher.update(format!("{}:{}", rel_str, file_hash).as_bytes());
    }
    Ok(format!("{:x}", hasher.finalize()))
}
```

- [ ] **Step 4: 编译验证**

```bash
cargo build 2>&1
```

预期：可能因 glob 未添加而失败。

- [ ] **Step 5: 改用简单 glob 匹配（不引入额外 crate）**

如果编译报 glob 未找到，替换 patterns 过滤逻辑为简单的通配符匹配：

```rust
// 简单 glob 匹配：支持 * 和 ?
fn simple_glob_match(pattern: &str, name: &str) -> bool {
    let pattern = pattern.to_lowercase();
    let name = name.to_lowercase();
    if !pattern.contains('*') && !pattern.contains('?') {
        return name == pattern;
    }
    let re_str = pattern
        .replace('.', "\\.")
        .replace('*', ".*")
        .replace('?', ".");
    regex::Regex::new(&format!("^{}$", re_str))
        .map(|re| re.is_match(&name))
        .unwrap_or(false)
}
```

如果不需要 regex crate，改用更简单的 `*` 匹配：

```rust
fn simple_glob_match(pattern: &str, name: &str) -> bool {
    let pattern = pattern.to_lowercase();
    let name = name.to_lowercase();
    if let Some(suffix) = pattern.strip_prefix('*') {
        return name.ends_with(suffix);
    }
    if let Some(prefix) = pattern.strip_suffix('*') {
        return name.starts_with(prefix);
    }
    if let Some(rest) = pattern.strip_prefix('*').and_then(|s| s.strip_suffix('*')) {
        return name.contains(rest);
    }
    name == pattern
}
```

- [ ] **Step 6: 编译通过**

```bash
cargo build 2>&1
```

- [ ] **Step 7: Commit**

```bash
git add Cargo.toml src/main.rs
git commit -m "feat: add md-5 dependency and compute_hash command"
```

---

### Task 3: 更新 create_backup（slot 支持 + 哈希 + 新命名）

**Files:**
- Modify: `src/main.rs`（`create_backup` 函数）

- [ ] **Step 1: 重写 create_backup**

找到现有 `create_backup` 函数，替换为：

```rust
#[tauri::command]
fn create_backup(
    app: tauri::AppHandle,
    game_name: String,
    slot_name: String,
    file_path: String,
) -> OpResult {
    let mut config = load_config(&app);

    // 1. 检查备份目录
    if config.backup_root.is_empty() {
        return OpResult {
            success: false,
            message: "请先在设置中配置备份根目录".to_string(),
        };
    }

    // 2. 检查源文件
    let source = std::path::PathBuf::from(&file_path);
    if !source.exists() {
        return OpResult {
            success: false,
            message: format!("文件不存在: {}", file_path),
        };
    }

    // 3. 获取文件名
    let file_name = match source.file_name() {
        Some(name) => name.to_string_lossy().to_string(),
        None => return OpResult { success: false, message: "无法获取文件名".to_string() },
    };

    // 4. 找到对应的 slot，获取序号和 patterns
    let slot = match config.games.iter().find(|g| g.name == game_name) {
        Some(game) => match game.slots.iter().find(|s| s.name == slot_name) {
            Some(s) => s.clone(),
            None => return OpResult { success: false, message: "存档位不存在".to_string() },
        },
        None => return OpResult { success: false, message: "游戏不存在".to_string() },
    };

    let backup_number = slot.next_backup_number;

    // 5. 计算哈希
    let content_hash = match compute_hash(file_path.clone(), slot.key_file_patterns.clone()) {
        Ok(h) => h,
        Err(e) => return OpResult { success: false, message: format!("计算哈希失败: {}", e) },
    };

    // 6. 检查最新备份哈希（去重）
    let existing = list_backups_internal(&config, &game_name, &slot_name);
    if let Some(latest) = existing.first() {
        if latest.content_hash == content_hash {
            return OpResult {
                success: false,
                message: "存档未变化，无需重复备份".to_string(),
            };
        }
    }

    // 7. 生成备份文件夹名
    let now = chrono::Local::now();
    let timestamp_part = now.format("%Y-%m-%d %H-%M-%S").to_string();
    let folder_name = format!("{} {}", timestamp_part, backup_number);
    let display_name = now.format("%Y-%m-%d %H:%M:%S").to_string();
    let display_name_full = format!("{} {}", display_name, backup_number);

    // 8. 创建备份目录
    let backup_dir = std::path::PathBuf::from(&config.backup_root)
        .join(&game_name)
        .join(&slot_name)
        .join(&folder_name);

    if let Err(e) = std::fs::create_dir_all(&backup_dir) {
        return OpResult {
            success: false,
            message: format!("创建备份目录失败: {}", e),
        };
    }

    // 9. 复制文件
    let dest = backup_dir.join(&file_name);
    if let Err(e) = std::fs::copy(&source, &dest) {
        return OpResult {
            success: false,
            message: format!("复制文件失败: {}", e),
        };
    }

    // 10. 写入 meta.json
    let meta = serde_json::json!({
        "original_file_path": file_path,
        "display_name": display_name_full,
        "description": backup_number.to_string(),
        "content_hash": content_hash,
    });
    if let Ok(json) = serde_json::to_string_pretty(&meta) {
        let _ = std::fs::write(backup_dir.join("meta.json"), json);
    }

    // 11. 自增序号并保存
    if let Some(game) = config.games.iter_mut().find(|g| g.name == game_name) {
        if let Some(s) = game.slots.iter_mut().find(|s| s.name == slot_name) {
            s.next_backup_number += 1;
        }
    }
    save_config(&app, &config);

    OpResult {
        success: true,
        message: format!("备份成功: {}", folder_name),
    }
}
```

- [ ] **Step 2: 添加辅助函数 list_backups_internal**

在 `create_backup` 之前添加（复用逻辑不通过 Tauri 命令调用）：

```rust
fn list_backups_internal(config: &AppConfig, game_name: &str, slot_name: &str) -> Vec<BackupInfo> {
    let game_dir = std::path::PathBuf::from(&config.backup_root)
        .join(game_name)
        .join(slot_name);

    if !game_dir.exists() {
        return vec![];
    }

    let mut backups: Vec<BackupInfo> = match std::fs::read_dir(&game_dir) {
        Ok(entries) => entries
            .filter_map(|entry| {
                let entry = entry.ok()?;
                let folder_name = entry.file_name().to_string_lossy().to_string();
                if !entry.file_type().ok()?.is_dir() { return None; }
                read_backup_meta(&entry.path(), &folder_name)
            })
            .collect(),
        Err(_) => vec![],
    };

    // 置顶优先 → 文件夹名倒序
    backups.sort_by(|a, b| {
        b.pinned.cmp(&a.pinned)
            .then_with(|| b.folder_name.cmp(&a.folder_name))
    });
    backups
}

fn read_backup_meta(dir: &std::path::Path, folder_name: &str) -> Option<BackupInfo> {
    let meta_path = dir.join("meta.json");
    let (display_name, original_file_path, content_hash) = if meta_path.exists() {
        std::fs::read_to_string(&meta_path)
            .ok()
            .and_then(|json| serde_json::from_str::<serde_json::Value>(&json).ok())
            .map(|meta| {
                (
                    meta["display_name"].as_str().unwrap_or(folder_name).to_string(),
                    meta["original_file_path"].as_str().unwrap_or("").to_string(),
                    meta["content_hash"].as_str().unwrap_or("").to_string(),
                )
            })
            .unwrap_or_else(|| (folder_name.to_string(), String::new(), String::new()))
    } else {
        (folder_name.to_string(), String::new(), String::new())
    };

    // 从 folder_name 提取描述（时间戳之后的部分）
    let description = folder_name
        .split(' ')
        .skip(2) // YYYY-MM-DD HH-MM-SS description
        .collect::<Vec<_>>()
        .join(" ");

    Some(BackupInfo {
        folder_name: folder_name.to_string(),
        display_name,
        description,
        created_at: String::new(),
        original_file_path,
        content_hash,
        pinned: false, // meta.json 里后续可存
    })
}
```

- [ ] **Step 3: 编译验证**

```bash
cargo build 2>&1
```

- [ ] **Step 4: Commit**

```bash
git add src/main.rs
git commit -m "feat: update create_backup with slot, hash, dedup, auto-numbering"
```

---

### Task 4: 重写 list_backups、delete_backup、rename_backup、restore_backup

**Files:**
- Modify: `src/main.rs`

- [ ] **Step 1: 重写 list_backups**

```rust
#[tauri::command]
fn list_backups(app: tauri::AppHandle, game_name: String, slot_name: String) -> Vec<BackupInfo> {
    let config = load_config(&app);
    list_backups_internal(&config, &game_name, &slot_name)
}
```

- [ ] **Step 2: 重写 delete_backup**

```rust
#[tauri::command]
fn delete_backup(
    app: tauri::AppHandle,
    game_name: String,
    slot_name: String,
    folder_name: String,
) -> OpResult {
    let config = load_config(&app);
    let backup_dir = std::path::PathBuf::from(&config.backup_root)
        .join(&game_name)
        .join(&slot_name)
        .join(&folder_name);

    if !backup_dir.exists() {
        return OpResult { success: false, message: "备份不存在".to_string() };
    }

    match std::fs::remove_dir_all(&backup_dir) {
        Ok(_) => OpResult { success: true, message: "备份已删除".to_string() },
        Err(e) => OpResult { success: false, message: format!("删除失败: {}", e) },
    }
}
```

- [ ] **Step 3: 重写 rename_backup（只改描述部分）**

```rust
#[tauri::command]
fn rename_backup(
    app: tauri::AppHandle,
    game_name: String,
    slot_name: String,
    folder_name: String,
    new_description: String,
) -> OpResult {
    let config = load_config(&app);
    let game_dir = std::path::PathBuf::from(&config.backup_root)
        .join(&game_name)
        .join(&slot_name);

    let old_path = game_dir.join(&folder_name);

    if !old_path.exists() {
        return OpResult { success: false, message: "备份不存在".to_string() };
    }

    // 从 folder_name 分离时间戳和描述
    // 格式: "YYYY-MM-DD HH-MM-SS 描述"
    let parts: Vec<&str> = folder_name.splitn(3, ' ').collect();
    if parts.len() < 2 {
        return OpResult { success: false, message: "备份名格式异常".to_string() };
    }
    let timestamp = format!("{} {}", parts[0], parts[1]);
    let new_folder_name = if new_description.is_empty() {
        timestamp.clone()
    } else {
        format!("{} {}", timestamp, new_description)
    };

    let new_path = game_dir.join(&new_folder_name);
    if new_path.exists() {
        return OpResult { success: false, message: "该名称已存在".to_string() };
    }

    if let Err(e) = std::fs::rename(&old_path, &new_path) {
        return OpResult { success: false, message: format!("重命名失败: {}", e) };
    }

    // 更新 meta.json 中的 display_name 和 description
    let meta_path = new_path.join("meta.json");
    if let Ok(json_str) = std::fs::read_to_string(&meta_path) {
        if let Ok(mut meta) = serde_json::from_str::<serde_json::Value>(&json_str) {
            let new_display = if new_description.is_empty() {
                meta["display_name"].as_str().unwrap_or("").split(' ').take(2).collect::<Vec<_>>().join(" ")
            } else {
                let time_part = meta["display_name"].as_str().unwrap_or("").split(' ')
                    .take(2).collect::<Vec<_>>().join(" ");
                format!("{} {}", time_part, new_description)
            };
            meta["display_name"] = serde_json::Value::String(new_display);
            meta["description"] = serde_json::Value::String(new_description.clone());
            if let Ok(new_json) = serde_json::to_string_pretty(&meta) {
                let _ = std::fs::write(&meta_path, new_json);
            }
        }
    }

    OpResult { success: true, message: "重命名成功".to_string() }
}
```

- [ ] **Step 4: 重写 restore_backup（哈希保护）**

```rust
#[tauri::command]
fn restore_backup(
    app: tauri::AppHandle,
    game_name: String,
    slot_name: String,
    folder_name: String,
    skip_backup: bool,
) -> OpResult {
    let config = load_config(&app);
    let backup_dir = std::path::PathBuf::from(&config.backup_root)
        .join(&game_name)
        .join(&slot_name)
        .join(&folder_name);

    if !backup_dir.exists() {
        return OpResult { success: false, message: "备份不存在".to_string() };
    }

    // 读取 meta.json
    let meta_path = backup_dir.join("meta.json");
    let (original_path, backup_hash) = if meta_path.exists() {
        std::fs::read_to_string(&meta_path)
            .ok()
            .and_then(|json| serde_json::from_str::<serde_json::Value>(&json).ok())
            .map(|meta| {
                (
                    meta["original_file_path"].as_str().unwrap_or("").to_string(),
                    meta["content_hash"].as_str().unwrap_or("").to_string(),
                )
            })
            .unwrap_or_default()
    } else {
        (String::new(), String::new())
    };

    if original_path.is_empty() {
        return OpResult { success: false, message: "无法获取原始文件路径".to_string() };
    }

    // 找到备份文件
    let backup_file = match std::fs::read_dir(&backup_dir) {
        Ok(entries) => entries
            .filter_map(|e| e.ok())
            .filter(|e| e.file_type().map(|t| t.is_file()).unwrap_or(false))
            .filter(|e| e.file_name() != "meta.json")
            .map(|e| e.path())
            .next(),
        Err(_) => None,
    };

    let backup_file = match backup_file {
        Some(f) => f,
        None => return OpResult { success: false, message: "备份文件夹中无文件".to_string() },
    };

    // 检查当前文件是否已有备份
    let original = std::path::Path::new(&original_path);
    if !skip_backup && original.exists() {
        // 获取当前 slot 的 patterns
        let patterns: Vec<String> = config.games.iter()
            .find(|g| g.name == game_name)
            .and_then(|g| g.slots.iter().find(|s| s.name == slot_name))
            .map(|s| s.key_file_patterns.clone())
            .unwrap_or_default();

        let current_hash = compute_hash(original_path.clone(), patterns).unwrap_or_default();
        let hash_match = list_backups_internal(&config, &game_name, &slot_name)
            .iter()
            .any(|b| b.content_hash == current_hash);

        if !hash_match {
            return OpResult {
                success: false,
                message: format!("NEED_BACKUP_CONFIRM:{}", original_path),
            };
        }
    }

    // 复制恢复
    match std::fs::copy(&backup_file, &original_path) {
        Ok(_) => OpResult {
            success: true,
            message: format!("已恢复到: {}", original_path),
        },
        Err(e) => OpResult {
            success: false,
            message: format!("恢复失败: {}", e),
        },
    }
}
```

- [ ] **Step 5: 编译验证**

```bash
cargo build 2>&1
```

- [ ] **Step 6: Commit**

```bash
git add src/main.rs
git commit -m "feat: rewrite backup CRUD commands with slot support and hash protection"
```

---

### Task 5: 添加切换置顶、置顶排序、游戏排序命令

**Files:**
- Modify: `src/main.rs`

- [ ] **Step 1: 添加 toggle_backup_pin**

```rust
#[tauri::command]
fn toggle_backup_pin(
    app: tauri::AppHandle,
    game_name: String,
    slot_name: String,
    folder_name: String,
) -> OpResult {
    let config = load_config(&app);
    let backup_dir = std::path::PathBuf::from(&config.backup_root)
        .join(&game_name)
        .join(&slot_name)
        .join(&folder_name);

    if !backup_dir.exists() {
        return OpResult { success: false, message: "备份不存在".to_string() };
    }

    let meta_path = backup_dir.join("meta.json");
    let current_pinned = std::fs::read_to_string(&meta_path)
        .ok()
        .and_then(|json| serde_json::from_str::<serde_json::Value>(&json).ok())
        .and_then(|meta| meta["pinned"].as_bool())
        .unwrap_or(false);

    let new_pinned = !current_pinned;
    if let Ok(json_str) = std::fs::read_to_string(&meta_path) {
        if let Ok(mut meta) = serde_json::from_str::<serde_json::Value>(&json_str) {
            meta["pinned"] = serde_json::Value::Bool(new_pinned);
            if let Ok(new_json) = serde_json::to_string_pretty(&meta) {
                let _ = std::fs::write(&meta_path, new_json);
            }
        }
    }

    OpResult {
        success: true,
        message: if new_pinned { "已置顶".to_string() } else { "已取消置顶".to_string() },
    }
}
```

- [ ] **Step 2: 更新 read_backup_meta 读取 pinned**

找到 `read_backup_meta` 函数中解析 meta 的部分，增加 `pinned` 读取：

```rust
// 在 read_backup_meta 的 map 闭包中，添加 pinned 提取
let pinned = meta["pinned"].as_bool().unwrap_or(false);
// ... 在 BackupInfo 构造中 ... pinned,
```

- [ ] **Step 3: 添加 toggle_game_pin 和 reorder_games**

```rust
#[tauri::command]
fn toggle_game_pin(app: tauri::AppHandle, game_name: String) -> OpResult {
    let mut config = load_config(&app);
    if let Some(game) = config.games.iter_mut().find(|g| g.name == game_name) {
        game.pinned = !game.pinned;
    }
    save_config(&app, &config);
    OpResult { success: true, message: "已更新".to_string() }
}

#[tauri::command]
fn reorder_games(app: tauri::AppHandle, game_names: Vec<String>) -> OpResult {
    let mut config = load_config(&app);
    for (i, name) in game_names.iter().enumerate() {
        if let Some(game) = config.games.iter_mut().find(|g| &g.name == name) {
            game.sort_order = i as u32;
        }
    }
    save_config(&app, &config);
    OpResult { success: true, message: "排序已保存".to_string() }
}
```

- [ ] **Step 4: 更新 main() 注册所有命令**

找到 `fn main()` 中的 `generate_handler!`，更新为完整列表：

```rust
fn main() {
    tauri::Builder::default()
        .invoke_handler(tauri::generate_handler![
            convert_to_timestamp,
            convert_to_datetime,
            get_config,
            set_config,
            pick_file,
            pick_directory,
            create_backup,
            list_backups,
            delete_backup,
            rename_backup,
            restore_backup,
            compute_hash,
            toggle_backup_pin,
            toggle_game_pin,
            reorder_games,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
```

- [ ] **Step 5: 编译验证**

```bash
cargo build 2>&1
```

预期：PASS

- [ ] **Step 6: Commit**

```bash
git add src/main.rs
git commit -m "feat: add toggle_backup_pin, toggle_game_pin, reorder_games commands"
```

---

## 阶段二：HTML 布局

### Task 6: 重写 HTML 布局

**Files:**
- Modify: `src/index.html`

- [ ] **Step 1: 完整替换 HTML**

用以下内容替换 `src/index.html`：

```html
<!DOCTYPE html>
<html lang="zh-CN">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>HRB Tools</title>
    <link rel="stylesheet" href="styles.css">
</head>
<body>
<div class="container">

    <!-- 顶部栏 -->
    <div class="top-bar">
        <span class="top-bar-title">HRB Tools</span>
        <button class="settings-btn" id="settingsBtn" title="设置">&#9881;</button>
    </div>

    <div class="body-area">

        <!-- 左侧 Tab 栏 -->
        <div class="tab-bar">
            <button class="tab active" data-tab="convert">
                <span class="tab-icon">&#9202;</span>
                <span class="tab-label">时间转换</span>
            </button>
            <button class="tab" data-tab="backup">
                <span class="tab-icon">&#128190;</span>
                <span class="tab-label">存档管理</span>
            </button>
        </div>

        <!-- 右侧内容区 -->
        <div class="content">

        <!-- 时间转换面板 -->
        <div class="panel active" id="panel-convert">
            <h1>时间转换工具</h1>
            <div class="input-group">
                <label>时区</label>
                <select id="timezoneSelect">
                    <option value="UTC">UTC</option>
                    <option value="Asia/Shanghai" selected>Asia/Shanghai</option>
                    <option value="America/New_York">America/New_York</option>
                    <option value="Europe/London">Europe/London</option>
                    <option value="Asia/Tokyo">Asia/Tokyo</option>
                    <option value="Australia/Sydney">Australia/Sydney</option>
                </select>
            </div>
            <div class="convert-section">
                <div class="section-row">
                    <label>时间字符串 &rarr; Unix时间戳（毫秒）</label>
                    <button id="resetTimeBtn" class="btn-tiny">重置为当前时间</button>
                </div>
                <input type="text" id="datetimeInput" placeholder="例如: 2026-05-07 15:30:00">
                <button id="convertBtn">转换</button>
                <div class="result" id="timestampResult">&mdash;</div>
                <div id="errorMsg" class="error"></div>
            </div>
            <div class="convert-section">
                <label>Unix时间戳（毫秒） &rarr; 时间字符串</label>
                <input type="text" id="timestampInput" placeholder="例如: 1746466200000">
                <button id="convertBackBtn">转换</button>
                <div class="result" id="datetimeResult">&mdash;</div>
                <div id="errorMsg2" class="error"></div>
            </div>
        </div>

        <!-- 存档管理面板 -->
        <div class="panel" id="panel-backup">
            <h1>游戏存档备份</h1>

            <!-- 第一层：游戏标签 -->
            <div class="game-tabs" id="gameTabs">
                <!-- 动态生成 .game-tab + .game-tab-add -->
            </div>

            <!-- 第二层：存档位标签 -->
            <div class="slot-tabs" id="slotTabs">
                <!-- 动态生成 .slot-tag + .slot-tag-add -->
            </div>

            <!-- 存档文件 -->
            <div class="input-group">
                <label>存档文件</label>
                <div class="row">
                    <input type="text" id="filePath" placeholder="输入路径或点击浏览...">
                    <button id="browseFileBtn" class="btn-small">浏览</button>
                </div>
            </div>

            <button id="saveBackupBtn">保存存档</button>

            <div id="backupError" class="error"></div>
            <div id="backupSuccess" class="success"></div>

            <!-- 备份列表 -->
            <div class="backup-list-section">
                <h3 id="backupListTitle">备份记录</h3>
                <div id="backupList" class="backup-list">
                    <div class="empty-hint">请先选择游戏和存档位</div>
                </div>
            </div>
        </div>

        </div>
    </div>

    <!-- 设置弹窗 -->
    <div class="modal-overlay" id="settingsOverlay" style="display:none">
        <div class="modal" id="settingsModal">
            <div class="modal-header">
                <span class="modal-title">&#9881; 设置</span>
                <button class="modal-close" id="settingsCloseBtn">&times;</button>
            </div>
            <div class="modal-body">
                <div class="input-group">
                    <label>备份根目录</label>
                    <div class="row">
                        <span id="settingsBackupRoot" class="path-hint">未设置</span>
                        <button id="settingsSetDirBtn" class="btn-small">更改</button>
                    </div>
                </div>
                <div class="settings-hint">更多设置项将陆续添加</div>
            </div>
        </div>
    </div>

</div>

<script src="main.js"></script>
</body>
</html>
```

- [ ] **Step 2: Commit**

```bash
git add src/index.html
git commit -m "feat: redesign HTML with top bar, game tabs, slot tabs, settings modal"
```

---

## 阶段三：CSS 样式

### Task 7: 重写 CSS

**Files:**
- Write: `src/styles.css`（完整重写）

- [ ] **Step 1: 完整替换 CSS**

```css
/* ==================== 基础重置 ==================== */
* {
    box-sizing: border-box;
    font-family: system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif;
}

body {
    background: #1a1e2e;
    display: flex;
    justify-content: center;
    align-items: center;
    min-height: 100vh;
    margin: 0;
    padding: 20px;
}

.container {
    display: flex;
    flex-direction: column;
    background: #212539;
    border-radius: 16px;
    border: 1px solid rgba(255,255,255,0.06);
    box-shadow: 0 8px 40px rgba(0,0,0,0.4);
    width: 100%;
    max-width: 720px;
    min-height: 480px;
    overflow: hidden;
}

/* ==================== 顶部栏 ==================== */
.top-bar {
    display: flex;
    justify-content: space-between;
    align-items: center;
    padding: 8px 16px;
    border-bottom: 1px solid rgba(255,255,255,0.06);
    background: rgba(0,0,0,0.15);
    flex-shrink: 0;
}

.top-bar-title {
    font-size: 0.8rem;
    color: rgba(255,255,255,0.35);
    font-weight: 500;
}

.settings-btn {
    width: auto;
    margin: 0;
    padding: 4px 8px;
    font-size: 1.2rem;
    background: transparent;
    color: rgba(255,255,255,0.4);
    border: none;
    cursor: pointer;
    border-radius: 6px;
    line-height: 1;
}

.settings-btn:hover {
    background: rgba(255,255,255,0.08);
    color: rgba(255,255,255,0.7);
}

/* ==================== 主体区域 ==================== */
.body-area {
    display: flex;
    flex: 1;
    min-height: 0;
}

/* ==================== 左侧 Tab 栏 ==================== */
.tab-bar {
    display: flex;
    flex-direction: column;
    gap: 6px;
    padding: 16px 10px;
    background: rgba(0,0,0,0.25);
    border-right: 1px solid rgba(255,255,255,0.05);
    width: 72px;
    flex-shrink: 0;
}

.tab {
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: 4px;
    padding: 12px 6px;
    background: transparent;
    border: none;
    border-radius: 10px;
    cursor: pointer;
    color: rgba(255,255,255,0.45);
    transition: background 0.2s, color 0.2s;
    width: 100%;
}

.tab:hover {
    background: rgba(255,255,255,0.05);
    color: rgba(255,255,255,0.7);
}

.tab.active {
    background: rgba(255,255,255,0.08);
    color: #fff;
}

.tab-icon { font-size: 1.3rem; line-height: 1; }
.tab-label { font-size: 0.7rem; font-weight: 500; white-space: nowrap; }

/* ==================== 右侧内容区 ==================== */
.content {
    flex: 1;
    padding: 20px 24px;
    overflow-y: auto;
    min-width: 0;
}

/* ==================== 面板 ==================== */
.panel { display: none; }
.panel.active { display: block; }

/* ==================== 共用组件 ==================== */
h1 {
    font-size: 1.15rem;
    margin-top: 0;
    margin-bottom: 1rem;
    color: rgba(255,255,255,0.9);
    font-weight: 600;
}

h3 {
    font-size: 0.9rem;
    color: rgba(255,255,255,0.7);
    margin-bottom: 0.5rem;
}

.input-group { margin-bottom: 0.9rem; }

label {
    display: block;
    font-weight: 500;
    margin-bottom: 0.35rem;
    color: rgba(255,255,255,0.6);
    font-size: 0.85rem;
}

input, select {
    width: 100%;
    padding: 0.55rem 0.7rem;
    border: 1px solid rgba(255,255,255,0.1);
    border-radius: 8px;
    font-size: 0.9rem;
    background: rgba(255,255,255,0.05);
    color: rgba(255,255,255,0.85);
    transition: border-color 0.2s, box-shadow 0.2s;
}

input:focus, select:focus {
    outline: none;
    border-color: rgba(100,150,255,0.5);
    box-shadow: 0 0 0 3px rgba(100,150,255,0.15);
}

select { cursor: pointer; }
select option { background: #212539; color: #fff; }

button {
    background: #4b8bf4;
    color: white;
    border: none;
    width: 100%;
    padding: 0.6rem;
    font-size: 0.95rem;
    font-weight: 600;
    border-radius: 8px;
    cursor: pointer;
    transition: background 0.2s, transform 0.1s, opacity 0.2s;
    margin-top: 0.3rem;
}

button:hover { background: #5c9af7; }
button:active { transform: scale(0.98); }

button:disabled {
    opacity: 0.5;
    cursor: not-allowed;
    transform: none;
}

button:disabled:hover { background: #4b8bf4; }

.row {
    display: flex;
    gap: 0.5rem;
    align-items: center;
}

.row input, .row select { flex: 1; }

.btn-small {
    width: auto;
    padding: 0.45rem 0.8rem;
    font-size: 0.8rem;
    flex-shrink: 0;
    margin-top: 0;
    border-radius: 6px;
}

.btn-danger {
    background: rgba(239,68,68,0.15);
    color: #f87171;
    border: 1px solid rgba(239,68,68,0.2);
    width: auto;
    padding: 0.25rem 0.6rem;
    font-size: 0.75rem;
    margin-top: 0;
    border-radius: 4px;
    margin-left: 2px;
}

.btn-danger:hover {
    background: rgba(239,68,68,0.25);
    color: #fca5a5;
}

.btn-danger:disabled {
    opacity: 0.35;
    cursor: not-allowed;
}

.btn-pin {
    width: auto;
    padding: 0.2rem 0.35rem;
    font-size: 0.75rem;
    margin-top: 0;
    margin-left: 2px;
    border-radius: 4px;
    background: transparent;
    color: rgba(255,255,255,0.3);
    border: 1px solid transparent;
}

.btn-pin:hover { color: #fbbf24; background: rgba(251,191,36,0.1); }
.btn-pin.pinned { color: #fbbf24; }

.btn-pin:disabled {
    opacity: 0.35;
    cursor: not-allowed;
}

.btn-tiny {
    width: auto;
    padding: 0.25rem 0.6rem;
    font-size: 0.75rem;
    font-weight: 500;
    margin-top: 0;
    border-radius: 6px;
    background: rgba(255,255,255,0.08);
    color: rgba(255,255,255,0.6);
}

.btn-tiny:hover {
    background: rgba(255,255,255,0.15);
    color: rgba(255,255,255,0.9);
}

/* ==================== 游戏标签栏 ==================== */
.game-tabs {
    display: flex;
    gap: 0;
    overflow-x: auto;
    border-bottom: 1px solid rgba(255,255,255,0.06);
    padding-bottom: 0;
    margin-bottom: 10px;
    scrollbar-width: thin;
    scrollbar-color: rgba(255,255,255,0.1) transparent;
}

.game-tab {
    display: flex;
    align-items: center;
    gap: 6px;
    padding: 7px 12px;
    border-bottom: 2px solid transparent;
    color: rgba(255,255,255,0.4);
    font-size: 0.82rem;
    white-space: nowrap;
    flex-shrink: 0;
    cursor: pointer;
    background: transparent;
    border-top: none;
    border-left: none;
    border-right: none;
    border-radius: 0;
    width: auto;
    margin: 0;
    transition: color 0.15s, border-color 0.15s;
}

.game-tab:hover { color: rgba(255,255,255,0.7); }
.game-tab.dragging { opacity: 0.5; }

.game-tab.active {
    color: #fff;
    border-bottom-color: #4b8bf4;
}

.game-tab .tab-close {
    font-size: 1rem;
    opacity: 0;
    line-height: 1;
    transition: opacity 0.15s;
    color: rgba(255,255,255,0.4);
}

.game-tab:hover .tab-close { opacity: 1; }
.game-tab .tab-close:hover { color: #f87171; }

.game-tab-add {
    padding: 7px 10px;
    color: rgba(255,255,255,0.2);
    font-size: 1.1rem;
    white-space: nowrap;
    flex-shrink: 0;
    cursor: pointer;
    background: transparent;
    border: none;
    width: auto;
    margin: 0;
    border-radius: 0;
    border-bottom: 2px solid transparent;
    line-height: 1;
}

.game-tab-add:hover { color: rgba(255,255,255,0.5); }

/* 游戏标签拖拽排序 */
.game-tab[draggable="true"] { cursor: grab; }
.game-tab[draggable="true"]:active { cursor: grabbing; }

/* 游戏标签内联编辑 input */
.game-tab input {
    background: rgba(255,255,255,0.08);
    border: 1px solid rgba(255,255,255,0.15);
    color: #fff;
    padding: 2px 6px;
    border-radius: 4px;
    font-size: 0.82rem;
    width: 100px;
}

/* ==================== 存档位标签栏 ==================== */
.slot-tabs {
    display: flex;
    gap: 4px;
    align-items: center;
    margin-bottom: 12px;
    flex-wrap: wrap;
}

.slot-tabs-label {
    font-size: 0.7rem;
    color: rgba(255,255,255,0.3);
    margin-right: 4px;
    flex-shrink: 0;
}

.slot-tag {
    display: flex;
    align-items: center;
    gap: 4px;
    padding: 4px 10px;
    background: rgba(255,255,255,0.04);
    border: 1px solid rgba(255,255,255,0.06);
    border-radius: 15px;
    color: rgba(255,255,255,0.5);
    font-size: 0.78rem;
    white-space: nowrap;
    flex-shrink: 0;
    cursor: pointer;
    transition: background 0.15s, border-color 0.15s, color 0.15s;
    width: auto;
    margin: 0;
}

.slot-tag:hover { color: rgba(255,255,255,0.8); }

.slot-tag.active {
    background: rgba(75,139,244,0.2);
    border-color: rgba(75,139,244,0.35);
    color: #fff;
}

.slot-tag .tag-close {
    font-size: 0.85rem;
    opacity: 0;
    line-height: 1;
    transition: opacity 0.15s;
    color: rgba(255,255,255,0.3);
}

.slot-tag:hover .tag-close { opacity: 1; }
.slot-tag .tag-close:hover { color: #f87171; }

.slot-tag-add {
    padding: 4px 8px;
    color: rgba(255,255,255,0.2);
    font-size: 1rem;
    white-space: nowrap;
    flex-shrink: 0;
    cursor: pointer;
    background: transparent;
    border: none;
    width: auto;
    margin: 0;
    line-height: 1;
}

.slot-tag-add:hover { color: rgba(255,255,255,0.5); }

/* 存档位内联编辑 input */
.slot-tag input {
    background: transparent;
    border: none;
    border-bottom: 1px solid rgba(255,255,255,0.3);
    color: #fff;
    padding: 1px 4px;
    font-size: 0.78rem;
    width: 60px;
    outline: none;
}

/* ==================== 时间转换面板 ==================== */
.convert-section {
    margin-bottom: 1.2rem;
    padding-bottom: 1rem;
    border-bottom: 1px solid rgba(255,255,255,0.06);
}

.convert-section:last-of-type {
    margin-bottom: 0;
    padding-bottom: 0;
    border-bottom: none;
}

.section-row {
    display: flex;
    justify-content: space-between;
    align-items: center;
    margin-bottom: 0.35rem;
}

.section-row label { margin-bottom: 0; }

.result {
    margin-top: 0.8rem;
    background: rgba(255,255,255,0.04);
    border-radius: 10px;
    padding: 0.7rem 1rem;
    text-align: center;
    border: 1px solid rgba(255,255,255,0.06);
    font-size: 1.3rem;
    font-weight: 700;
    color: rgba(255,255,255,0.9);
    word-break: break-all;
    font-family: monospace;
    min-height: 2.5rem;
    display: flex;
    align-items: center;
    justify-content: center;
}

/* ==================== 消息提示 ==================== */
.error {
    color: #fca5a5;
    background: rgba(220,38,38,0.12);
    border-radius: 8px;
    padding: 0.5rem;
    margin-top: 0.8rem;
    font-size: 0.85rem;
    text-align: center;
    display: none;
}

.success {
    color: #86efac;
    background: rgba(22,163,74,0.12);
    border-radius: 8px;
    padding: 0.5rem;
    margin-top: 0.8rem;
    font-size: 0.85rem;
    text-align: center;
    display: none;
}

/* ==================== 路径提示 ==================== */
.path-hint {
    color: rgba(255,255,255,0.35);
    font-size: 0.8rem;
    padding: 0.5rem;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
}

/* ==================== 存档列表 ==================== */
.backup-list-section { margin-top: 1.2rem; }

.backup-list { max-height: 260px; overflow-y: auto; }

.empty-hint {
    text-align: center;
    color: rgba(255,255,255,0.3);
    padding: 1.5rem;
    font-size: 0.85rem;
}

.backup-item {
    display: flex;
    align-items: center;
    gap: 0.4rem;
    padding: 0.5rem 0.5rem;
    border-bottom: 1px solid rgba(255,255,255,0.04);
    font-size: 0.82rem;
    border-radius: 4px;
}

.backup-item:hover { background: rgba(255,255,255,0.03); }

/* 哈希相同标记 */
.backup-item.hash-match {
    border-left: 3px solid #34d399;
    background: rgba(52,211,153,0.06);
}

.backup-item.hash-duplicate {
    border-left: 3px solid #fbbf24;
    background: rgba(251,191,36,0.06);
}

.backup-item .name {
    flex: 1;
    color: rgba(255,255,255,0.8);
    font-size: 0.82rem;
}

.backup-item .hash-badge {
    font-size: 0.65rem;
    padding: 1px 5px;
    border-radius: 8px;
    flex-shrink: 0;
}

.hash-badge.match {
    background: rgba(52,211,153,0.2);
    color: #34d399;
}

.hash-badge.duplicate {
    background: rgba(251,191,36,0.2);
    color: #fbbf24;
}

.backup-item .original-path {
    font-size: 0.7rem;
    color: rgba(255,255,255,0.3);
    max-width: 80px;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
}

/* ==================== 模态弹窗 ==================== */
.modal-overlay {
    position: absolute;
    inset: 0;
    background: rgba(0,0,0,0.6);
    display: flex;
    align-items: flex-start;
    justify-content: center;
    padding-top: 80px;
    z-index: 10;
}

.modal {
    background: #212539;
    border: 1px solid rgba(255,255,255,0.1);
    border-radius: 12px;
    width: 380px;
    box-shadow: 0 12px 40px rgba(0,0,0,0.5);
    overflow: hidden;
}

.modal-header {
    display: flex;
    justify-content: space-between;
    align-items: center;
    padding: 12px 16px;
    border-bottom: 1px solid rgba(255,255,255,0.06);
}

.modal-title {
    font-weight: 600;
    font-size: 0.9rem;
    color: #fff;
}

.modal-close {
    font-size: 1.2rem;
    color: rgba(255,255,255,0.4);
    background: transparent;
    border: none;
    cursor: pointer;
    padding: 0;
    margin: 0;
    width: auto;
    line-height: 1;
}

.modal-close:hover { color: rgba(255,255,255,0.8); }

.modal-body { padding: 16px; }

.settings-hint {
    font-size: 0.7rem;
    color: rgba(255,255,255,0.15);
    text-align: center;
    padding: 8px 0;
}
```

- [ ] **Step 2: Commit**

```bash
git add src/styles.css
git commit -m "feat: rewrite CSS for game tabs, slot tags, modal, pin, hash styling"
```

---

## 阶段四：JavaScript 逻辑

### Task 8: 重写 JS — 状态管理与 Tab 切换

**Files:**
- Write: `src/main.js`（完整重写）

- [ ] **Step 1: 写入 JS 基础结构**

```js
// 直接使用 Tauri 内部 IPC
const invoke = (cmd, args) => window.__TAURI_INTERNALS__.invoke(cmd, args);

// ==================== 状态 ====================
let currentConfig = { backup_root: '', games: [] };
let selectedGame = '';
let selectedSlot = '';
let filePathBySlot = {};       // { "游戏1:存档1": "D:/saves/file.dat" }
let currentHashBySlot = {};    // { "游戏1:存档1": "abc123" }

// ==================== DOM 引用 ====================

// 全局 Tab
const tabs = document.querySelectorAll('.tab');
const panels = document.querySelectorAll('.panel');

// 时间转换
const datetimeInput = document.getElementById('datetimeInput');
const timestampInput = document.getElementById('timestampInput');
const timezoneSelect = document.getElementById('timezoneSelect');
const convertBtn = document.getElementById('convertBtn');
const convertBackBtn = document.getElementById('convertBackBtn');
const resetTimeBtn = document.getElementById('resetTimeBtn');
const timestampResult = document.getElementById('timestampResult');
const datetimeResult = document.getElementById('datetimeResult');
const errorMsgDiv = document.getElementById('errorMsg');
const errorMsg2Div = document.getElementById('errorMsg2');

// 存档管理
const gameTabs = document.getElementById('gameTabs');
const slotTabs = document.getElementById('slotTabs');
const filePathInput = document.getElementById('filePath');
const browseFileBtn = document.getElementById('browseFileBtn');
const saveBackupBtn = document.getElementById('saveBackupBtn');
const backupError = document.getElementById('backupError');
const backupSuccess = document.getElementById('backupSuccess');
const backupList = document.getElementById('backupList');
const backupListTitle = document.getElementById('backupListTitle');

// 设置
const settingsBtn = document.getElementById('settingsBtn');
const settingsOverlay = document.getElementById('settingsOverlay');
const settingsCloseBtn = document.getElementById('settingsCloseBtn');
const settingsBackupRoot = document.getElementById('settingsBackupRoot');
const settingsSetDirBtn = document.getElementById('settingsSetDirBtn');

// ==================== 全局 Tab 切换 ====================
tabs.forEach(tab => {
    tab.addEventListener('click', () => {
        tabs.forEach(t => t.classList.remove('active'));
        panels.forEach(p => p.classList.remove('active'));
        tab.classList.add('active');
        document.getElementById('panel-' + tab.dataset.tab).classList.add('active');
        if (tab.dataset.tab === 'backup') refreshAll();
    });
});

// ==================== 时间转换 ====================

function getCurrentDatetimeStr() {
    const now = new Date();
    const pad = n => String(n).padStart(2, '0');
    return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())} ${pad(now.getHours())}:${pad(now.getMinutes())}:${pad(now.getSeconds())}`;
}

function getCurrentTimestampMs() { return Date.now().toString(); }

function resetToCurrentTime() {
    datetimeInput.value = getCurrentDatetimeStr();
    timestampInput.value = getCurrentTimestampMs();
}

async function convert() {
    errorMsgDiv.style.display = 'none';
    timestampResult.innerText = '转换中...';
    const datetimeStr = datetimeInput.value.trim();
    const timezone = timezoneSelect.value;
    if (!datetimeStr) { showConvertError(errorMsgDiv, '请输入时间字符串'); return; }
    try {
        const response = await invoke('convert_to_timestamp', { request: { datetime_str: datetimeStr, timezone: timezone } });
        if (response.success) { timestampResult.innerText = response.timestamp; }
        else { showConvertError(errorMsgDiv, response.error); timestampResult.innerText = '—'; }
    } catch (err) { showConvertError(errorMsgDiv, `调用失败: ${err}`); timestampResult.innerText = '—'; }
}

async function convertBack() {
    errorMsg2Div.style.display = 'none';
    datetimeResult.innerText = '转换中...';
    const tsStr = timestampInput.value.trim();
    const timezone = timezoneSelect.value;
    if (!tsStr) { showConvertError(errorMsg2Div, '请输入时间戳'); return; }
    const timestampMs = parseInt(tsStr, 10);
    if (isNaN(timestampMs)) { showConvertError(errorMsg2Div, '时间戳必须是整数'); return; }
    try {
        const response = await invoke('convert_to_datetime', { request: { timestamp_ms: timestampMs, timezone: timezone } });
        if (response.success) { datetimeResult.innerText = response.datetime_str; }
        else { showConvertError(errorMsg2Div, response.error); datetimeResult.innerText = '—'; }
    } catch (err) { showConvertError(errorMsg2Div, `调用失败: ${err}`); datetimeResult.innerText = '—'; }
}

function showConvertError(el, msg) { el.innerText = msg; el.style.display = 'block'; }

convertBtn.addEventListener('click', convert);
datetimeInput.addEventListener('keypress', (e) => { if (e.key === 'Enter') convert(); });
convertBackBtn.addEventListener('click', convertBack);
timestampInput.addEventListener('keypress', (e) => { if (e.key === 'Enter') convertBack(); });
resetTimeBtn.addEventListener('click', resetToCurrentTime);
```

- [ ] **Step 2: Commit**

```bash
git add src/main.js
git commit -m "feat: JS state management and tab switching foundation"
```

---

### Task 9: 实现游戏/存档位标签渲染与 CRUD

**Files:**
- Modify: `src/main.js`

- [ ] **Step 1: 添加游戏标签渲染**

```js
// ==================== 游戏标签渲染 ====================

function renderGameTabs() {
    const games = getSortedGames();
    gameTabs.innerHTML = games.map(g => {
        const activeClass = g.name === selectedGame ? ' active' : '';
        return `<button class="game-tab${activeClass}" data-game="${escapeHtml(g.name)}" draggable="true"
                  title="拖拽排序 | 双击改名${g.pinned ? ' | 已置顶' : ''}">
                  ${g.pinned ? '&#128204;' : ''} ${escapeHtml(g.name)}
                  <span class="tab-close" data-action="delete-game" data-game="${escapeHtml(g.name)}">&times;</span>
                </button>`;
    }).join('') + `<button class="game-tab-add" id="addGameBtn" title="新增游戏">+</button>`;

    bindGameTabEvents();
}

function getSortedGames() {
    return [...currentConfig.games].sort((a, b) => {
        if (a.pinned !== b.pinned) return b.pinned - a.pinned;
        if (a.sort_order !== b.sort_order) return a.sort_order - b.sort_order;
        return a.name.localeCompare(b.name);
    });
}

function bindGameTabEvents() {
    document.querySelectorAll('.game-tab').forEach(tab => {
        tab.addEventListener('click', (e) => {
            if (e.target.dataset.action === 'delete-game') return;
            const name = tab.dataset.game;
            if (name !== selectedGame) {
                selectedGame = name;
                selectedSlot = '';
                // 自动选第一个存档位
                const game = currentConfig.games.find(g => g.name === name);
                if (game && game.slots.length > 0) {
                    selectedSlot = game.slots[0].name;
                    restoreFilePath();
                }
                renderGameTabs();
                renderSlotTabs();
                refreshBackupList();
            }
        });

        tab.addEventListener('dblclick', (e) => {
            if (e.target.dataset.action === 'delete-game') return;
            startInlineEditGame(tab);
        });

        // 拖拽
        tab.addEventListener('dragstart', (e) => {
            e.dataTransfer.setData('text/plain', tab.dataset.game);
            tab.classList.add('dragging');
        });
        tab.addEventListener('dragend', () => tab.classList.remove('dragging'));
    });

    // 拖拽目标
    document.querySelectorAll('.game-tab').forEach(tab => {
        tab.addEventListener('dragover', (e) => { e.preventDefault(); });
        tab.addEventListener('drop', async (e) => {
            e.preventDefault();
            const fromName = e.dataTransfer.getData('text/plain');
            const toName = tab.dataset.game;
            if (fromName === toName) return;
            await handleGameReorder(fromName, toName);
        });
    });

    // 关闭按钮
    document.querySelectorAll('.tab-close[data-action="delete-game"]').forEach(btn => {
        btn.addEventListener('click', async (e) => {
            e.stopPropagation();
            const name = btn.dataset.game;
            if (!confirm(`确定删除游戏「${name}」及其所有存档位吗？`)) return;
            currentConfig.games = currentConfig.games.filter(g => g.name !== name);
            if (selectedGame === name) { selectedGame = ''; selectedSlot = ''; }
            await saveConfigToBackend();
            renderGameTabs();
            renderSlotTabs();
            refreshBackupList();
        });
    });

    // + 新增按钮
    const addBtn = document.getElementById('addGameBtn');
    if (addBtn) {
        addBtn.addEventListener('click', async () => {
            const n = currentConfig.games.length + 1;
            const name = `游戏${n}`;
            currentConfig.games.push({ name, slots: [{ name: '存档1', next_backup_number: 1, key_file_patterns: [] }], pinned: false, sort_order: currentConfig.games.length });
            await saveConfigToBackend();
            selectedGame = name;
            selectedSlot = '存档1';
            renderGameTabs();
            renderSlotTabs();
            refreshBackupList();
            // 自动进入编辑模式
            setTimeout(() => {
                const newTab = document.querySelector(`.game-tab[data-game="${escapeHtml(name)}"]`);
                if (newTab) startInlineEditGame(newTab);
            }, 50);
        });
    }
}

function startInlineEditGame(tab) {
    const name = tab.dataset.game;
    const input = document.createElement('input');
    input.value = name;
    input.addEventListener('keydown', async (e) => {
        if (e.key === 'Enter') {
            const newName = input.value.trim();
            if (newName && newName !== name) {
                await renameGame(name, newName);
            }
        } else if (e.key === 'Escape') {
            renderGameTabs();
            if (selectedGame) renderSlotTabs();
        }
    });
    input.addEventListener('blur', async () => {
        const newName = input.value.trim();
        if (newName && newName !== name) {
            await renameGame(name, newName);
        } else {
            renderGameTabs();
            if (selectedGame) renderSlotTabs();
        }
    });
    tab.replaceChild(input, tab.firstChild);
    input.focus();
    input.select();
}

async function renameGame(oldName, newName) {
    if (currentConfig.games.some(g => g.name === newName)) {
        alert('该游戏名已存在');
        renderGameTabs(); renderSlotTabs();
        return;
    }
    const game = currentConfig.games.find(g => g.name === oldName);
    if (game) game.name = newName;
    if (selectedGame === oldName) selectedGame = newName;
    // 更新 filePathBySlot / currentHashBySlot 的 key
    updateSlotKey(oldName, newName);
    await saveConfigToBackend();
    renderGameTabs();
    renderSlotTabs();
    refreshBackupList();
}

async function handleGameReorder(fromName, toName) {
    const sorted = getSortedGames();
    const fromIdx = sorted.findIndex(g => g.name === fromName);
    const toIdx = sorted.findIndex(g => g.name === toName);
    sorted.splice(toIdx, 0, sorted.splice(fromIdx, 1)[0]);
    const names = sorted.map(g => g.name);
    await invoke('reorder_games', { gameNames: names });
    // 将新 sort_order 写回 currentConfig
    names.forEach((n, i) => {
        const g = currentConfig.games.find(g => g.name === n);
        if (g) g.sort_order = i;
    });
    renderGameTabs();
}

function updateSlotKey(oldGameName, newGameName) {
    const newFilePath = {};
    const newHash = {};
    for (const [key, val] of Object.entries(filePathBySlot)) {
        if (key.startsWith(oldGameName + ':')) {
            newFilePath[newGameName + ':' + key.slice(oldGameName.length + 1)] = val;
        } else {
            newFilePath[key] = val;
        }
    }
    for (const [key, val] of Object.entries(currentHashBySlot)) {
        if (key.startsWith(oldGameName + ':')) {
            newHash[newGameName + ':' + key.slice(oldGameName.length + 1)] = val;
        } else {
            newHash[key] = val;
        }
    }
    filePathBySlot = newFilePath;
    currentHashBySlot = newHash;
}
```

- [ ] **Step 2: 添加存档位标签渲染**

```js
// ==================== 存档位标签渲染 ====================

function renderSlotTabs() {
    if (!selectedGame) {
        slotTabs.innerHTML = '';
        return;
    }
    const game = currentConfig.games.find(g => g.name === selectedGame);
    if (!game || game.slots.length === 0) {
        slotTabs.innerHTML = '<span class="slot-tabs-label">存档位</span>';
        return;
    }

    slotTabs.innerHTML = '<span class="slot-tabs-label">存档位</span>' +
        game.slots.map(s => {
            const activeClass = s.name === selectedSlot ? ' active' : '';
            return `<button class="slot-tag${activeClass}" data-slot="${escapeHtml(s.name)}">
                      ${escapeHtml(s.name)}
                      <span class="tag-close" data-action="delete-slot" data-slot="${escapeHtml(s.name)}">&times;</span>
                    </button>`;
        }).join('') +
        `<button class="slot-tag-add" id="addSlotBtn" title="新增存档位">+</button>`;

    bindSlotTagEvents(game);
}

function bindSlotTagEvents(game) {
    document.querySelectorAll('.slot-tag').forEach(tag => {
        tag.addEventListener('click', (e) => {
            if (e.target.dataset.action === 'delete-slot') return;
            const name = tag.dataset.slot;
            if (name !== selectedSlot) {
                selectedSlot = name;
                restoreFilePath();
                renderSlotTabs();
                refreshBackupList();
            }
        });

        tag.addEventListener('dblclick', (e) => {
            if (e.target.dataset.action === 'delete-slot') return;
            startInlineEditSlot(tag);
        });
    });

    // 关闭按钮
    document.querySelectorAll('.tag-close[data-action="delete-slot"]').forEach(btn => {
        btn.addEventListener('click', async (e) => {
            e.stopPropagation();
            const name = btn.dataset.slot;
            if (game.slots.length <= 1) {
                alert('至少保留一个存档位');
                return;
            }
            if (!confirm(`确定删除存档位「${name}」及其所有备份吗？`)) return;
            game.slots = game.slots.filter(s => s.name !== name);
            if (selectedSlot === name) selectedSlot = game.slots[0].name;
            await saveConfigToBackend();
            renderSlotTabs();
            refreshBackupList();
        });
    });

    // + 新增按钮
    const addBtn = document.getElementById('addSlotBtn');
    if (addBtn) {
        addBtn.addEventListener('click', async () => {
            const n = game.slots.length + 1;
            const name = `存档${n}`;
            game.slots.push({ name, next_backup_number: 1, key_file_patterns: [] });
            await saveConfigToBackend();
            selectedSlot = name;
            renderSlotTabs();
            refreshBackupList();
            setTimeout(() => {
                const newTag = document.querySelector(`.slot-tag[data-slot="${escapeHtml(name)}"]`);
                if (newTag) startInlineEditSlot(newTag);
            }, 50);
        });
    }
}

function startInlineEditSlot(tag) {
    const name = tag.dataset.slot;
    const input = document.createElement('input');
    input.value = name;
    input.addEventListener('keydown', async (e) => {
        if (e.key === 'Enter') {
            const newName = input.value.trim();
            if (newName && newName !== name) await renameSlot(name, newName);
        } else if (e.key === 'Escape') {
            renderSlotTabs();
        }
    });
    input.addEventListener('blur', async () => {
        const newName = input.value.trim();
        if (newName && newName !== name) await renameSlot(name, newName);
        else renderSlotTabs();
    });
    tag.replaceChild(input, tag.firstChild);
    input.focus();
    input.select();
}

async function renameSlot(oldName, newName) {
    const game = currentConfig.games.find(g => g.name === selectedGame);
    if (!game) return;
    if (game.slots.some(s => s.name === newName)) {
        alert('该存档位名已存在');
        renderSlotTabs();
        return;
    }
    const slot = game.slots.find(s => s.name === oldName);
    if (slot) slot.name = newName;
    if (selectedSlot === oldName) selectedSlot = newName;
    const oldKey = selectedGame + ':' + oldName;
    const newKey = selectedGame + ':' + newName;
    if (filePathBySlot[oldKey]) { filePathBySlot[newKey] = filePathBySlot[oldKey]; delete filePathBySlot[oldKey]; }
    if (currentHashBySlot[oldKey]) { currentHashBySlot[newKey] = currentHashBySlot[oldKey]; delete currentHashBySlot[oldKey]; }
    await saveConfigToBackend();
    renderSlotTabs();
    refreshBackupList();
}

function restoreFilePath() {
    const key = selectedGame + ':' + selectedSlot;
    filePathInput.value = filePathBySlot[key] || '';
}
```

- [ ] **Step 3: Commit**

```bash
git add src/main.js
git commit -m "feat: game tab and slot tag rendering with inline edit and drag sort"
```

---

### Task 10: 实现备份操作与哈希逻辑

**Files:**
- Modify: `src/main.js`

- [ ] **Step 1: 添加备份保存（含哈希去重）**

```js
// ==================== 配置管理 ====================

async function loadConfig() {
    currentConfig = await invoke('get_config');
    updateSettingsDisplay();
    if (currentConfig.games.length > 0) {
        selectedGame = currentConfig.games[0].name;
        if (currentConfig.games[0].slots.length > 0) {
            selectedSlot = currentConfig.games[0].slots[0].name;
        }
    }
    renderGameTabs();
    renderSlotTabs();
    restoreFilePath();
    await refreshCurrentHash();
    refreshBackupList();
}

async function saveConfigToBackend() {
    await invoke('set_config', { config: currentConfig });
}

async function refreshCurrentHash() {
    if (!selectedGame || !selectedSlot) return;
    const key = selectedGame + ':' + selectedSlot;
    const fp = filePathBySlot[key];
    if (!fp) return;
    const game = currentConfig.games.find(g => g.name === selectedGame);
    const slot = game ? game.slots.find(s => s.name === selectedSlot) : null;
    const patterns = slot ? slot.key_file_patterns : [];
    try {
        const hash = await invoke('compute_hash', { filePath: fp, patterns: patterns });
        currentHashBySlot[key] = hash;
    } catch (e) {
        // 源文件可能不存在，忽略
    }
}

// ==================== 文件选择 ====================

browseFileBtn.addEventListener('click', async () => {
    const path = await invoke('pick_file');
    if (path) {
        filePathInput.value = path;
        const key = selectedGame + ':' + selectedSlot;
        filePathBySlot[key] = path;
        await refreshCurrentHash();
        refreshBackupList();
    }
});

// 手动输入路径时也记住
filePathInput.addEventListener('change', async () => {
    const key = selectedGame + ':' + selectedSlot;
    filePathBySlot[key] = filePathInput.value.trim();
    await refreshCurrentHash();
    refreshBackupList();
});

// ==================== 备份操作 ====================

saveBackupBtn.addEventListener('click', async () => {
    hideMessages();
    const gameName = selectedGame;
    const slotName = selectedSlot;
    const filePath = filePathInput.value.trim();

    if (!gameName) { showBackupError('请先选择游戏'); return; }
    if (!slotName) { showBackupError('请先选择存档位'); return; }
    if (!filePath) { showBackupError('请输入或选择存档文件路径'); return; }
    if (!currentConfig.backup_root) { showBackupError('请先在设置中配置备份根目录'); return; }

    setButtonLoading(saveBackupBtn, '保存中...');
    try {
        // 先重算哈希
        await refreshCurrentHash();
        const key = gameName + ':' + slotName;
        filePathBySlot[key] = filePath;

        const result = await invoke('create_backup', {
            gameName: gameName,
            slotName: slotName,
            filePath: filePath
        });
        if (result.success) {
            showBackupSuccess(result.message);
            await refreshCurrentHash();
            refreshBackupList();
        } else {
            showBackupError(result.message);
        }
    } catch (err) {
        showBackupError(`备份失败: ${err}`);
    } finally {
        resetButton(saveBackupBtn, '保存存档');
    }
});
```

- [ ] **Step 2: 添加备份列表渲染（含哈希标记和置顶）**

```js
// ==================== 备份列表 ====================

async function refreshBackupList() {
    if (!selectedGame || !selectedSlot) {
        backupList.innerHTML = '<div class="empty-hint">请先选择游戏和存档位</div>';
        backupListTitle.textContent = '备份记录';
        return;
    }

    backupListTitle.textContent = `备份记录 — ${selectedGame} / ${selectedSlot}`;

    try {
        const backups = await invoke('list_backups', {
            gameName: selectedGame,
            slotName: selectedSlot
        });

        if (backups.length === 0) {
            backupList.innerHTML = '<div class="empty-hint">暂无备份</div>';
            return;
        }

        const currentHash = currentHashBySlot[selectedGame + ':' + selectedSlot] || '';

        // 收集所有 hash 用于重复标记
        const hashCounts = {};
        backups.forEach(b => { if (b.content_hash) hashCounts[b.content_hash] = (hashCounts[b.content_hash] || 0) + 1; });

        backupList.innerHTML = backups.map(b => {
            let extraClass = '';
            let badgeHtml = '';
            const isCurrentMatch = currentHash && b.content_hash === currentHash;
            const isDuplicate = !isCurrentMatch && b.content_hash && hashCounts[b.content_hash] > 1;

            if (isCurrentMatch) {
                extraClass = ' hash-match';
                badgeHtml = '<span class="hash-badge match">= 当前</span>';
            } else if (isDuplicate) {
                extraClass = ' hash-duplicate';
                badgeHtml = '<span class="hash-badge duplicate">= 重复</span>';
            }

            return `<div class="backup-item${extraClass}">
                <button class="btn-pin${b.pinned ? ' pinned' : ''}" data-action="toggle-pin" data-folder="${escapeHtml(b.folder_name)}" title="${b.pinned ? '取消置顶' : '置顶'}">&#128204;</button>
                <span class="name" title="${escapeHtml(b.display_name)}">${escapeHtml(b.display_name)}</span>
                ${badgeHtml}
                <span class="original-path" title="${escapeHtml(b.original_file_path)}">${escapeHtml(shortenPath(b.original_file_path))}</span>
                <button class="btn-small" data-action="restore" data-folder="${escapeHtml(b.folder_name)}">恢复</button>
                <button class="btn-small" data-action="rename-backup" data-folder="${escapeHtml(b.folder_name)}" data-desc="${escapeHtml(b.description || '')}">重命名</button>
                <button class="btn-danger" data-action="delete-backup" data-folder="${escapeHtml(b.folder_name)}">删除</button>
            </div>`;
        }).join('');

        bindBackupItemEvents();
    } catch (err) {
        backupList.innerHTML = `<div class="empty-hint">加载失败: ${err}</div>`;
    }
}

function bindBackupItemEvents() {
    backupList.querySelectorAll('[data-action]').forEach(btn => {
        btn.addEventListener('click', async (e) => {
            e.stopPropagation();
            const action = btn.dataset.action;
            const folder = btn.dataset.folder;

            if (action === 'restore') await handleRestore(folder);
            else if (action === 'rename-backup') await handleRenameBackup(folder, btn.dataset.desc);
            else if (action === 'delete-backup') await handleDeleteBackup(folder);
            else if (action === 'toggle-pin') await handleTogglePin(btn, folder);
        });
    });
}

async function handleRestore(folderName) {
    setButtonLoading(saveBackupBtn, '恢复中...');
    try {
        const result = await invoke('restore_backup', {
            gameName: selectedGame,
            slotName: selectedSlot,
            folderName: folderName,
            skipBackup: false
        });
        if (result.success) {
            alert(result.message);
            await refreshCurrentHash();
            refreshBackupList();
        } else if (result.message.startsWith('NEED_BACKUP_CONFIRM:')) {
            const originalPath = result.message.split(':')[1];
            if (confirm(`当前存档「${originalPath}」未备份，是否需要先备份再恢复？\n\n确定 = 先备份再恢复\n取消 = 直接覆盖恢复`)) {
                // 先备份当前文件再恢复
                const result2 = await invoke('restore_backup', {
                    gameName: selectedGame, slotName: selectedSlot,
                    folderName: folderName, skipBackup: true
                });
                alert(result2.message);
            } else {
                const result2 = await invoke('restore_backup', {
                    gameName: selectedGame, slotName: selectedSlot,
                    folderName: folderName, skipBackup: true
                });
                alert(result2.message);
            }
            await refreshCurrentHash();
            refreshBackupList();
        } else {
            alert('恢复失败: ' + result.message);
        }
    } catch (err) {
        alert('恢复失败: ' + err);
    } finally {
        resetButton(saveBackupBtn, '保存存档');
    }
}

async function handleRenameBackup(folderName, currentDesc) {
    const newDesc = prompt('修改备份描述（时间戳不可改）:', currentDesc || '');
    if (newDesc === null) return;
    const result = await invoke('rename_backup', {
        gameName: selectedGame,
        slotName: selectedSlot,
        folderName: folderName,
        newDescription: newDesc.trim()
    });
    if (result.success) {
        refreshBackupList();
    } else {
        alert('重命名失败: ' + result.message);
    }
}

async function handleDeleteBackup(folderName) {
    if (!confirm('确定要删除此备份吗？此操作不可恢复。')) return;
    setButtonLoading(saveBackupBtn, '删除中...');
    try {
        const result = await invoke('delete_backup', {
            gameName: selectedGame,
            slotName: selectedSlot,
            folderName: folderName
        });
        if (result.success) {
            refreshBackupList();
        } else {
            alert('删除失败: ' + result.message);
        }
    } catch (err) {
        alert('删除失败: ' + err);
    } finally {
        resetButton(saveBackupBtn, '保存存档');
    }
}

async function handleTogglePin(btn, folderName) {
    setButtonLoading(btn, '...');
    try {
        const result = await invoke('toggle_backup_pin', {
            gameName: selectedGame,
            slotName: selectedSlot,
            folderName: folderName
        });
        if (result.success) refreshBackupList();
    } catch (err) {
        alert('操作失败: ' + err);
    } finally {
        resetButtonRaw(btn);
    }
}
```

- [ ] **Step 3: Commit**

```bash
git add src/main.js
git commit -m "feat: backup list with hash badges, pin toggle, restore protection"
```

---

### Task 11: 实现设置弹窗、按钮辅助函数、启动逻辑

**Files:**
- Modify: `src/main.js`

- [ ] **Step 1: 设置弹窗**

```js
// ==================== 设置弹窗 ====================

settingsBtn.addEventListener('click', () => {
    updateSettingsDisplay();
    settingsOverlay.style.display = 'flex';
});

settingsCloseBtn.addEventListener('click', () => {
    settingsOverlay.style.display = 'none';
});

settingsOverlay.addEventListener('click', (e) => {
    if (e.target === settingsOverlay) settingsOverlay.style.display = 'none';
});

settingsSetDirBtn.addEventListener('click', async () => {
    const dir = await invoke('pick_directory');
    if (dir) {
        currentConfig.backup_root = dir;
        await saveConfigToBackend();
        updateSettingsDisplay();
    }
});

function updateSettingsDisplay() {
    if (currentConfig.backup_root) {
        settingsBackupRoot.textContent = currentConfig.backup_root;
        settingsBackupRoot.style.color = 'rgba(255,255,255,0.7)';
    } else {
        settingsBackupRoot.textContent = '未设置';
        settingsBackupRoot.style.color = 'rgba(255,255,255,0.3)';
    }
}
```

- [ ] **Step 2: 按钮辅助函数**

```js
// ==================== 按钮防重复 ====================

function setButtonLoading(btn, text) {
    btn.disabled = true;
    btn._originalText = btn.textContent;
    btn.textContent = text;
}

function resetButton(btn, originalText) {
    btn.disabled = false;
    btn.textContent = originalText;
}

function resetButtonRaw(btn) {
    btn.disabled = false;
    if (btn._originalText) {
        btn.textContent = btn._originalText;
        delete btn._originalText;
    }
}
```

- [ ] **Step 3: 消息提示和工具函数**

```js
// ==================== 消息提示 ====================

function hideMessages() {
    backupError.style.display = 'none';
    backupSuccess.style.display = 'none';
}

function showBackupError(msg) {
    backupError.innerText = msg;
    backupError.style.display = 'block';
    backupSuccess.style.display = 'none';
}

function showBackupSuccess(msg) {
    backupSuccess.innerText = msg;
    backupSuccess.style.display = 'block';
    backupError.style.display = 'none';
}

// ==================== 工具函数 ====================

function escapeHtml(str) {
    const div = document.createElement('div');
    div.textContent = str;
    return div.innerHTML;
}

function shortenPath(path) {
    if (!path) return '';
    const parts = path.replace(/\\/g, '/').split('/');
    if (parts.length <= 2) return path;
    return '.../' + parts.slice(-2).join('/');
}

function refreshAll() {
    renderGameTabs();
    renderSlotTabs();
    if (selectedGame && selectedSlot) {
        restoreFilePath();
        refreshCurrentHash();
        refreshBackupList();
    }
}
```

- [ ] **Step 4: 添加时间转换代码（从原 main.js 迁移）**

把时间转换部分的现有逻辑（`convert`、`convertBack`、`resetToCurrentTime`、事件绑定）完整复制到新 JS 文件中。

- [ ] **Step 5: 启动逻辑**

```js
// ==================== 启动 ====================

resetToCurrentTime();
loadConfig();
```

- [ ] **Step 6: Commit**

```bash
git add src/main.js
git commit -m "feat: settings modal, button anti-double-click, startup wiring"
```

---

## 阶段五：集成验证

### Task 12: 编译运行验证

**Files:**
- Verify: all modified files

- [ ] **Step 1: 编译 Rust**

```bash
cargo build 2>&1
```

预期：PASS，无编译错误。

- [ ] **Step 2: 启动 Tauri dev**

```bash
cargo tauri dev
```

手动验证：
1. 顶部栏显示 "HRB Tools" + 齿轮
2. 点击齿轮 → 设置弹窗 → 设置备份根目录
3. 切换到存档管理 → 默认有一个「游戏1」标签
4. 存档位显示「存档1」胶囊
5. 选择文件 → 保存存档 → 列表显示备份
6. 连续保存相同文件 → 提示"存档未变化"
7. 点击图钉 → 备份置顶
8. 拖拽游戏标签 → 排序变化
9. 双击标签/胶囊 → 内联编辑改名
10. 点击 × 删除游戏/存档位
11. 按钮点击后变灰 + loading 文字

- [ ] **Step 3: 修复问题并 Commit**

```bash
git add -A
git commit -m "fix: integration fixes after manual testing"
```

---

## 完成检查

- [ ] `cargo build` 编译通过
- [ ] `cargo tauri dev` 启动正常
- [ ] 全部 15 个交互行为正常
- [ ] 按钮防重复（disabled + loading text）
- [ ] 设置弹窗正常开关
- [ ] 时间转换面板不受影响
