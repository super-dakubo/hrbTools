# 存档文件多选支持 — 实现计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 将存档位从单文件改为多文件支持，备份时全部打包，每个文件独立哈希，恢复时可选择。

**Architecture:** 修改 `SlotConfig.file_path` 为 `file_paths: Vec<String>`；meta.json 从单个哈希改为 `files` 映射结构；备份/恢复/哈希命令适配多文件；前端用标签式 UI 管理文件列表。

**Tech Stack:** Rust (Tauri 2.0, serde, chrono, md-5), 原生 JS/HTML/CSS（无框架）

**涉及文件:**
- 修改: `src/main.rs`, `src/main.js`, `src/index.html`, `src/styles.css`

---

### Task 1: Rust 数据结构 — SlotConfig 改为多文件 + meta.json 格式

**文件:**
- 修改: `src/main.rs:43-53` (SlotConfig), `src/main.rs:320-355` (read_backup_meta), 及所有引用 `file_path` / `file_paths` 的位置

- [ ] **Step 1: 修改 SlotConfig — `file_path` → `file_paths`**

在 `src/main.rs` 中，将 SlotConfig 的 `file_path: String` 改为 `file_paths: Vec<String>`:

```rust
#[derive(Debug, Serialize, Deserialize, Clone)]
struct SlotConfig {
    id: String,
    name: String,
    #[serde(default)]
    file_paths: Vec<String>,   // ← 改前: file_path: String
    #[serde(default = "default_next_backup_number")]
    next_backup_number: u32,
    #[serde(default)]
    key_file_patterns: Vec<String>,
}
```

- [ ] **Step 2: 修改 read_backup_meta — 支持新旧两种 meta.json 格式**

将 `src/main.rs` 的 `read_backup_meta` 函数（约 L320-355）改为：

```rust
fn read_backup_meta(dir: &std::path::Path, folder_name: &str) -> Option<BackupInfo> {
    let meta_path = dir.join("meta.json");
    let (display_name, original_file_path, content_hash, pinned) = if meta_path.exists() {
        std::fs::read_to_string(&meta_path)
            .ok()
            .and_then(|json| serde_json::from_str::<serde_json::Value>(&json).ok())
            .map(|meta| {
                let display_name = meta["display_name"].as_str().unwrap_or(folder_name).to_string();
                let pinned = meta["pinned"].as_bool().unwrap_or(false);

                // 新格式: "files" 映射
                let (original_path, hash) = if let Some(files) = meta["files"].as_object() {
                    let first = files.values().next().and_then(|v| v.as_object());
                    (
                        first.and_then(|f| f["original_path"].as_str()).unwrap_or("").to_string(),
                        first.and_then(|f| f["content_hash"].as_str()).unwrap_or("").to_string(),
                    )
                } else {
                    // 旧格式向后兼容
                    (
                        meta["original_file_path"].as_str().unwrap_or("").to_string(),
                        meta["content_hash"].as_str().unwrap_or("").to_string(),
                    )
                };
                (display_name, original_path, hash, pinned)
            })
            .unwrap_or_else(|| (folder_name.to_string(), String::new(), String::new(), false))
    } else {
        (folder_name.to_string(), String::new(), String::new(), false)
    };

    // 从 folder_name 提取描述（时间戳之后的部分）
    let description = folder_name
        .split(' ')
        .skip(2)
        .collect::<Vec<_>>()
        .join(" ");

    Some(BackupInfo {
        folder_name: folder_name.to_string(),
        display_name,
        description,
        created_at: String::new(),
        original_file_path,
        content_hash,
        pinned,
    })
}
```

- [ ] **Step 3: 搜索并修复所有 `file_path` → `file_paths` 引用**

用 grep 确认以下位置的引用已更新（本 task 只改结构体定义 + read_backup_meta，其余在后续 task 中改）:
- 结构体 `SlotConfig` 定义 ✓ (Step 1)
- `read_backup_meta` ✓ (Step 2)
- `create_backup` — 将在 Task 3 处理
- `restore_backup` — 将在 Task 4 处理
- `recompute_backup_hash` — 将在 Task 5 处理

- [ ] **Step 4: 验证编译**

```bash
cargo build 2>&1
```

Expected: 编译失败（因为 create_backup / restore_backup 等还在用旧字段 `.file_path`），确认报错位置与预期一致。

- [ ] **Step 5: 提交**

```bash
git add src/main.rs
git commit -m "refactor: change SlotConfig.file_path to file_paths Vec, add backward-compat meta.json reading

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>"
```

---

### Task 2: Rust — compute_hash 改为多文件 + 返回 HashMap

**文件:**
- 修改: `src/main.rs:657-730` (compute_hash, compute_file_hash, compute_dir_hash)

- [ ] **Step 1: 重写 compute_hash 签名和逻辑**

将 `src/main.rs` 的 `compute_hash` 函数（约 L657-670）改为：

```rust
#[tauri::command]
fn compute_hash(file_paths: Vec<String>, patterns: Vec<String>) -> Result<std::collections::HashMap<String, String>, String> {
    let mut result = std::collections::HashMap::new();
    for file_path in &file_paths {
        let path = std::path::Path::new(file_path);
        if !path.exists() {
            return Err(format!("路径不存在: {}", file_path));
        }
        let file_name = path.file_name()
            .map(|n| n.to_string_lossy().to_string())
            .unwrap_or_else(|| file_path.clone());
        let hash = if path.is_file() {
            compute_file_hash(path)?
        } else {
            compute_dir_hash(path, &patterns)?
        };
        result.insert(file_name, hash);
    }
    Ok(result)
}
```

