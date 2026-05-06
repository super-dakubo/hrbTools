# 功能切换与游戏存档管理 — 实现计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 新增 Tab 切换和游戏存档备份管理功能，保持代码结构简单扁平、易于阅读。

**Architecture:** 纯 Tauri 2.0 后端驱动。前端负责 UI 交互（Tab 切换、表单、列表），通过 `invoke` 调用 Rust 命令。Rust 处理文件操作和配置持久化。使用 `rfd` crate 实现系统文件对话框。代码保持在三个前端文件 + 一个 Rust 文件的扁平结构。

**Tech Stack:** Tauri 2.0, Rust (chrono, serde, rfd), vanilla HTML/CSS/JS

**代码组织原则：**
- 不拆分模块，main.rs 中用清晰的分隔注释区分各功能区块
- 前端 JS 用简单函数组织，不引入类或模块
- HTML 用直观的 div 结构，CSS 按组件分区

---

### Task 1: 添加 rfd 依赖

**Files:**
- Modify: `Cargo.toml`

- [ ] **Step 1: 添加 rfd 到 Cargo.toml dependencies**

在 `Cargo.toml` 的 `[dependencies]` 末尾添加一行：

```toml
rfd = "0.17"
```

验证文件内容：
```toml
[package]
name = "hello_world"
version = "0.1.0"
edition = "2024"

[dependencies]
tauri = { version = "2.0"}
serde = { version = "1.0", features = ["derive"] }
serde_json = "1.0"
chrono = { version = "0.4", features = ["serde"] }
chrono-tz = "0.8"
rfd = "0.17"

[build-dependencies]
tauri-build = { version = "2", features = [] }
```

- [ ] **Step 2: 运行 cargo check 验证依赖下载成功**

```bash
cargo check 2>&1
```

Expected: 下载编译 rfd，无错误（可能会有未使用 import 的警告，可忽略）。

- [ ] **Step 3: 提交**

```bash
git add Cargo.toml Cargo.lock
git commit -m "feat: add rfd dependency for file dialogs"
```

---

### Task 2: 添加数据结构、配置系统和工具函数

**Files:**
- Modify: `src/main.rs`（在现有代码之后追加）

- [ ] **Step 1: 在 main.rs 顶部追加新的 import**

在 `use serde::{Deserialize, Serialize};` 之后添加：

```rust
use std::fs;
use std::path::PathBuf;
use tauri::Manager;
```

- [ ] **Step 2: 在 ConvertResponse 结构体之后添加新的数据结构**

```rust
// ==================== 配置 ====================

#[derive(Debug, Serialize, Deserialize, Clone)]
struct AppConfig {
    backup_root: String,
    #[serde(default)]
    game_names: Vec<String>,
}

impl Default for AppConfig {
    fn default() -> Self {
        AppConfig {
            backup_root: String::new(),
            game_names: vec![],
        }
    }
}

// ==================== 备份信息 ====================

#[derive(Debug, Serialize, Deserialize, Clone)]
struct BackupInfo {
    folder_name: String,
    display_name: String,
    created_at: String,
    original_file_path: String,
}

// ==================== 操作结果 ====================

#[derive(Debug, Serialize, Deserialize)]
struct OpResult {
    success: bool,
    message: String,
}
```

- [ ] **Step 3: 在数据结构之后添加配置读写函数**

```rust
// ==================== 配置持久化 ====================

fn config_path(app: &tauri::AppHandle) -> PathBuf {
    app.path()
        .app_data_dir()
        .expect("无法获取应用数据目录")
        .join("config.json")
}

fn load_config(app: &tauri::AppHandle) -> AppConfig {
    let path = config_path(app);
    if path.exists() {
        match fs::read_to_string(&path) {
            Ok(json) => serde_json::from_str(&json).unwrap_or_default(),
            Err(_) => AppConfig::default(),
        }
    } else {
        AppConfig::default()
    }
}

fn save_config(app: &tauri::AppHandle, config: &AppConfig) {
    let path = config_path(app);
    if let Some(parent) = path.parent() {
        let _ = fs::create_dir_all(parent);
    }
    if let Ok(json) = serde_json::to_string_pretty(config) {
        let _ = fs::write(&path, json);
    }
}
```

- [ ] **Step 4: 运行 cargo check**

```bash
cargo check 2>&1
```

Expected: 无错误（可能有 dead_code 警告，正常）。

- [ ] **Step 5: 提交**

```bash
git add src/main.rs
git commit -m "feat: add data structures and config persistence helpers"
```

---

### Task 3: 实现 get_config 和 set_config 命令