保留 `compute_file_hash` 和 `compute_dir_hash` 和 `simple_glob_match` 不变。

- [ ] **Step 2: 验证编译**

```bash
cargo build 2>&1
```

Expected: compute_hash 编译通过。其余报错仍在 create_backup / restore_backup (正常)。

- [ ] **Step 3: 提交**

```bash
git add src/main.rs
git commit -m "refactor: compute_hash accepts multiple file paths, returns HashMap

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>"
```

---

### Task 3: Rust — create_backup 适配多文件

**文件:**
- 修改: `src/main.rs:358-469` (create_backup)

- [ ] **Step 1: 重写 create_backup**

将 `src/main.rs` 的 `create_backup` 函数完整替换为：

```rust
#[tauri::command]
fn create_backup(
    app: tauri::AppHandle,
    game_id: String,
    slot_id: String,
    file_paths: Vec<String>,   // ← 改前: file_path: String
) -> OpResult {
    let mut config = load_config(&app);

    // 1. 检查备份目录
    if config.backup_root.is_empty() {
        return OpResult {
            success: false,
            message: "请先在设置中配置备份根目录".to_string(),
        };
    }

    if file_paths.is_empty() {
        return OpResult {
            success: false,
            message: "请先添加存档文件".to_string(),
        };
    }

    // 2. 检查所有源文件存在
    for fp in &file_paths {
        let source = std::path::PathBuf::from(fp);
        if !source.exists() {
            return OpResult {
                success: false,
                message: format!("文件不存在: {}", fp),
            };
        }
    }

    // 3. 找到对应的 slot
    let slot = match config.games.iter().find(|g| g.id == game_id) {
        Some(game) => match game.slots.iter().find(|s| s.id == slot_id) {
            Some(s) => s.clone(),
            None => return OpResult { success: false, message: "存档位不存在".to_string() },
        },
        None => return OpResult { success: false, message: "游戏不存在".to_string() },
    };

    let backup_number = slot.next_backup_number;

    // 4. 计算所有文件哈希
    let mut file_hashes: std::collections::HashMap<String, String> = std::collections::HashMap::new();
    for fp in &file_paths {
        let path = std::path::Path::new(fp);
        let file_name = path.file_name()
            .map(|n| n.to_string_lossy().to_string())
            .unwrap_or_else(|| fp.clone());
        let hash = match compute_single_hash(fp.clone(), slot.key_file_patterns.clone()) {
            Ok(h) => h,
            Err(e) => return OpResult { success: false, message: format!("计算哈希失败: {}", e) },
        };
        file_hashes.insert(file_name, hash);
    }

    // 5. 去重检查: 取最新备份，逐一比对每个文件的哈希
    let existing = list_backups_internal(&config, &game_id, &slot_id);
    if let Some(latest) = existing.first() {
        if let Ok(meta_json) = std::fs::read_to_string(
            std::path::PathBuf::from(&config.backup_root)
                .join(&game_id).join(&slot_id).join(&latest.folder_name).join("meta.json")
        ) {
            if let Ok(meta) = serde_json::from_str::<serde_json::Value>(&meta_json) {
                if let Some(old_files) = meta["files"].as_object() {
                    let all_match = file_hashes.iter().all(|(name, hash)| {
                        old_files.get(name)
                            .and_then(|f| f["content_hash"].as_str())
                            .map(|h| h == hash)
                            .unwrap_or(false)
                    }) && file_hashes.len() == old_files.len();
                    if all_match {
                        return OpResult {
                            success: false,
                            message: "存档未变化，无需重复备份".to_string(),
                        };
                    }
                }
            }
        }
    }

    // 6. 生成备份文件夹名
    let now = chrono::Local::now();
    let timestamp_part = now.format("%Y-%m-%d %H-%M-%S").to_string();
    let folder_name = format!("{} {}", timestamp_part, backup_number);
    let display_name = now.format("%Y-%m-%d %H:%M:%S").to_string();
    let display_name_full = format!("{} {}", display_name, backup_number);

    // 7. 创建备份目录
    let backup_dir = std::path::PathBuf::from(&config.backup_root)
        .join(&game_id)
        .join(&slot_id)
        .join(&folder_name);

    if let Err(e) = std::fs::create_dir_all(&backup_dir) {
        return OpResult {
            success: false,
            message: format!("创建备份目录失败: {}", e),
        };
    }

    // 8. 复制所有文件 + 构建 files 元数据
    let mut files_meta = serde_json::Map::new();
    for fp in &file_paths {
        let source = std::path::Path::new(fp);
        let file_name = source.file_name()
            .map(|n| n.to_string_lossy().to_string())
            .unwrap_or_else(|| fp.clone());
        let dest = backup_dir.join(&file_name);
        if let Err(e) = std::fs::copy(source, &dest) {
            return OpResult {
                success: false,
                message: format!("复制文件失败: {}", e),
            };
        }
        let hash = file_hashes.get(&file_name).cloned().unwrap_or_default();
        files_meta.insert(file_name.clone(), serde_json::json!({
            "original_path": fp,
            "content_hash": hash,
        }));
    }

    // 9. 写入 meta.json
    let meta = serde_json::json!({
        "display_name": display_name_full,
        "description": backup_number.to_string(),
        "files": files_meta,
    });
    if let Ok(json) = serde_json::to_string_pretty(&meta) {
        let _ = std::fs::write(backup_dir.join("meta.json"), json);
    }

    // 10. 自增序号并保存
    if let Some(game) = config.games.iter_mut().find(|g| g.id == game_id) {
        if let Some(s) = game.slots.iter_mut().find(|s| s.id == slot_id) {
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

- [ ] **Step 2: 添加 compute_single_hash 辅助函数**

在 `compute_hash` 命令之后插入（约 L670 之后）：

```rust
fn compute_single_hash(file_path: String, patterns: Vec<String>) -> Result<String, String> {
    let path = std::path::Path::new(&file_path);
    if !path.exists() {
        return Err(format!("路径不存在: {}", file_path));
    }
    if path.is_file() {
        compute_file_hash(path)
    } else {
        compute_dir_hash(path, &patterns)
    }
}
```

这用于 create_backup 内部调用的单文件哈希计算。

- [ ] **Step 3: 更新 invoke_handler 注册**

在 `src/main.rs` 的 `tauri::generate_handler![]` 宏中，确保所有命令都在列表中（`create_backup` 已存在，无需新增，但确认签名一致）。

- [ ] **Step 4: 验证编译**

```bash
cargo build 2>&1
```

Expected: create_backup 编译通过。restore_backup 可能仍有单文件引用报错。

- [ ] **Step 5: 提交**

```bash
git add src/main.rs
git commit -m "refactor: create_backup supports multiple files with per-file hashing

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>"
```

---

### Task 4: Rust — restore_backup 支持多文件选择性恢复

**文件:**
- 修改: `src/main.rs:564-652` (restore_backup)

- [ ] **Step 1: 重写 restore_backup**

将 `src/main.rs` 的 `restore_backup` 函数完整替换为：

```rust
#[tauri::command]
fn restore_backup(
    app: tauri::AppHandle,
    game_id: String,
    slot_id: String,
    folder_name: String,
    skip_backup: bool,
    selected_files: Option<Vec<String>>,  // ← 新增参数
) -> OpResult {
    let config = load_config(&app);
    let backup_dir = std::path::PathBuf::from(&config.backup_root)
        .join(&game_id)
        .join(&slot_id)
        .join(&folder_name);

    if !backup_dir.exists() {
        return OpResult { success: false, message: "备份不存在".to_string() };
    }

    // 读取 meta.json，收集文件信息
    let meta_path = backup_dir.join("meta.json");
    let files_info: Vec<(String, String)> = if meta_path.exists() {
        let meta_str = std::fs::read_to_string(&meta_path).unwrap_or_default();
        if let Ok(meta) = serde_json::from_str::<serde_json::Value>(&meta_str) {
            if let Some(files) = meta["files"].as_object() {
                files.iter().map(|(name, info)| {
                    let original_path = info["original_path"].as_str().unwrap_or("").to_string();
                    (name.clone(), original_path)
                }).collect()
            } else if let Some(original_path) = meta["original_file_path"].as_str() {
                // 旧格式向后兼容: 从备份目录找文件
                let backup_file = find_backup_file(&backup_dir);
                let name = backup_file
                    .as_ref()
                    .and_then(|p| p.file_name())
                    .map(|n| n.to_string_lossy().to_string())
                    .unwrap_or_else(|| "save.dat".to_string());
                vec![(name, original_path.to_string())]
            } else {
                vec![]
            }
        } else {
            vec![]
        }
    } else {
        vec![]
    };

    if files_info.is_empty() {
        return OpResult { success: false, message: "备份中没有文件信息".to_string() };
    }

    // 单文件直接恢复；多文件且未指定 selected_files 时返回文件列表
    if files_info.len() > 1 && selected_files.is_none() {
        let file_list: Vec<String> = files_info.iter().map(|(name, path)| {
            format!("{}|{}", name, path)
        }).collect();
        return OpResult {
            success: false,
            message: format!("SELECT_FILES:{}", file_list.join(";;")),
        };
    }

    // 筛选要恢复的文件
    let to_restore: Vec<&(String, String)> = if let Some(ref selected) = selected_files {
        files_info.iter().filter(|(name, _)| selected.contains(name)).collect()
    } else {
        files_info.iter().collect()
    };

    if to_restore.is_empty() {
        return OpResult { success: false, message: "未选择要恢复的文件".to_string() };
    }

    // 检查原始文件是否需要先备份（仅检查第一个需恢复的文件）
    if !skip_backup && to_restore.iter().any(|(_, orig)| {
        let orig_path = std::path::Path::new(orig);
        orig_path.exists()
    }) {
        let patterns: Vec<String> = config.games.iter()
            .find(|g| g.id == game_id)
            .and_then(|g| g.slots.iter().find(|s| s.id == slot_id))
            .map(|s| s.key_file_patterns.clone())
            .unwrap_or_default();

        let first_original = &to_restore[0].1;
        let current_hash = compute_single_hash(first_original.clone(), patterns).unwrap_or_default();
        let hash_match = list_backups_internal(&config, &game_id, &slot_id)
            .iter()
            .any(|b| b.content_hash == current_hash);

        if !hash_match {
            return OpResult {
                success: false,
                message: format!("NEED_BACKUP_CONFIRM:{}", first_original),
            };
        }
    }

    // 逐个恢复选中文件
    let mut restored = 0;
    for (name, original_path) in &to_restore {
        let backup_file = backup_dir.join(name);
        if !backup_file.exists() {
            continue;
        }
        // 确保目标目录存在
        if let Some(parent) = std::path::Path::new(original_path).parent() {
            let _ = std::fs::create_dir_all(parent);
        }
        match std::fs::copy(&backup_file, original_path) {
            Ok(_) => restored += 1,
            Err(e) => {
                return OpResult {
                    success: false,
                    message: format!("恢复 {} 失败: {}", name, e),
                };
            }
        }
    }

    OpResult {
        success: true,
        message: format!("已恢复 {}/{} 个文件", restored, to_restore.len()),
    }
}