**Files:**
- Modify: `src/main.rs`（在 convert_to_timestamp 函数之后追加）

- [ ] **Step 1: 添加 get_config 命令**

```rust
#[tauri::command]
fn get_config(app: tauri::AppHandle) -> AppConfig {
    load_config(&app)
}
```

- [ ] **Step 2: 添加 set_config 命令**

```rust
#[tauri::command]
fn set_config(app: tauri::AppHandle, config: AppConfig) -> OpResult {
    save_config(&app, &config);
    OpResult {
        success: true,
        message: "配置已保存".to_string(),
    }
}
```

- [ ] **Step 3: 在 main() 中注册新命令**

修改 `main()` 函数中的 `invoke_handler`：

```rust
fn main() {
    tauri::Builder::default()
        .invoke_handler(tauri::generate_handler![
            convert_to_timestamp,
            get_config,
            set_config
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
```

- [ ] **Step 4: 运行 cargo check**

```bash
cargo check 2>&1
```

Expected: 无错误。

- [ ] **Step 5: 提交**

```bash
git add src/main.rs
git commit -m "feat: add get_config and set_config commands"
```

---

### Task 4: 实现文件选择命令（pick_file, pick_directory）

**Files:**
- Modify: `src/main.rs`

- [ ] **Step 1: 添加 pick_file 命令**

```rust
#[tauri::command]
fn pick_file() -> Option<String> {
    rfd::FileDialog::new()
        .pick_file()
        .map(|p| p.to_string_lossy().to_string())
}
```

- [ ] **Step 2: 添加 pick_directory 命令**

```rust
#[tauri::command]
fn pick_directory() -> Option<String> {
    rfd::FileDialog::new()
        .pick_folder()
        .map(|p| p.to_string_lossy().to_string())
}
```

- [ ] **Step 3: 在 main() 中注册命令**

更新 `generate_handler!` 宏调用，追加 `pick_file, pick_directory`：

```rust
fn main() {
    tauri::Builder::default()
        .invoke_handler(tauri::generate_handler![
            convert_to_timestamp,
            get_config,
            set_config,
            pick_file,
            pick_directory
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
```

- [ ] **Step 4: 运行 cargo check**

```bash
cargo check 2>&1
```

Expected: 无错误。

- [ ] **Step 5: 提交**

```bash
git add src/main.rs
git commit -m "feat: add pick_file and pick_directory commands"
```

---

### Task 5: 实现 create_backup 命令

**Files:**
- Modify: `src/main.rs`

- [ ] **Step 1: 添加 create_backup 命令**

在 `pick_directory` 命令之后追加：

```rust
#[tauri::command]
fn create_backup(app: tauri::AppHandle, game_name: String, file_path: String) -> OpResult {
    // 1. 读取配置，检查备份目录是否已设置
    let config = load_config(&app);
    if config.backup_root.is_empty() {
        return OpResult {
            success: false,
            message: "请先设置备份目录".to_string(),
        };
    }

    // 2. 检查源文件是否存在
    let source = PathBuf::from(&file_path);
    if !source.exists() {
        return OpResult {
            success: false,
            message: format!("文件不存在: {}", file_path),
        };
    }

    // 3. 获取文件名
    let file_name = match source.file_name() {
        Some(name) => name.to_string_lossy().to_string(),
        None => {
            return OpResult {
                success: false,
                message: "无法获取文件名".to_string(),
            };
        }
    };

    // 4. 生成时间戳文件夹名（冒号替换为横线，避免 Windows 路径问题）
    let now = chrono::Local::now();
    let folder_name = now.format("%Y-%m-%d %H-%M-%S").to_string();
    let display_name = now.format("%Y-%m-%d %H:%M:%S").to_string();

    // 5. 创建备份目录
    let backup_dir = PathBuf::from(&config.backup_root)
        .join(&game_name)
        .join(&folder_name);

    if let Err(e) = fs::create_dir_all(&backup_dir) {
        return OpResult {
            success: false,
            message: format!("创建备份目录失败: {}", e),
        };
    }

    // 6. 复制文件
    let dest = backup_dir.join(&file_name);
    if let Err(e) = fs::copy(&source, &dest) {
        return OpResult {
            success: false,
            message: format!("复制文件失败: {}", e),
        };
    }

    // 7. 写入 meta.json
    let meta = serde_json::json!({
        "original_file_path": file_path,
        "display_name": display_name,
    });

    if let Ok(json) = serde_json::to_string_pretty(&meta) {
        let _ = fs::write(backup_dir.join("meta.json"), json);
    }

    OpResult {
        success: true,
        message: format!("备份成功: {}", folder_name),
    }
}
```

- [ ] **Step 2: 在 main() 中注册命令**

```rust
fn main() {
    tauri::Builder::default()
        .invoke_handler(tauri::generate_handler![
            convert_to_timestamp,
            get_config,
            set_config,
            pick_file,
            pick_directory,
            create_backup
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
```

- [ ] **Step 3: 运行 cargo check**

```bash
cargo check 2>&1
```

Expected: 无错误。

- [ ] **Step 4: 提交**

```bash
git add src/main.rs
git commit -m "feat: add create_backup command"
```

---

### Task 6: 实现 list_backups 命令

**Files:**
- Modify: `src/main.rs`

- [ ] **Step 1: 添加 list_backups 命令**

```rust
#[tauri::command]
fn list_backups(app: tauri::AppHandle, game_name: String) -> Vec<BackupInfo> {
    let config = load_config(&app);
    let game_dir = PathBuf::from(&config.backup_root).join(&game_name);

    if !game_dir.exists() {
        return vec![];
    }

    let mut backups: Vec<BackupInfo> = match fs::read_dir(&game_dir) {
        Ok(entries) => entries
            .filter_map(|entry| {
                let entry = entry.ok()?;
                let folder_name = entry.file_name().to_string_lossy().to_string();

                // 跳过非目录项
                if !entry.file_type().ok()?.is_dir() {
                    return None;
                }

                // 读取 meta.json
                let meta_path = entry.path().join("meta.json");
                let (display_name, original_file_path) = if meta_path.exists() {
                    fs::read_to_string(&meta_path)
                        .ok()
                        .and_then(|json| serde_json::from_str::<serde_json::Value>(&json).ok())
                        .map(|meta| {
                            (
                                meta["display_name"]
                                    .as_str()
                                    .unwrap_or(&folder_name)
                                    .to_string(),
                                meta["original_file_path"]
                                    .as_str()
                                    .unwrap_or("")
                                    .to_string(),
                            )
                        })
                        .unwrap_or_else(|| (folder_name.clone(), String::new()))
                } else {
                    (folder_name.clone(), String::new())
                };

                Some(BackupInfo {
                    folder_name,
                    display_name,
                    created_at: String::new(), // 前端从 folder_name 解析
                    original_file_path,
                })
            })
            .collect(),
        Err(_) => vec![],
    };

    // 按文件夹名倒序排列（最新的在前）
    backups.sort_by(|a, b| b.folder_name.cmp(&a.folder_name));
    backups
}
```

- [ ] **Step 2: 在 main() 中注册命令**

```rust
fn main() {
    tauri::Builder::default()
        .invoke_handler(tauri::generate_handler![
            convert_to_timestamp,
            get_config,
            set_config,
            pick_file,
            pick_directory,
            create_backup,
            list_backups
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
```

- [ ] **Step 3: 运行 cargo check**

```bash
cargo check 2>&1
```

Expected: 无错误。

- [ ] **Step 4: 提交**

```bash
git add src/main.rs
git commit -m "feat: add list_backups command"
```

---

### Task 7: 实现 delete_backup、rename_backup、restore_backup 命令

**Files:**
- Modify: `src/main.rs`

- [ ] **Step 1: 添加 delete_backup 命令**

```rust
#[tauri::command]
fn delete_backup(app: tauri::AppHandle, game_name: String, folder_name: String) -> OpResult {
    let config = load_config(&app);
    let backup_dir = PathBuf::from(&config.backup_root)
        .join(&game_name)
        .join(&folder_name);

    if !backup_dir.exists() {
        return OpResult {
            success: false,
            message: "备份不存在".to_string(),
        };
    }

    match fs::remove_dir_all(&backup_dir) {
        Ok(_) => OpResult {
            success: true,
            message: "备份已删除".to_string(),
        },
        Err(e) => OpResult {
            success: false,
            message: format!("删除失败: {}", e),
        },
    }
}
```

- [ ] **Step 2: 添加 rename_backup 命令**