/// 在备份目录中找第一个非 meta.json 的文件
fn find_backup_file(backup_dir: &std::path::Path) -> Option<std::path::PathBuf> {
    std::fs::read_dir(backup_dir).ok()?
        .filter_map(|e| e.ok())
        .filter(|e| e.file_type().map(|t| t.is_file()).unwrap_or(false))
        .filter(|e| e.file_name() != "meta.json")
        .map(|e| e.path())
        .next()
}
```

- [ ] **Step 2: 验证编译**

```bash
cargo build 2>&1
```

Expected: restore_backup 相关部分编译通过。

- [ ] **Step 3: 提交**

```bash
git add src/main.rs
git commit -m "refactor: restore_backup supports selective multi-file restore

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>"
```

---

### Task 5: Rust — recompute_backup_hash + list_backups_internal 适配新格式

**文件:**
- 修改: `src/main.rs:826-878` (recompute_backup_hash), `src/main.rs:291-318` (list_backups_internal)

- [ ] **Step 1: 更新 recompute_backup_hash — 适配新 meta.json `files` 格式**

将 `src/main.rs` 的 `recompute_backup_hash` 函数（约 L826-878）替换为：

```rust
#[tauri::command]
fn recompute_backup_hash(
    app: tauri::AppHandle,
    game_id: String,
    slot_id: String,
    folder_name: String,
) -> OpResult {
    let config = load_config(&app);
    let backup_dir = std::path::PathBuf::from(&config.backup_root)
        .join(&game_id)
        .join(&slot_id)
        .join(&folder_name);

    if !backup_dir.exists() {
        return OpResult { success: false, message: "备份不存在".to_string() };
    }

    let meta_path = backup_dir.join("meta.json");
    let meta_str = std::fs::read_to_string(&meta_path).unwrap_or_default();
    let mut meta: serde_json::Value = serde_json::from_str(&meta_str).unwrap_or(serde_json::Value::Null);

    if let Some(files) = meta["files"].as_object_mut() {
        for (name, info) in files.iter_mut() {
            let file_path = backup_dir.join(name);
            if file_path.exists() && file_path.is_file() {
                let new_hash = compute_file_hash(&file_path).unwrap_or_default();
                info["content_hash"] = serde_json::Value::String(new_hash);
            }
        }
        let summary = files.values()
            .next()
            .and_then(|f| f["content_hash"].as_str())
            .map(|h| h[..8.min(h.len())].to_string())
            .unwrap_or_default();
        if let Ok(new_json) = serde_json::to_string_pretty(&meta) {
            let _ = std::fs::write(&meta_path, new_json);
        }
        OpResult { success: true, message: format!("哈希已重算: {}", summary) }
    } else if let Some(old_hash) = meta["content_hash"].as_str() {
        // 旧格式兼容
        let entries: Vec<std::path::PathBuf> = std::fs::read_dir(&backup_dir)
            .into_iter().flatten()
            .filter_map(|e| e.ok())
            .filter(|e| e.file_type().map(|t| t.is_file()).unwrap_or(false))
            .filter(|e| e.file_name() != "meta.json")
            .map(|e| e.path())
            .collect();

        let new_hash = if entries.len() == 1 {
            compute_file_hash(&entries[0]).unwrap_or_default()
        } else {
            let mut hasher = md5::Md5::new();
            for entry in &entries {
                let file_hash = compute_file_hash(entry).unwrap_or_default();
                let rel = entry.file_name().unwrap_or_default().to_string_lossy();
                hasher.update(format!("{}:{}", rel, file_hash).as_bytes());
            }
            format!("{:x}", hasher.finalize())
        };

        meta["content_hash"] = serde_json::Value::String(new_hash.clone());
        if let Ok(new_json) = serde_json::to_string_pretty(&meta) {
            let _ = std::fs::write(&meta_path, new_json);
        }
        OpResult { success: true, message: format!("哈希已重算: {}", &new_hash[..8]) }
    } else {
        OpResult { success: false, message: "无法读取 meta.json".to_string() }
    }
}
```

- [ ] **Step 2: 验证编译**

```bash
cargo build 2>&1
```

Expected: 全部 Rust 代码编译通过，无报错。

- [ ] **Step 3: 提交**

```bash
git add src/main.rs
git commit -m "refactor: recompute_backup_hash adapts to new meta.json files format

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>"
```

---

### Task 6: 前端 JS — 状态和文件标签渲染

**文件:**
- 修改: `src/main.js:8-9` (状态), `src/main.js:325-335` (saveFilePathToSlot), `src/main.js:616-648` (restoreFilePath + refreshCurrentHash), `src/main.js:652-678` (browse/重算)

- [ ] **Step 1: 修改状态变量和 DOM 引用**

将 `src/main.js` L8-9 和 L29 改为：

```js
let filePathsBySlot = {};      // { "gameId:slotId": ["D:/saves/save.dat", "D:/saves/config.ini"] }
let currentHashesBySlot = {};  // { "gameId:slotId": { "save.dat": "abc", "config.ini": "def" } }
```

将 L29 (filePathInput) 改为引用新 DOM 元素：

```js
const fileTagsContainer = document.getElementById('fileTags');
const filePathInput = document.getElementById('filePath');  // 保留但隐藏，用于兼容
```

- [ ] **Step 2: 渲染文件标签函数**

新增函数（插入到 `saveFilePathToSlot` 原位置附近）：

```js
// ==================== 文件标签管理 ====================