```rust
#[tauri::command]
fn rename_backup(
    app: tauri::AppHandle,
    game_name: String,
    folder_name: String,
    new_name: String,
) -> OpResult {
    let config = load_config(&app);
    let game_dir = PathBuf::from(&config.backup_root).join(&game_name);
    let old_path = game_dir.join(&folder_name);
    let new_path = game_dir.join(&new_name);

    if !old_path.exists() {
        return OpResult {
            success: false,
            message: "备份不存在".to_string(),
        };
    }

    if new_path.exists() {
        return OpResult {
            success: false,
            message: "该名称已存在".to_string(),
        };
    }

    // 重命名文件夹
    if let Err(e) = fs::rename(&old_path, &new_path) {
        return OpResult {
            success: false,
            message: format!("重命名失败: {}", e),
        };
    }

    // 更新 meta.json 中的 display_name
    let meta_path = new_path.join("meta.json");
    if let Ok(json_str) = fs::read_to_string(&meta_path) {
        if let Ok(mut meta) = serde_json::from_str::<serde_json::Value>(&json_str) {
            meta["display_name"] = serde_json::Value::String(new_name.clone());
            if let Ok(new_json) = serde_json::to_string_pretty(&meta) {
                let _ = fs::write(&meta_path, new_json);
            }
        }
    }

    OpResult {
        success: true,
        message: "重命名成功".to_string(),
    }
}
```

- [ ] **Step 3: 添加 restore_backup 命令**