function getCurrentFilePaths() {
    if (!selectedGameId || !selectedSlotId) return [];
    const key = selectedGameId + ':' + selectedSlotId;
    return filePathsBySlot[key] || [];
}

function setCurrentFilePaths(paths) {
    if (!selectedGameId || !selectedSlotId) return;
    const key = selectedGameId + ':' + selectedSlotId;
    filePathsBySlot[key] = paths;
    // 持久化到 config
    const game = currentConfig.games.find(g => g.id === selectedGameId);
    if (!game) return;
    const slot = game.slots.find(s => s.id === selectedSlotId);
    if (!slot) return;
    slot.file_paths = paths;
    saveConfigToBackend();
}

function renderFileTags() {
    const paths = getCurrentFilePaths();
    fileTagsContainer.innerHTML = paths.map((fp, i) => {
        const fileName = fp.replace(/\\/g, '/').split('/').pop() || fp;
        return `<span class="file-tag" data-index="${i}" title="${escapeHtml(fp)}">
            ${escapeHtml(fileName)}
            <span class="tag-close" data-action="remove-file" data-index="${i}">&times;</span>
        </span>`;
    }).join('') + `<button class="file-tag-add" id="addFileBtn" title="添加文件">+</button>`;

    if (paths.length === 0) {
        fileTagsContainer.innerHTML = '<span class="empty-hint" style="padding:0.3rem 0;font-size:0.78rem;">暂无文件，点击 + 添加</span>'
            + '<button class="file-tag-add" id="addFileBtn" title="添加文件">+</button>';
    }

    bindFileTagEvents();
}

function bindFileTagEvents() {
    const addBtn = document.getElementById('addFileBtn');
    if (addBtn) {
        addBtn.addEventListener('click', async () => {
            const startDir = (currentConfig.backup_root || null);
            const path = await invoke('pick_file', { startDir });
            if (path) {
                const paths = getCurrentFilePaths();
                if (!paths.includes(path)) {
                    paths.push(path);
                    setCurrentFilePaths(paths);
                    renderFileTags();
                    await refreshCurrentHashes();
                    refreshBackupList();
                }
            }
        });
    }

    fileTagsContainer.querySelectorAll('[data-action="remove-file"]').forEach(btn => {
        btn.addEventListener('click', async (e) => {
            e.stopPropagation();
            const idx = parseInt(btn.dataset.index, 10);
            const paths = getCurrentFilePaths();
            paths.splice(idx, 1);
            setCurrentFilePaths(paths);
            renderFileTags();
            await refreshCurrentHashes();
            refreshBackupList();
        });
    });
}
```

- [ ] **Step 3: 更新 restoreFilePath 和 refreshCurrentHash → refreshCurrentHashes**

替换原 `restoreFilePath` (L616-632) 和 `refreshCurrentHash` (L636-648)：

```js
function restoreFilePaths() {
    if (!selectedGameId || !selectedSlotId) return;
    const key = selectedGameId + ':' + selectedSlotId;
    // 优先用内存
    if (filePathsBySlot[key] && filePathsBySlot[key].length > 0) {
        renderFileTags();
        return;
    }
    // 从 config 恢复
    const game = currentConfig.games.find(g => g.id === selectedGameId);
    if (!game) return;
    const slot = game.slots.find(s => s.id === selectedSlotId);
    if (slot && slot.file_paths && slot.file_paths.length > 0) {
        filePathsBySlot[key] = [...slot.file_paths];
        renderFileTags();
    }
}

async function refreshCurrentHashes() {
    if (!selectedGameId || !selectedSlotId) return;
    const key = selectedGameId + ':' + selectedSlotId;
    const fps = filePathsBySlot[key];
    if (!fps || fps.length === 0) return;
    const game = currentConfig.games.find(g => g.id === selectedGameId);
    const slot = game ? game.slots.find(s => s.id === selectedSlotId) : null;
    const patterns = slot ? slot.key_file_patterns : [];
    try {
        const hashes = await invoke('compute_hash', { filePaths: fps, patterns: patterns });
        currentHashesBySlot[key] = hashes; // { "file.dat": "abc123" }
    } catch (e) { /* ignore */ }
}
```

- [ ] **Step 4: 更新浏览按钮和重算按钮事件**

替换 L652-678 (browseFileBtn + rehashBtn + filePathInput)：

```js
browseFileBtn.addEventListener('click', async () => {
    const startDir = (currentConfig.backup_root || null);
    const path = await invoke('pick_file', { startDir });
    if (path) {
        const paths = getCurrentFilePaths();
        if (!paths.includes(path)) {
            paths.push(path);
            setCurrentFilePaths(paths);
            renderFileTags();
            await refreshCurrentHashes();
            refreshBackupList();
        }
    }
});