```rust
#[tauri::command]
fn restore_backup(app: tauri::AppHandle, game_name: String, folder_name: String) -> OpResult {
    let config = load_config(&app);
    let backup_dir = PathBuf::from(&config.backup_root)
        .join(&game_name)
        .join(&folder_name);

    if !backup_dir.exists() {
        return OpResult {
            success: false,
            message: "备份不存在".to_string(),
        };
    }

    // 读取 meta.json 获取原始路径
    let meta_path = backup_dir.join("meta.json");
    let original_path = if meta_path.exists() {
        fs::read_to_string(&meta_path)
            .ok()
            .and_then(|json| serde_json::from_str::<serde_json::Value>(&json).ok())
            .and_then(|meta| {
                meta["original_file_path"]
                    .as_str()
                    .map(|s| s.to_string())
            })
            .unwrap_or_default()
    } else {
        String::new()
    };

    if original_path.is_empty() {
        return OpResult {
            success: false,
            message: "无法获取原始文件路径".to_string(),
        };
    }

    // 找到备份文件夹中的实际文件（排除 meta.json）
    let backup_file = match fs::read_dir(&backup_dir) {
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
        None => {
            return OpResult {
                success: false,
                message: "备份文件夹中无文件".to_string(),
            };
        }
    };

    // 复制文件回原始位置
    match fs::copy(&backup_file, &original_path) {
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

- [ ] **Step 4: 在 main() 中注册全部命令**

```rust
fn main() {
    tauri::Builder::default()
        .invoke_handler(tauri::generate_handler![
            convert_to_timestamp,
            get_config,
            set_config,
            pick_file,
            pick_directory,
            create_backup,
            list_backups,
            delete_backup,
            rename_backup,
            restore_backup
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
```

- [ ] **Step 5: 运行 cargo check**

```bash
cargo check 2>&1
```

Expected: 无错误。

- [ ] **Step 6: 提交**

```bash
git add src/main.rs
git commit -m "feat: add delete, rename, restore backup commands"
```

---

### Task 8: 重构 index.html — 添加 Tab 栏和存档管理面板

**Files:**
- Modify: `src/index.html`

- [ ] **Step 1: 用新 HTML 完全替换 index.html**

```html
<!DOCTYPE html>
<html lang="zh-CN">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>时间转换工具</title>
    <link rel="stylesheet" href="styles.css">
</head>
<body>
    <div class="container">

        <!-- Tab 栏 -->
        <div class="tab-bar">
            <button class="tab active" data-tab="convert">时间转换</button>
            <button class="tab" data-tab="backup">存档管理</button>
        </div>

        <!-- ==================== 时间转换面板 ==================== -->
        <div class="panel active" id="panel-convert">
            <h1>时间字符串 → Unix时间戳</h1>

            <div class="input-group">
                <label>时间字符串</label>
                <input type="text" id="datetimeInput" placeholder="例如: 2025-04-04 15:30:00" value="2025-04-04 15:30:00">
            </div>

            <div class="input-group">
                <label>时区</label>
                <select id="timezoneSelect">
                    <option value="UTC">UTC</option>
                    <option value="Asia/Shanghai" selected>Asia/Shanghai (中国标准时间)</option>
                    <option value="America/New_York">America/New_York (美国东部时间)</option>
                    <option value="Europe/London">Europe/London (伦敦时间)</option>
                    <option value="Asia/Tokyo">Asia/Tokyo (东京时间)</option>
                    <option value="Australia/Sydney">Australia/Sydney (悉尼时间)</option>
                </select>
            </div>

            <button id="convertBtn">转换</button>

            <div class="result">
                <label>Unix时间戳 (秒)</label>
                <div id="timestampResult">—</div>
            </div>

            <div id="errorMsg" class="error"></div>
        </div>

        <!-- ==================== 存档管理面板 ==================== -->
        <div class="panel" id="panel-backup">
            <h1>游戏存档备份</h1>

            <!-- 游戏选择 -->
            <div class="input-group">
                <label>选择游戏</label>
                <div class="row">
                    <select id="gameSelect">
                        <option value="">— 请先新增游戏 —</option>
                    </select>
                    <button id="addGameBtn" class="btn-small">+</button>
                </div>
            </div>

            <!-- 文件选择 -->
            <div class="input-group">
                <label>存档文件</label>
                <div class="row">
                    <input type="text" id="filePath" placeholder="输入路径或点击浏览...">
                    <button id="browseFileBtn" class="btn-small">浏览</button>
                </div>
            </div>

            <!-- 备份目录 + 保存按钮 -->
            <div class="input-group">
                <label>备份位置</label>
                <div class="row backup-path-row">
                    <span id="backupRootDisplay" class="path-hint">未设置</span>
                    <button id="setBackupDirBtn" class="btn-small">设置目录</button>
                </div>
            </div>

            <button id="saveBackupBtn">保存存档</button>

            <div id="backupError" class="error"></div>
            <div id="backupSuccess" class="success"></div>

            <!-- 存档列表 -->
            <div class="backup-list-section">
                <h3>存档列表</h3>
                <div id="backupList" class="backup-list">
                    <div class="empty-hint">请先选择游戏</div>
                </div>
            </div>
        </div>

    </div>

    <script type="module" src="main.js"></script>
</body>
</html>
```

- [ ] **Step 2: 运行 cargo build 检查 Tauri 编译**

```bash
cargo build 2>&1
```

Expected: 编译通过（前端变更不影响 Rust 编译）。

- [ ] **Step 3: 提交**

```bash
git add src/index.html
git commit -m "feat: redesign HTML with tab bar and backup panel"
```

---

### Task 9: 重构 styles.css — 添加新组件样式

**Files:**
- Modify: `src/styles.css`

- [ ] **Step 1: 用新 CSS 完全替换 styles.css**

```css
/* ==================== 基础重置 ==================== */
* {
    box-sizing: border-box;
    font-family: system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif;
}

body {
    background: #f0f2f5;
    display: flex;
    justify-content: center;
    align-items: center;
    min-height: 100vh;
    margin: 0;
    padding: 20px;
}

.container {
    background: white;
    border-radius: 24px;
    box-shadow: 0 8px 20px rgba(0,0,0,0.1);
    padding: 2rem;
    width: 100%;
    max-width: 520px;
}

/* ==================== Tab 栏 ==================== */
.tab-bar {
    display: flex;
    gap: 0;
    margin-bottom: 1.5rem;
    border-bottom: 2px solid #e5e7eb;
}

.tab {
    flex: 1;
    background: none;
    border: none;
    padding: 0.6rem 1rem;
    font-size: 1rem;
    font-weight: 600;
    color: #6b7280;
    cursor: pointer;
    border-bottom: 2px solid transparent;
    margin-bottom: -2px;
    transition: color 0.2s, border-color 0.2s;
    border-radius: 0;
}

.tab:hover {
    color: #374151;
}

.tab.active {
    color: #3b82f6;
    border-bottom-color: #3b82f6;
}

/* ==================== 面板 ==================== */
.panel {
    display: none;
}

.panel.active {
    display: block;
}

/* ==================== 共用组件 ==================== */
h1 {
    font-size: 1.4rem;
    margin-top: 0;
    margin-bottom: 1.2rem;
    text-align: center;
    color: #1f2937;
}

h3 {
    font-size: 1rem;
    color: #374151;
    margin-bottom: 0.5rem;
}

.input-group {
    margin-bottom: 1rem;
}

label {
    display: block;
    font-weight: 600;
    margin-bottom: 0.4rem;
    color: #374151;
}

input, select {
    width: 100%;
    padding: 0.6rem 0.8rem;
    border: 1px solid #d1d5db;
    border-radius: 10px;
    font-size: 0.95rem;
    transition: 0.2s;
}

input:focus, select:focus {
    outline: none;
    border-color: #3b82f6;
    box-shadow: 0 0 0 3px rgba(59,130,246,0.2);
}

button {
    background: #3b82f6;
    color: white;
    border: none;
    width: 100%;
    padding: 0.7rem;
    font-size: 1rem;
    font-weight: 600;
    border-radius: 40px;
    cursor: pointer;
    transition: background 0.2s;
    margin-top: 0.3rem;
}

button:hover {
    background: #2563eb;
}

/* 行内布局（输入框+按钮） */
.row {
    display: flex;
    gap: 0.5rem;
    align-items: center;
}

.row input,
.row select {
    flex: 1;
}

/* 小按钮 */
.btn-small {
    width: auto;
    padding: 0.5rem 1rem;
    font-size: 0.9rem;
    flex-shrink: 0;
    margin-top: 0;
}

/* 危险操作按钮 */
.btn-danger {
    background: #ef4444;
    width: auto;
    padding: 0.3rem 0.7rem;
    font-size: 0.85rem;
    margin-top: 0;
}

.btn-danger:hover {
    background: #dc2626;
}

/* ==================== 时间转换面板 ==================== */
.result {
    margin-top: 1.2rem;
    background: #f9fafb;
    border-radius: 16px;
    padding: 1rem;
    text-align: center;
}

.result label {
    margin-bottom: 0.25rem;
    color: #4b5563;
}

#timestampResult {
    font-size: 1.8rem;
    font-weight: 700;
    color: #0f172a;
    word-break: break-all;
    font-family: monospace;
}

/* ==================== 消息提示 ==================== */
.error {
    color: #dc2626;
    background: #fee2e2;
    border-radius: 10px;
    padding: 0.5rem;
    margin-top: 0.8rem;
    font-size: 0.9rem;
    text-align: center;
    display: none;
}

.success {
    color: #16a34a;
    background: #dcfce7;
    border-radius: 10px;
    padding: 0.5rem;
    margin-top: 0.8rem;
    font-size: 0.9rem;
    text-align: center;
    display: none;
}

/* ==================== 存档管理面板 ==================== */
.path-hint {
    color: #9ca3af;
    font-size: 0.85rem;
    padding: 0.5rem;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
}

.backup-path-row {
    background: #f9fafb;
    border-radius: 10px;
    padding: 0.3rem 0.3rem 0.3rem 0.6rem;
    border: 1px solid #e5e7eb;
}

/* ==================== 存档列表 ==================== */
.backup-list-section {
    margin-top: 1.5rem;
}

.backup-list {
    max-height: 300px;
    overflow-y: auto;
}

.empty-hint {
    text-align: center;
    color: #9ca3af;
    padding: 1.5rem;
    font-size: 0.9rem;
}

.backup-item {
    display: flex;
    align-items: center;
    gap: 0.4rem;
    padding: 0.5rem 0.6rem;
    border-bottom: 1px solid #f3f4f6;
    font-size: 0.9rem;
}

.backup-item:hover {
    background: #f9fafb;
}

.backup-item .name {
    flex: 1;
    color: #1f2937;
}

.backup-item .original-path {
    font-size: 0.75rem;
    color: #9ca3af;
    max-width: 120px;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
}
```

- [ ] **Step 2: 提交**

```bash
git add src/styles.css
git commit -m "feat: add tab and backup panel styles"
```

---

### Task 10: 重写 main.js — Tab 切换 + 完整备份逻辑

**Files:**
- Modify: `src/main.js`

- [ ] **Step 1: 用新 JS 完全替换 main.js**

```javascript
import { invoke } from '@tauri-apps/api/core';

// ==================== DOM 引用 ====================

// Tab 切换
const tabs = document.querySelectorAll('.tab');
const panels = document.querySelectorAll('.panel');

// 时间转换面板
const datetimeInput = document.getElementById('datetimeInput');
const timezoneSelect = document.getElementById('timezoneSelect');
const convertBtn = document.getElementById('convertBtn');
const timestampResult = document.getElementById('timestampResult');
const errorMsgDiv = document.getElementById('errorMsg');

// 存档管理面板
const gameSelect = document.getElementById('gameSelect');
const addGameBtn = document.getElementById('addGameBtn');
const filePathInput = document.getElementById('filePath');
const browseFileBtn = document.getElementById('browseFileBtn');
const backupRootDisplay = document.getElementById('backupRootDisplay');
const setBackupDirBtn = document.getElementById('setBackupDirBtn');
const saveBackupBtn = document.getElementById('saveBackupBtn');
const backupError = document.getElementById('backupError');
const backupSuccess = document.getElementById('backupSuccess');
const backupList = document.getElementById('backupList');

// ==================== Tab 切换 ====================

tabs.forEach(tab => {
    tab.addEventListener('click', () => {
        tabs.forEach(t => t.classList.remove('active'));
        panels.forEach(p => p.classList.remove('active'));
        tab.classList.add('active');
        const target = tab.dataset.tab;
        document.getElementById(`panel-${target}`).classList.add('active');
        if (target === 'backup') {
            refreshBackupList();
        }
    });
});

// ==================== 时间转换 ====================

async function convert() {
    errorMsgDiv.style.display = 'none';
    timestampResult.innerText = '转换中...';

    const datetimeStr = datetimeInput.value.trim();
    const timezone = timezoneSelect.value;

    if (!datetimeStr) {
        showConvertError('请输入时间字符串');
        return;
    }

    try {
        const response = await invoke('convert_to_timestamp', {
            request: {
                datetime_str: datetimeStr,
                timezone: timezone
            }
        });

        if (response.success) {
            timestampResult.innerText = response.timestamp;
        } else {
            showConvertError(response.error);
            timestampResult.innerText = '—';
        }
    } catch (err) {
        showConvertError(`调用失败: ${err}`);
        timestampResult.innerText = '—';
    }
}

function showConvertError(msg) {
    errorMsgDiv.innerText = msg;
    errorMsgDiv.style.display = 'block';
}

convertBtn.addEventListener('click', convert);
datetimeInput.addEventListener('keypress', (e) => {
    if (e.key === 'Enter') convert();
});

// ==================== 配置管理 ====================

let currentConfig = { backup_root: '', game_names: [] };

async function loadConfig() {
    currentConfig = await invoke('get_config');
    updateBackupRootDisplay();
    updateGameSelect();
}

async function saveConfig() {
    await invoke('set_config', { config: currentConfig });
}

function updateBackupRootDisplay() {
    if (currentConfig.backup_root) {
        backupRootDisplay.textContent = currentConfig.backup_root;
        backupRootDisplay.style.color = '#374151';
    } else {
        backupRootDisplay.textContent = '未设置';
        backupRootDisplay.style.color = '#9ca3af';
    }
}

// ==================== 游戏管理 ====================

function updateGameSelect() {
    gameSelect.innerHTML = '';
    if (currentConfig.game_names.length === 0) {
        const opt = document.createElement('option');
        opt.value = '';
        opt.textContent = '— 请先新增游戏 —';
        gameSelect.appendChild(opt);
    } else {
        currentConfig.game_names.forEach(name => {
            const opt = document.createElement('option');
            opt.value = name;
            opt.textContent = name;
            gameSelect.appendChild(opt);
        });
    }
    // 恢复之前的选中
    const saved = gameSelect.dataset.selected;
    if (saved && currentConfig.game_names.includes(saved)) {
        gameSelect.value = saved;
    }
}

addGameBtn.addEventListener('click', async () => {
    const name = prompt('输入游戏名称:');
    if (!name || !name.trim()) return;
    const trimmed = name.trim();
    if (currentConfig.game_names.includes(trimmed)) {
        alert('该游戏名已存在');
        return;
    }
    currentConfig.game_names.push(trimmed);
    await saveConfig();
    updateGameSelect();
    gameSelect.value = trimmed;
    gameSelect.dataset.selected = trimmed;
    refreshBackupList();
});

gameSelect.addEventListener('change', () => {
    gameSelect.dataset.selected = gameSelect.value;
    refreshBackupList();
});

// ==================== 文件选择 ====================

browseFileBtn.addEventListener('click', async () => {
    const path = await invoke('pick_file');
    if (path) {
        filePathInput.value = path;
    }
});

// ==================== 备份目录设置 ====================

setBackupDirBtn.addEventListener('click', async () => {
    const dir = await invoke('pick_directory');
    if (dir) {
        currentConfig.backup_root = dir;
        await saveConfig();
        updateBackupRootDisplay();
    }
});

// ==================== 备份操作 ====================

saveBackupBtn.addEventListener('click', async () => {
    hideMessages();
    const gameName = gameSelect.value;
    const filePath = filePathInput.value.trim();

    if (!gameName) {
        showBackupError('请先选择或新增游戏');
        return;
    }
    if (!filePath) {
        showBackupError('请输入或选择存档文件路径');
        return;
    }
    if (!currentConfig.backup_root) {
        showBackupError('请先设置备份目录');
        return;
    }

    saveBackupBtn.disabled = true;
    saveBackupBtn.textContent = '保存中...';

    try {
        const result = await invoke('create_backup', {
            game_name: gameName,
            file_path: filePath
        });
        if (result.success) {
            showBackupSuccess(result.message);
            filePathInput.value = '';
            refreshBackupList();
        } else {
            showBackupError(result.message);
        }
    } catch (err) {
        showBackupError(`备份失败: ${err}`);
    } finally {
        saveBackupBtn.disabled = false;
        saveBackupBtn.textContent = '保存存档';
    }
});

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

// ==================== 存档列表 ====================

async function refreshBackupList() {
    const gameName = gameSelect.value;
    if (!gameName) {
        backupList.innerHTML = '<div class="empty-hint">请先选择游戏</div>';
        return;
    }

    try {
        const backups = await invoke('list_backups', { game_name: gameName });
        if (backups.length === 0) {
            backupList.innerHTML = '<div class="empty-hint">暂无备份</div>';
            return;
        }

        backupList.innerHTML = backups.map(b => `
            <div class="backup-item">
                <span class="name">${escapeHtml(b.display_name)}</span>
                <span class="original-path" title="${escapeHtml(b.original_file_path)}">${escapeHtml(shortenPath(b.original_file_path))}</span>
                <button class="btn-small" onclick="restoreBackup('${escapeHtml(b.folder_name)}')">恢复</button>
                <button class="btn-small" onclick="renameBackup('${escapeHtml(b.folder_name)}', '${escapeHtml(b.display_name)}')">重命名</button>
                <button class="btn-danger" onclick="deleteBackup('${escapeHtml(b.folder_name)}')">删除</button>
            </div>
        `).join('');
    } catch (err) {
        backupList.innerHTML = `<div class="empty-hint">加载失败: ${err}</div>`;
    }
}

// ==================== 备份管理操作 ====================

window.restoreBackup = async function (folderName) {
    const gameName = gameSelect.value;
    if (!confirm('确定要将此备份恢复到原文件位置吗？将覆盖当前文件。')) return;

    try {
        const result = await invoke('restore_backup', {
            game_name: gameName,
            folder_name: folderName
        });
        if (result.success) {
            alert(result.message);
        } else {
            alert('恢复失败: ' + result.message);
        }
    } catch (err) {
        alert('恢复失败: ' + err);
    }
};

window.renameBackup = async function (folderName, currentName) {
    const newName = prompt('输入新名称:', currentName);
    if (!newName || !newName.trim()) return;

    const gameName = gameSelect.value;
    try {
        const result = await invoke('rename_backup', {
            game_name: gameName,
            folder_name: folderName,
            new_name: newName.trim()
        });
        if (result.success) {
            refreshBackupList();
        } else {
            alert('重命名失败: ' + result.message);
        }
    } catch (err) {
        alert('重命名失败: ' + err);
    }
};

window.deleteBackup = async function (folderName) {
    const gameName = gameSelect.value;
    if (!confirm('确定要删除此备份吗？此操作不可恢复。')) return;

    try {
        const result = await invoke('delete_backup', {
            game_name: gameName,
            folder_name: folderName
        });
        if (result.success) {
            refreshBackupList();
        } else {
            alert('删除失败: ' + result.message);
        }
    } catch (err) {
        alert('删除失败: ' + err);
    }
};

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

// ==================== 启动 ====================

loadConfig();
```

- [ ] **Step 2: 运行 cargo build**

```bash
cargo build 2>&1
```

Expected: 编译通过。

- [ ] **Step 3: 提交**

```bash
git add src/main.js
git commit -m "feat: implement tab switching and backup management JS logic"
```

---

### Task 11: 最终构建验证

**Files:**
- None (验证步骤)

- [ ] **Step 1: 运行 cargo build 确认全部编译通过**

```bash
cargo build 2>&1
```

Expected: `Finished dev profile`，无任何错误。

- [ ] **Step 2: 检查 git status 确认所有文件已提交**

```bash
git status
```

Expected: `nothing to commit, working tree clean`

- [ ] **Step 3: 如所有步骤通过，标记实现完成**

---

## 文件改动总览

| 文件 | 改动量 | 说明 |
|------|--------|------|
| `Cargo.toml` | +1 行 | 新增 rfd 依赖 |
| `src/main.rs` | +~250 行 | 9 个新命令 + 数据结构 + 配置系统 |
| `src/index.html` | 重写 | Tab 栏 + 双面板结构 |
| `src/styles.css` | 重写 | 新增 Tab、列表、按钮等样式 |
| `src/main.js` | 重写 | Tab 切换 + 完整备份 CRUD 逻辑 |

## 代码结构说明

所有 Rust 代码保持在单个 `main.rs` 中，用清晰的分隔注释区分区块：

```
main.rs
├── 平台属性
├── imports
├── 时间转换功能（现有）
│   ├── ConvertRequest / ConvertResponse
│   └── convert_to_timestamp
├── 配置系统
│   ├── AppConfig + Default
│   ├── BackupInfo
│   ├── OpResult
│   └── config_path / load_config / save_config
├── 命令：get_config / set_config
├── 命令：pick_file / pick_directory
├── 命令：create_backup
├── 命令：list_backups
├── 命令：delete_backup / rename_backup / restore_backup
└── main()
```