rehashBtn.addEventListener('click', async () => {
    const fps = getCurrentFilePaths();
    if (fps.length === 0) { showBackupError('请先添加存档文件'); return; }
    if (!selectedGameId || !selectedSlotId) { showBackupError('请先选择游戏和存档位'); return; }
    hideMessages();
    await refreshCurrentHashes();
    refreshBackupList();
    showBackupSuccess('哈希已重算');
});
```

- [ ] **Step 5: 验证编译**

```bash
cargo build 2>&1
```

Expected: Rust 编译通过。JS 无编译步骤，但检查语法无问题。

- [ ] **Step 6: 提交**

```bash
git add src/main.js
git commit -m "feat: add multi-file tag rendering and state management in JS

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>"
```

---

### Task 7: 前端 JS — 备份/恢复/备份列表适配多文件

**文件:**
- 修改: `src/main.js:682-715` (saveBackupBtn), `src/main.js:719-795` (refreshBackupList), `src/main.js:797-844` (handleRestore)

- [ ] **Step 1: 更新 saveBackupBtn — 传 filePaths 而非 filePath**

替换 `saveBackupBtn` 的事件处理（L682-715）：

```js
saveBackupBtn.addEventListener('click', async () => {
    hideMessages();
    const gameId = selectedGameId;
    const slotId = selectedSlotId;
    const fps = getCurrentFilePaths();

    if (!gameId) { showBackupError('请先选择游戏'); return; }
    if (!slotId) { showBackupError('请先选择存档位'); return; }
    if (fps.length === 0) { showBackupError('请先添加存档文件'); return; }
    if (!currentConfig.backup_root) { showBackupError('请先在设置中配置备份根目录'); return; }

    setButtonLoading(saveBackupBtn, '保存中...');
    try {
        await refreshCurrentHashes();
        setCurrentFilePaths(fps);

        const result = await invoke('create_backup', {
            gameId: gameId,
            slotId: slotId,
            filePaths: fps       // ← 改前: filePath
        });
        if (result.success) {
            showBackupSuccess(result.message);
            await refreshCurrentHashes();
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

- [ ] **Step 2: 更新 refreshBackupList — 多文件哈希显示 + 文件数量**

替换 `refreshBackupList` 中构建 HTML 的部分（L747-772），修改 badge 逻辑：

```js
// 在 refreshBackupList 函数内，替换 hashCounts 和 backupList.innerHTML 部分
const currentHashes = currentHashesBySlot[selectedGameId + ':' + selectedSlotId] || {};
const hashCounts = {};
backups.forEach(b => { if (b.content_hash) hashCounts[b.content_hash] = (hashCounts[b.content_hash] || 0) + 1; });

backupList.innerHTML = backups.map(b => {
    let extraClass = '';
    let badgeHtml = '';
    const isCurrentMatch = currentHashes && Object.values(currentHashes).includes(b.content_hash);
    const isDuplicate = !isCurrentMatch && b.content_hash && hashCounts[b.content_hash] > 1;

    if (isCurrentMatch) {
        extraClass = ' hash-match';
        badgeHtml = '<span class="hash-badge match">= 当前</span>';
    } else if (isDuplicate) {
        extraClass = ' hash-duplicate';
        badgeHtml = '<span class="hash-badge duplicate">= 重复</span>';
    }

    // 多文件标记：检查是否有 files 元数据（在 list_backups 结果中不直接可读，通过显示名判断）
    const fileCountHint = b.content_hash ? '' : '';

    return `<div class="backup-item${extraClass}">
        <button class="btn-pin${b.pinned ? ' pinned' : ''}" data-action="toggle-pin" data-folder="${escapeHtml(b.folder_name)}" title="${b.pinned ? '取消置顶' : '置顶'}">&#128204;</button>
        <span class="name" title="${escapeHtml(b.display_name)}">${escapeHtml(b.display_name)}</span>
        ${badgeHtml}
        <span class="original-path" title="${escapeHtml(b.original_file_path)}">${escapeHtml(shortenPath(b.original_file_path))}</span>
        <button class="btn-small" data-action="restore" data-folder="${escapeHtml(b.folder_name)}">恢复</button>
        <button class="btn-small" data-action="rename-backup" data-folder="${escapeHtml(b.folder_name)}" data-desc="${escapeHtml(b.description || '')}">重命名</button>
        <button class="btn-small" data-action="open-backup" data-folder="${escapeHtml(b.folder_name)}">打开</button>
        <button class="btn-small" data-action="rehash-backup" data-folder="${escapeHtml(b.folder_name)}">重算</button>
        <button class="btn-danger" data-action="delete-backup" data-folder="${escapeHtml(b.folder_name)}">删除</button>
    </div>`;
}).join('');
```

- [ ] **Step 3: 更新 handleRestore — 多文件时弹出选择弹窗**

替换 `handleRestore` 函数（L797-844）：

```js
async function handleRestore(folderName) {
    setButtonLoading(saveBackupBtn, '恢复中...');
    try {
        const result = await invoke('restore_backup', {
            gameId: selectedGameId,
            slotId: selectedSlotId,
            folderName: folderName,
            skipBackup: false,
            selectedFiles: null
        });

        if (result.success) {
            alert(result.message);
            await refreshCurrentHashes();
            refreshBackupList();
        } else if (result.message.startsWith('SELECT_FILES:')) {
            // 多文件备份 — 弹出选择弹窗
            const fileEntries = result.message.split(':').slice(1).join(':').split(';;');
            const files = fileEntries.map(e => {
                const [name, path] = e.split('|');
                return { name, path };
            });
            showRestoreFileModal(files, folderName);
        } else if (result.message.startsWith('NEED_BACKUP_CONFIRM:')) {
            const originalPath = result.message.split(':').slice(1).join(':');
            if (confirm(`当前存档「${originalPath}」未备份，是否需要先备份再恢复？\n\n确定 = 先备份再恢复\n取消 = 直接覆盖恢复`)) {
                const backupResult = await invoke('create_backup', {
                    gameId: selectedGameId, slotId: selectedSlotId,
                    filePaths: getCurrentFilePaths()
                });
                if (!backupResult.success) {
                    alert('备份当前文件失败: ' + backupResult.message);
                }
                const result2 = await invoke('restore_backup', {
                    gameId: selectedGameId, slotId: selectedSlotId,
                    folderName: folderName, skipBackup: false, selectedFiles: null
                });
                if (result2.success) {
                    alert(result2.message);
                } else if (result2.message.startsWith('SELECT_FILES:')) {
                    const fileEntries = result2.message.split(':').slice(1).join(':').split(';;');
                    const files = fileEntries.map(e => {
                        const [name, path] = e.split('|');
                        return { name, path };
                    });
                    showRestoreFileModal(files, folderName);
                } else {
                    alert('恢复失败: ' + result2.message);
                }
            } else {
                const result2 = await invoke('restore_backup', {
                    gameId: selectedGameId, slotId: selectedSlotId,
                    folderName: folderName, skipBackup: true, selectedFiles: null
                });
                if (result2.success) {
                    alert(result2.message);
                } else if (result2.message.startsWith('SELECT_FILES:')) {
                    const fileEntries = result2.message.split(':').slice(1).join(':').split(';;');
                    const files = fileEntries.map(e => {
                        const [name, path] = e.split('|');
                        return { name, path };
                    });
                    showRestoreFileModal(files, folderName);
                } else {
                    alert('恢复失败: ' + result2.message);
                }
            }
            await refreshCurrentHashes();
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

// ==================== 恢复文件选择弹窗 ====================

function showRestoreFileModal(files, folderName) {
    // 移除旧弹窗
    const old = document.getElementById('restoreOverlay');
    if (old) old.remove();

    const overlay = document.createElement('div');
    overlay.id = 'restoreOverlay';
    overlay.className = 'modal-overlay';
    overlay.style.display = 'flex';
    overlay.innerHTML = `<div class="modal" style="width:420px;">
        <div class="modal-header">
            <span class="modal-title">选择要恢复的文件</span>
            <button class="modal-close" id="restoreCloseBtn">&times;</button>
        </div>
        <div class="modal-body">
            <div class="restore-file-list">
                ${files.map((f, i) => `<label class="restore-file-item">
                    <input type="checkbox" data-file="${escapeHtml(f.name)}" checked>
                    <span class="restore-file-name">${escapeHtml(f.name)}</span>
                    <span class="restore-file-path">${escapeHtml(shortenPath(f.path))}</span>
                </label>`).join('')}
            </div>
            <div style="margin-top:12px;display:flex;gap:8px;">
                <button id="restoreSelectAll" class="btn-small" style="flex:0 0 auto;">全选</button>
                <button id="restoreDeselectAll" class="btn-small" style="flex:0 0 auto;">全不选</button>
                <button id="restoreConfirmBtn" style="flex:1;">恢复</button>
            </div>
        </div>
    </div>`;
    document.querySelector('.container').appendChild(overlay);

    const close = () => overlay.remove();
    overlay.querySelector('#restoreCloseBtn').addEventListener('click', close);
    overlay.addEventListener('click', (e) => { if (e.target === overlay) close(); });

    overlay.querySelector('#restoreSelectAll').addEventListener('click', () => {
        overlay.querySelectorAll('.restore-file-item input[type="checkbox"]').forEach(cb => cb.checked = true);
    });
    overlay.querySelector('#restoreDeselectAll').addEventListener('click', () => {
        overlay.querySelectorAll('.restore-file-item input[type="checkbox"]').forEach(cb => cb.checked = false);
    });

    overlay.querySelector('#restoreConfirmBtn').addEventListener('click', async () => {
        const selected = [];
        overlay.querySelectorAll('.restore-file-item input[type="checkbox"]:checked').forEach(cb => {
            selected.push(cb.dataset.file);
        });
        if (selected.length === 0) { alert('请至少选择一个文件'); return; }
        close();
        setButtonLoading(saveBackupBtn, '恢复中...');
        try {
            const result = await invoke('restore_backup', {
                gameId: selectedGameId,
                slotId: selectedSlotId,
                folderName: folderName,
                skipBackup: true,
                selectedFiles: selected
            });
            if (result.success) {
                alert(result.message);
                await refreshCurrentHashes();
                refreshBackupList();
            } else {
                alert('恢复失败: ' + result.message);
            }
        } catch (err) {
            alert('恢复失败: ' + err);
        } finally {
            resetButton(saveBackupBtn, '保存存档');
        }
    });
}
```

- [ ] **Step 4: 更新所有旧引用**

将 `main.js` 中所有 `filePathBySlot` → `filePathsBySlot`，`currentHashBySlot` → `currentHashesBySlot`，`restoreFilePath()` → `restoreFilePaths()`，`refreshCurrentHash()` → `refreshCurrentHashes()`，`saveFilePathToSlot` 调用替换为 `setCurrentFilePaths`。

涉及位置（通过 grep 确认）：
- L314-315: `restoreFilePath()` + `await refreshCurrentHash()` → `restoreFilePaths()` + `await refreshCurrentHashes()`
- L378: `restoreFilePath()` → `restoreFilePaths()`
- L419: `file_path: ''` → `file_paths: []`
- L479: 注释中的 `filePathBySlot / currentHashBySlot` → 更新
- L525: `restoreFilePath()` → `restoreFilePaths()`
- L559: `file_path: ''` → `file_paths: []`
- L610: 注释中的 `filePathBySlot / currentHashBySlot` → 更新
- L1050-1052: `restoreFilePath()` + `refreshCurrentHash()` → `restoreFilePaths()` + `refreshCurrentHashes()`

- [ ] **Step 5: 验证编译**

```bash
cargo build 2>&1
```

Expected: 编译通过。

- [ ] **Step 6: 提交**

```bash
git add src/main.js
git commit -m "feat: adapt backup/restore/list flows for multi-file support

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>"
```

---

### Task 8: HTML — 文件管理区域 DOM 结构调整

**文件:**
- 修改: `src/index.html:62-70` (存档文件输入区域)

- [ ] **Step 1: 替换单个输入框为标签容器 + 操作按钮行**

将 `src/index.html` L62-70 替换为：

```html
            <!-- 存档文件 -->
            <div class="input-group">
                <label>存档文件</label>
                <div class="file-tags" id="fileTags">
                    <!-- 动态生成 .file-tag + .file-tag-add -->
                </div>
                <div class="row" style="margin-top:6px;">
                    <button id="browseFileBtn" class="btn-small">浏览添加</button>
                    <button id="rehashBtn" class="btn-small" title="重算所有文件哈希">重算</button>
                </div>
            </div>
```

注意保留 `id="filePath"` 的隐藏 input 用于兼容（如果其他地方有引用），否则删除。检查 main.js 中对 `filePathInput` 的实际引用——Task 6 Step 4 已移除所有引用，可安全删除。

- [ ] **Step 2: 添加恢复文件选择弹窗容器（骨架）**

在 `</div>` (`.container` 关闭前) 添加注释标记，表示动态弹窗将创建在此处：

```html
    <!-- 恢复文件选择弹窗（JS 动态创建 #restoreOverlay） -->
```

- [ ] **Step 3: 验证编译**

```bash
cargo build 2>&1
```

- [ ] **Step 4: 提交**

```bash
git add src/index.html
git commit -m "feat: restructure file management area for multi-file tag UI

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>"
```

---

### Task 9: CSS — 文件标签 + 恢复弹窗样式

**文件:**
- 修改: `src/styles.css` (追加到文件末尾)

- [ ] **Step 1: 追加文件标签和恢复弹窗样式**

在 `src/styles.css` 末尾追加：

```css
/* ==================== 文件标签 ==================== */
.file-tags {
    display: flex;
    flex-wrap: wrap;
    gap: var(--space-xs);
    align-items: center;
}

.file-tag {
    display: flex;
    align-items: center;
    gap: var(--space-xs);
    padding: 4px 10px;
    background: var(--surface);
    border: 1px solid var(--border);
    border-radius: var(--radius-pill);
    color: var(--text-secondary);
    font-size: var(--font-sm);
    white-space: nowrap;
    flex-shrink: 0;
    max-width: 200px;
    overflow: hidden;
    text-overflow: ellipsis;
}

.file-tag .tag-close {
    font-size: 0.85rem;
    opacity: 0;
    line-height: 1;
    transition: opacity 0.15s;
    color: var(--text-muted);
    cursor: pointer;
    flex-shrink: 0;
}

.file-tag:hover .tag-close { opacity: 1; }
.file-tag .tag-close:hover { color: var(--danger-text); }

.file-tag-add {
    padding: 4px 10px;
    color: var(--text-dim);
    font-size: var(--font-sm);
    white-space: nowrap;
    flex-shrink: 0;
    cursor: pointer;
    background: transparent;
    border: 1px dashed var(--text-dim);
    border-radius: var(--radius-pill);
    width: auto;
    margin: 0;
    line-height: 1;
}

.file-tag-add:hover {
    color: var(--text-secondary);
    border-color: var(--text-muted);
}

/* ==================== 恢复文件选择弹窗 ==================== */
.restore-file-list {
    max-height: 200px;
    overflow-y: auto;
}

.restore-file-item {
    display: flex;
    align-items: center;
    gap: var(--space-sm);
    padding: var(--space-sm) var(--space-xs);
    border-bottom: 1px solid var(--border);
    cursor: pointer;
    font-size: var(--font-sm);
    color: var(--text);
}

.restore-file-item:hover {
    background: var(--surface);
}

.restore-file-item input[type="checkbox"] {
    width: auto;
    margin: 0;
    flex-shrink: 0;
}

.restore-file-name {
    flex-shrink: 0;
    font-weight: 500;
    color: var(--text);
}

.restore-file-path {
    flex: 1;
    color: var(--text-muted);
    font-size: var(--font-xs);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
}
```

- [ ] **Step 2: 验证编译**

```bash
cargo build 2>&1
```

- [ ] **Step 3: 提交**

```bash
git add src/styles.css
git commit -m "style: add file-tag and restore-modal styles using design tokens

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>"
```

---

### Task 10: 端到端验证 + 修复遗漏

- [ ] **Step 1: 编译验证**

```bash
cargo build 2>&1
```

Expected: 零错误零警告。

- [ ] **Step 2: 运行开发服务器验证**

```bash
cargo tauri dev
```

手动验证场景:
1. 创建游戏 + 存档位 → 确认文件标签区域显示 "+" 按钮
2. 点击 "+" 添加 2 个文件 → 确认标签显示
3. 删除一个标签 → 确认移除
4. 配置备份根目录 → 点击"保存存档" → 确认多文件备份成功
5. 查看备份列表 → 确认显示
6. 再次保存（不修改文件）→ 确认"存档未变化，无需重复备份"
7. 恢复 → 确认弹窗可选文件
8. 打开备份文件夹 → 确认所有文件 + meta.json 正确

- [ ] **Step 3: 修复验证中发现的问题**

- [ ] **Step 4: 提交**

```bash
git add -A
git commit -m "chore: final fixes from end-to-end verification

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>"
```
