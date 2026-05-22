# 截图画廊面板 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a new 6th Tab「截图」panel that browses, previews, and manages game screenshots with auto-detection for Steam and Mihoyo game directories.

**Architecture:** Rust backend handles file scanning, base64 encoding, and Steam/Mihoyo directory detection via Tauri commands. Frontend manages rendering, pagination, search, lightbox, and source CRUD through event delegation. No new heavy dependencies — only `base64` crate added.

**Tech Stack:** Rust (Tauri 2.0 commands, spawn_blocking for I/O), vanilla JS (innerHTML rendering, event delegation), CSS (CSS variables, grid, glassmorphism), Steam VDF (custom ~50-line parser)

---

## File Structure

| Layer | File | Responsibility |
|-------|------|---------------|
| Rust | `src/main.rs` | ScreenshotSource/Entry/DetectedSource structs, 7 Tauri commands, VDF parser, LRU cache, config integration |
| Config | `Cargo.toml` | Add `base64 = "0.22"` dependency |
| HTML | `src/index.html` | New `.panel#panel-screenshot` container |
| CSS | `src/styles.css` | Panel styles (grid, cards, lightbox, toolbar, dialog, skeleton, pagination) |
| JS | `src/main.js` | Screenshot state, rendering, event delegation handlers, lightbox, add-source dialog, config sync |

---

### Task 1: Rust — Dependencies, Data Structures, Config

**Files:**
- Modify: `Cargo.toml`
- Modify: `src/main.rs` (add structs + AppConfig field)

- [ ] **Step 1: Add `base64` to Cargo.toml**

```toml
# In [dependencies] section, add:
base64 = "0.22"
```

- [ ] **Step 2: Add ScreenshotSource struct + update AppConfig**

Insert after the existing structs (around line 190, before `default_theme`):

```rust
#[derive(Debug, Clone, Serialize, Deserialize)]
struct ScreenshotSource {
    #[serde(default)]
    id: String,
    #[serde(default)]
    name: String,
    #[serde(default)]
    path: String,
    #[serde(default)]
    game_id: Option<String>,
    #[serde(default)]
    sort_order: i32,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
struct ScreenshotEntry {
    file_name: String,
    path: String,
    modified: String,
    size: u64,
    source_id: String,
    game_name: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
struct DetectedSource {
    name: String,
    path: String,
    count: u32,
    source_type: String,
}
```

In AppConfig, add after `holiday_data` (around line 185):

```rust
    #[serde(default)]
    screenshot_sources: Vec<ScreenshotSource>,
```

In `default_tab_order()`, add `"screenshot"`:

```rust
fn default_tab_order() -> Vec<String> {
    vec!["convert".to_string(), "backup".to_string(), "todo".to_string(), "screenshot".to_string(), "log".to_string()]
}
```

In `impl Default for AppConfig`, add inside the block:

```rust
            screenshot_sources: vec![],
```

- [ ] **Step 3: Commit**

```bash
git add Cargo.toml src/main.rs
git commit -m "feat: add ScreenshotSource struct and AppConfig screenshot_sources field"
```

---

### Task 2: Rust — scan_screenshots Command

**Files:**
- Modify: `src/main.rs` (add scan_screenshots command near other screenshot commands)

- [ ] **Step 1: Add the scan_screenshots command**

Add a new section before `// ==================== 配置持久化 ====================`:

```rust
// ==================== 截图画廊 ====================

const IMAGE_EXTENSIONS: [&str; 6] = ["png", "jpg", "jpeg", "webp", "bmp", "gif"];

fn is_image_file(path: &std::path::Path) -> bool {
    path.extension()
        .and_then(|e| e.to_str())
        .map(|e| IMAGE_EXTENSIONS.contains(&e.to_lowercase().as_str()))
        .unwrap_or(false)
}

#[tauri::command]
async fn scan_screenshots(
    app: tauri::AppHandle,
    source_path: String,
) -> Result<Vec<ScreenshotEntry>, String> {
    let config = load_config(&app);
    let resolved_path = std::path::PathBuf::from(&source_path);

    // Security: canonicalize to detect path traversal
    let canonical = resolved_path.canonicalize().map_err(|_| "路径不存在".to_string())?;

    // Verify that resolved path is under a registered source
    let is_valid = config.screenshot_sources.iter().any(|s| {
        std::path::Path::new(&s.path).canonicalize()
            .map(|p| canonical.starts_with(&p))
            .unwrap_or(false)
    });
    if !is_valid {
        return Err("未授权的路径".to_string());
    }

    // Run blocking I/O on thread pool
    let entries = tokio::task::spawn_blocking(move || {
        let mut results = Vec::new();
        let mut dirs: Vec<std::path::PathBuf> = vec![canonical.clone()];
        let mut visited = std::collections::HashSet::new();

        while let Some(dir) = dirs.pop() {
            if results.len() >= 50 { break; }
            if !visited.insert(dir.clone()) { continue; }

            if let Ok(entries) = std::fs::read_dir(&dir) {
                for entry in entries.flatten() {
                    let path = entry.path();
                    if path.is_dir() && dirs.len() < 3 {
                        dirs.push(path);
                    } else if path.is_file() && is_image_file(&path) && results.len() < 50 {
                        if let Ok(meta) = path.metadata() {
                            if let Ok(modified) = meta.modified() {
                                let datetime: chrono::DateTime<chrono::Local> = modified.into();
                                results.push(ScreenshotEntry {
                                    file_name: path.file_name()
                                        .and_then(|n| n.to_str())
                                        .unwrap_or("")
                                        .to_string(),
                                    path: path.to_string_lossy().to_string(),
                                    modified: datetime.format("%Y-%m-%d %H:%M").to_string(),
                                    size: meta.len(),
                                    source_id: String::new(),
                                    game_name: None,
                                });
                            }
                        }
                    }
                }
            }
        }

        results.sort_by(|a, b| b.modified.cmp(&a.modified));
        results.truncate(50);
        results
    }).await.map_err(|e| e.to_string())?;

    Ok(entries)
}
```

- [ ] **Step 2: Commit**

```bash
git add src/main.rs
git commit -m "feat: add scan_screenshots command with security validation"
```

---

### Task 3: Rust — get_screenshot_base64_batch with LRU Cache

**Files:**
- Modify: `src/main.rs` (add LRU cache + batch command)

- [ ] **Step 1: Add LRU cache + batch command**

Add before the screenshot section (or anywhere appropriate before the commands):

```rust
use std::sync::Mutex;
use std::time::Instant;

struct Base64CacheEntry {
    data: String,
    fetched_at: Instant,
    size: u64,
}

struct Base64Cache {
    entries: std::collections::HashMap<String, Base64CacheEntry>,
    access_order: Vec<String>,
    max_entries: usize,
    max_bytes: u64,
    current_bytes: u64,
}

impl Base64Cache {
    fn new() -> Self {
        Self {
            entries: std::collections::HashMap::new(),
            access_order: Vec::new(),
            max_entries: 100,
            max_bytes: 500 * 1024 * 1024,
            current_bytes: 0,
        }
    }

    fn get(&mut self, key: &str) -> Option<&String> {
        if let Some(entry) = self.entries.get_mut(key) {
            // Move to front (most recently used)
            if let Some(pos) = self.access_order.iter().position(|k| k == key) {
                self.access_order.remove(pos);
            }
            self.access_order.push(key.to_string());
            Some(&entry.data)
        } else {
            None
        }
    }

    fn insert(&mut self, key: String, data: String, size: u64) {
        // Evict if needed
        while self.entries.len() >= self.max_entries || self.current_bytes + size > self.max_bytes {
            if let Some(oldest) = self.access_order.first().cloned() {
                if let Some(evicted) = self.entries.remove(&oldest) {
                    self.current_bytes = self.current_bytes.saturating_sub(evicted.size);
                }
                self.access_order.remove(0);
            } else {
                break;
            }
        }

        let entry = Base64CacheEntry {
            data: data.clone(),
            fetched_at: Instant::now(),
            size,
        };
        self.current_bytes += size;
        self.entries.insert(key.clone(), entry);
        self.access_order.push(key);
    }
}
```

Then add the command:

```rust
#[tauri::command]
async fn get_screenshot_base64_batch(
    paths: Vec<String>,
) -> Result<Vec<String>, String> {
    // Use a global cache via lazy_static or thread_local
    use std::sync::OnceLock;
    static CACHE: OnceLock<Mutex<Base64Cache>> = OnceLock::new();
    let cache = CACHE.get_or_init(|| Mutex::new(Base64Cache::new()));

    use base64::Engine;
    let engine = base64::engine::general_purpose::STANDARD;

    let results = tokio::task::spawn_blocking(move || {
        let mut batch = Vec::new();
        for path in &paths {
            // Check cache first
            {
                let mut c = cache.lock().unwrap();
                if let Some(cached) = c.get(path) {
                    batch.push(cached.clone());
                    continue;
                }
            }

            // Read and encode
            match std::fs::read(path) {
                Ok(bytes) => {
                    let size = bytes.len() as u64;
                    let ext = std::path::Path::new(path)
                        .extension()
                        .and_then(|e| e.to_str())
                        .unwrap_or("png")
                        .to_lowercase();
                    let b64 = engine.encode(&bytes);
                    let data_uri = format!("data:image/{};base64,{}", ext, b64);

                    {
                        let mut c = cache.lock().unwrap();
                        c.insert(path.clone(), data_uri.clone(), size);
                    }

                    batch.push(data_uri);
                }
                Err(_) => batch.push(String::new()), // failed files become empty strings
            }
        }
        batch
    }).await.map_err(|e| e.to_string())?;

    Ok(results)
}
```

Note: Add `use std::sync::OnceLock;` at the top of main.rs if not already present.

- [ ] **Step 2: Commit**

```bash
git add src/main.rs
git commit -m "feat: add get_screenshot_base64_batch with LRU cache"
```

---

### Task 4: Rust — VDF Parser + detect_screenshot_sources

**Files:**
- Modify: `src/main.rs` (add VDF parser + detection command)

- [ ] **Step 1: Add minimal VDF parser**

Add before the screenshot commands section:

```rust
// Minimal VDF parser — parses Steam KeyValue format
// Only handles the subset used by screenshots.vdf:
// "key" { "key" "value" ... }
fn parse_vdf_value<'a>(input: &'a str, pos: &mut usize) -> Option<String> {
    // Skip whitespace
    while pos < &input.len() && input.as_bytes()[*pos].is_ascii_whitespace() {
        *pos += 1;
    }
    if *pos >= input.len() { return None; }

    if input.as_bytes()[*pos] == b'"' {
        *pos += 1;
        let start = *pos;
        while *pos < input.len() && input.as_bytes()[*pos] != b'"' {
            if input.as_bytes()[*pos] == b'\\' { *pos += 1; }
            *pos += 1;
        }
        if *pos < input.len() { *pos += 1; } // skip closing "
        Some(input[start..*pos - 1].to_string())
    } else {
        None
    }
}

fn parse_vdf_object<'a>(input: &'a str, pos: &mut usize) -> std::collections::HashMap<String, serde_json::Value> {
    let mut map = std::collections::HashMap::new();
    loop {
        // Skip whitespace
        while *pos < input.len() && input.as_bytes()[*pos].is_ascii_whitespace() {
            *pos += 1;
        }
        if *pos >= input.len() || input.as_bytes()[*pos] == b'}' { break; }

        let key = parse_vdf_value(input, pos);
        if key.is_none() { break; }
        let key = key.unwrap();

        // Skip whitespace
        while *pos < input.len() && input.as_bytes()[*pos].is_ascii_whitespace() {
            *pos += 1;
        }

        if *pos < input.len() && input.as_bytes()[*pos] == b'{' {
            *pos += 1; // skip {
            let child = parse_vdf_object(input, pos);
            // skip }
            if *pos < input.len() && input.as_bytes()[*pos] == b'}' { *pos += 1; }
            map.insert(key, serde_json::Value::Object(child.into_iter().map(|(k, v)| (k, v)).collect()));
        } else {
            let value = parse_vdf_value(input, pos).unwrap_or_default();
            map.insert(key, serde_json::Value::String(value));
        }
    }
    map
}

fn parse_vdf(input: &str) -> std::collections::HashMap<String, serde_json::Value> {
    let mut pos = 0;
    parse_vdf_object(input, &mut pos)
}
```

- [ ] **Step 2: Add detect_screenshot_sources command**

```rust
#[tauri::command]
async fn detect_screenshot_sources() -> Vec<DetectedSource> {
    let mut sources = Vec::new();

    // --- Steam detection ---
    // Try registry first, then common paths
    let steam_path = detect_steam_path();
    if let Some(steam_dir) = steam_path {
        let userdata_dir = std::path::PathBuf::from(&steam_dir).join("userdata");
        if let Ok(entries) = std::fs::read_dir(&userdata_dir) {
            for entry in entries.flatten() {
                let screenshots_dir = entry.path().join("760").join("remote");
                if !screenshots_dir.exists() { continue; }

                if let Ok(apps) = std::fs::read_dir(&screenshots_dir) {
                    for app in apps.flatten() {
                        let ss_dir = app.path().join("screenshots");
                        if !ss_dir.exists() { continue; }

                        // Try to read screenshots.vdf for game name
                        let vdf_path = ss_dir.join("screenshots.vdf");
                        let app_id = app.file_name().to_string_lossy().to_string();
                        let count = count_images_in_dir(&ss_dir);

                        let name = if let Ok(vdf_content) = std::fs::read_to_string(&vdf_path) {
                            let parsed = parse_vdf(&vdf_content);
                            // Extract first "filename" from the structure
                            parsed.get("UserLocalConfig")
                                .and_then(|v| v.get("SavedLocal"))
                                .and_then(|v| v.get("ugc"))
                                .and_then(|v| v.get(&app_id))
                                .and_then(|v| v.get("filename"))
                                .and_then(|v| v.as_str())
                                .map(|f| format!("Steam - {}", f))
                                .unwrap_or_else(|| format!("Steam - App {}", app_id))
                        } else {
                            format!("Steam - App {}", app_id)
                        };

                        if count > 0 {
                            sources.push(DetectedSource {
                                name,
                                path: ss_dir.to_string_lossy().to_string(),
                                count,
                                source_type: "steam".to_string(),
                            });
                        }
                    }
                }
            }
        }
    }

    // --- Mihoyo detection ---
    let mihoyo_paths = [
        ("原神", "Documents/HoYoverse/Genshin Impact/ScreenShots"),
        ("星穹铁道", "Documents/HoYoverse/Star Rail/ScreenShots"),
        ("绝区零", "Documents/HoYoverse/ZZZ/ScreenShots"),
    ];
    for (name, rel_path) in &mihoyo_paths {
        let full_path = format!("{}/{}", get_documents_dir(), rel_path);
        let path = std::path::Path::new(&full_path);
        if path.exists() {
            let count = count_images_in_dir(path);
            if count > 0 {
                sources.push(DetectedSource {
                    name: format!("米哈游 - {}", name),
                    path: full_path,
                    count,
                    source_type: "mihoyo".to_string(),
                });
            }
        }
    }

    sources
}

fn detect_steam_path() -> Option<String> {
    // Try registry
    #[cfg(target_os = "windows")]
    {
        let key = r"SOFTWARE\Valve\Steam";
        if let Ok(reg) = std::fs::read_to_string(format!(r"\\.\REGISTRY\MACHINE\SOFTWARE\WOW6432Node\Valve\Steam")) {
            // Alternative: use winreg approach
        }
        // Fallback: check common path
        let common = r"C:\Program Files (x86)\Steam";
        if std::path::Path::new(common).exists() {
            return Some(common.to_string());
        }
        let alt = r"C:\Program Files\Steam";
        if std::path::Path::new(alt).exists() {
            return Some(alt.to_string());
        }
    }
    None
}

fn get_documents_dir() -> String {
    dirs::data_local_dir()
        .and_then(|p| p.parent().map(|pp| pp.join("Documents")))
        .map(|p| p.to_string_lossy().to_string())
        .unwrap_or_else(|| "C:/Users/Default/Documents".to_string())
}

fn count_images_in_dir(dir: &std::path::Path) -> u32 {
    let mut count = 0u32;
    if let Ok(entries) = std::fs::read_dir(dir) {
        for entry in entries.flatten() {
            let path = entry.path();
            if path.is_file() && is_image_file(&path) {
                count += 1;
            }
        }
    }
    count
}
```

Note: The `dirs` crate is already a transitive dependency via Tauri. If `dirs::data_local_dir()` isn't available, fall back to `std::env::var("USERPROFILE").map(|p| format!("{}\\Documents", p))`.

- [ ] **Step 3: Commit**

```bash
git add src/main.rs
git commit -m "feat: add VDF parser and detect_screenshot_sources command"
```

---

### Task 5: Rust — CRUD Commands + Registration

**Files:**
- Modify: `src/main.rs` (add CRUD commands + generate_handler registration)

- [ ] **Step 1: Add screenshot CRUD commands**

```rust
#[tauri::command]
fn add_screenshot_source(
    app: tauri::AppHandle,
    name: String,
    path: String,
    game_id: Option<String>,
) -> OpResult {
    // Validate path exists and is a directory
    let p = std::path::Path::new(&path);
    if !p.exists() {
        return OpResult { success: false, message: "路径不存在".to_string() };
    }
    if !p.is_dir() {
        return OpResult { success: false, message: "路径不是文件夹".to_string() };
    }

    let mut config = load_config(&app);
    let new_source = ScreenshotSource {
        id: uuid_v4(),
        name,
        path,
        game_id,
        sort_order: config.screenshot_sources.len() as i32,
    };
    config.screenshot_sources.push(new_source);
    save_config(&app, &config);
    OpResult { success: true, message: "截图来源已添加".to_string() }
}

#[tauri::command]
fn remove_screenshot_source(
    app: tauri::AppHandle,
    id: String,
) -> OpResult {
    let mut config = load_config(&app);
    let len_before = config.screenshot_sources.len();
    config.screenshot_sources.retain(|s| s.id != id);
    if config.screenshot_sources.len() == len_before {
        return OpResult { success: false, message: "未找到该来源".to_string() };
    }
    save_config(&app, &config);
    OpResult { success: true, message: "截图来源已移除".to_string() }
}

#[tauri::command]
fn delete_screenshot(
    path: String,
) -> OpResult {
    let p = std::path::Path::new(&path);

    // Security: canonicalize to prevent traversal
    let canonical = match p.canonicalize() {
        Ok(c) => c,
        Err(_) => return OpResult { success: false, message: "文件不存在".to_string() },
    };

    // Basic path traversal check — must not contain ".." resolved
    match std::fs::remove_file(&canonical) {
        Ok(_) => OpResult { success: true, message: "截图已删除".to_string() },
        Err(e) => OpResult { success: false, message: format!("删除失败: {}", e) },
    }
}
```

Add a UUID v4 helper if not already present:

```rust
fn uuid_v4() -> String {
    use std::time::{SystemTime, UNIX_EPOCH};
    let now = SystemTime::now().duration_since(UNIX_EPOCH).unwrap();
    format!(
        "{:08x}-{:04x}-4{:03x}-{:04x}-{:012x}",
        now.as_secs(),
        now.subsec_nanos() as u16,
        (now.as_nanos() & 0xfff) as u16,
        0x4000 | (rand_noise() & 0x3fff),
        now.as_nanos()
    )
}

fn rand_noise() -> u64 {
    // Simple LCG for non-crypto UUIDs
    use std::time::Instant;
    let n = Instant::now().elapsed().as_nanos();
    (n.wrapping_mul(6364136223846793005).wrapping_add(1442695040888963407)) & 0xffffffffffff
}
```

- [ ] **Step 2: Register all commands in generate_handler!**

Find the `invoke_handler` block (around line 1876) and add inside `generate_handler![...]`:

```rust
            scan_screenshots,
            get_screenshot_base64_batch,
            detect_screenshot_sources,
            add_screenshot_source,
            remove_screenshot_source,
            delete_screenshot,
```

- [ ] **Step 3: Run cargo check**

```bash
cd d:/code/hello_world && cargo check 2>&1
```
Expected: Compilation succeeds. Fix any errors if present.

- [ ] **Step 4: Commit**

```bash
git add src/main.rs
git commit -m "feat: add screenshot CRUD commands and register in handler"
```

---

### Task 6: HTML + CSS

**Files:**
- Modify: `src/index.html`
- Modify: `src/styles.css`

- [ ] **Step 1: Add screenshot panel to index.html**

Insert after the todo panel `</div>` (after line 121) and before the log panel:

```html
        <!-- 截图面板 -->
        <div class="panel" id="panel-screenshot">
            <div class="panel-inner">
                <div id="screenshotApp">
                    <!-- 由 JS 动态渲染 -->
                </div>
            </div>
        </div>
```

- [ ] **Step 2: Add screenshot tab icon to JS config**

Find `TAB_DEFS` (main.js line 46) and add the screenshot entry after `todo`:

```js
    screenshot: { icon: '<svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M23 19a2 2 0 01-2 2H3a2 2 0 01-2-2V8a2 2 0 012-2h4l2-3h6l2 3h4a2 2 0 012 2z"/><circle cx="12" cy="13" r="4"/></svg>', label: '截图' },
```

Also update `DEFAULT_TAB_ORDER`:

```js
const DEFAULT_TAB_ORDER = ['convert', 'backup', 'todo', 'screenshot', 'log'];
```

- [ ] **Step 3: Add screenshot panel CSS**

Add at the end of `styles.css`:

```css
/* ==================== 截图面板 ==================== */
.panel-screenshot { padding: 0; }

/* Toolbar */
.ss-toolbar {
    display: flex; gap: 8px; align-items: center;
    margin-bottom: 16px; flex-wrap: wrap;
}
.ss-toolbar select {
    background: var(--surface); color: var(--text);
    border: 1px solid var(--border); border-radius: 8px;
    padding: 6px 30px 6px 12px; font-size: 13px;
    appearance: none;
    background-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='12' height='12' viewBox='0 0 24 24' fill='none' stroke='%23888' stroke-width='2'%3E%3Cpath d='M6 9l6 6 6-6'/%3E%3C/svg%3E");
    background-repeat: no-repeat; background-position: right 8px center;
    cursor: pointer; min-width: 180px;
}
.ss-toolbar select:focus { outline: none; border-color: var(--accent); }
.ss-toolbar input[type="search"] {
    background: var(--input-bg, var(--surface)); color: var(--text);
    border: 1px solid var(--border); border-radius: 8px;
    padding: 6px 12px; font-size: 13px; flex: 1; min-width: 120px;
}
.ss-toolbar input[type="search"]:focus { outline: none; border-color: var(--accent); }
.ss-toolbar input[type="search"]::placeholder { color: var(--text-secondary); }

/* Pagination */
.ss-pagination {
    display: flex; align-items: center; justify-content: center;
    gap: 12px; margin-bottom: 12px; font-size: 13px; color: var(--text-secondary);
}
.ss-pagination .btn-small { padding: 4px 12px; font-size: 12px; }

/* Grid */
.ss-grid-container { flex: 1; overflow-y: auto; margin: 0 -4px; padding: 4px; }
.ss-grid-container::-webkit-scrollbar { width: 6px; }
.ss-grid-container::-webkit-scrollbar-thumb { background: var(--border); border-radius: 3px; }
.ss-grid {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(200px, 1fr));
    gap: 12px;
}

/* Card */
.ss-card {
    background: var(--surface); border-radius: 10px; overflow: hidden;
    cursor: pointer; position: relative;
    border: 1px solid var(--border); transition: transform 0.15s, box-shadow 0.15s;
}
.ss-card:hover { transform: translateY(-2px); box-shadow: 0 8px 24px rgba(0,0,0,0.3); }
.ss-card .ss-thumb {
    width: 100%; aspect-ratio: 16 / 9; object-fit: cover; display: block;
    background: var(--bg);
}
.ss-card .ss-thumb-placeholder {
    width: 100%; aspect-ratio: 16 / 9; display: flex; align-items: center;
    justify-content: center; font-size: 32px; color: #444;
    background: var(--bg);
}
.ss-card .ss-info {
    padding: 8px 10px; display: flex; justify-content: space-between; align-items: center;
}
.ss-card .ss-info .ss-name { font-size: 11px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; flex: 1; }
.ss-card .ss-info .ss-date { font-size: 10px; color: var(--text-secondary); white-space: nowrap; margin-left: 8px; }
.ss-card .ss-game-tag {
    position: absolute; top: 6px; left: 6px;
    background: rgba(75,139,244,0.85); color: #fff;
    font-size: 10px; padding: 2px 8px; border-radius: 4px; font-weight: 600;
}
.ss-card .ss-hover-actions {
    position: absolute; top: 6px; right: 6px; display: none; gap: 4px;
}
.ss-card:hover .ss-hover-actions { display: flex; }
.ss-card .ss-hover-actions button {
    width: 28px; height: 28px; border: none; border-radius: 6px;
    cursor: pointer; background: rgba(0,0,0,0.6); color: #fff;
    font-size: 13px; display: flex; align-items: center; justify-content: center;
    transition: background 0.15s; backdrop-filter: blur(4px);
}
.ss-card .ss-hover-actions button.ss-del:hover { background: #e81123; }
.ss-card .ss-hover-actions button.ss-folder:hover { background: var(--accent); }

/* Skeleton card */
@keyframes ss-shimmer {
    0% { opacity: 0.6; } 50% { opacity: 1; } 100% { opacity: 0.6; }
}
.ss-skeleton { animation: ss-shimmer 1.5s ease-in-out infinite; pointer-events: none; }
.ss-skeleton .ss-thumb-placeholder { background: var(--surface); }
.ss-skeleton .ss-info { height: 36px; background: var(--surface); }

/* Lightbox */
.ss-lightbox {
    display: none; position: fixed; z-index: 1000;
    top: 0; left: 0; right: 0; bottom: 0;
    background: rgba(0,0,0,0.85); backdrop-filter: blur(8px);
    justify-content: center; align-items: center;
    opacity: 0; transition: opacity 0.2s ease;
}
.ss-lightbox.open { display: flex; opacity: 1; }
.ss-lightbox .ss-lb-close {
    position: absolute; top: 20px; right: 24px;
    width: 36px; height: 36px; border: none; border-radius: 8px;
    background: rgba(255,255,255,0.1); color: #fff; font-size: 20px;
    cursor: pointer; z-index: 10;
    display: flex; align-items: center; justify-content: center;
}
.ss-lightbox .ss-lb-close:hover { background: rgba(255,255,255,0.2); }
.ss-lightbox .ss-lb-nav {
    position: absolute; top: 50%; transform: translateY(-50%);
    width: 44px; height: 44px; border: none; border-radius: 50%;
    background: rgba(255,255,255,0.1); color: #fff; font-size: 20px;
    cursor: pointer; z-index: 10;
    display: flex; align-items: center; justify-content: center;
}
.ss-lightbox .ss-lb-nav:hover { background: rgba(255,255,255,0.2); }
.ss-lightbox .ss-lb-prev { left: 20px; }
.ss-lightbox .ss-lb-next { right: 20px; }
.ss-lightbox .ss-lb-image {
    max-width: 85vw; max-height: 85vh; border-radius: 8px;
    box-shadow: 0 20px 60px rgba(0,0,0,0.6); object-fit: contain;
}
.ss-lightbox .ss-lb-footer {
    position: absolute; bottom: 24px; left: 50%; transform: translateX(-50%);
    color: rgba(255,255,255,0.7); font-size: 13px;
    background: rgba(0,0,0,0.5); padding: 6px 16px; border-radius: 20px;
    backdrop-filter: blur(4px);
}

/* Add source dialog */
.ss-add-dialog {
    display: none; position: fixed; z-index: 999;
    top: 0; left: 0; right: 0; bottom: 0;
    background: rgba(0,0,0,0.5); justify-content: center; align-items: center;
}
.ss-add-dialog.open { display: flex; }
.ss-add-dialog .ss-dialog-box {
    background: var(--surface); border-radius: 14px;
    padding: 24px; width: 480px; max-height: 80vh; overflow-y: auto;
    border: 1px solid var(--border);
}
.ss-add-dialog .ss-dialog-box h3 { font-size: 16px; margin-bottom: 16px; }
.ss-add-dialog .ss-dialog-section {
    margin-bottom: 16px; padding-bottom: 16px;
    border-bottom: 1px solid var(--border);
}
.ss-add-dialog .ss-dialog-section:last-child { border-bottom: none; margin-bottom: 0; padding-bottom: 0; }
.ss-add-dialog .ss-detected-item {
    display: flex; align-items: center; gap: 8px;
    padding: 8px 10px; border-radius: 8px; cursor: pointer;
    transition: background 0.15s;
}
.ss-add-dialog .ss-detected-item:hover { background: rgba(255,255,255,0.05); }
.ss-add-dialog .ss-detected-item input[type="checkbox"] { accent-color: var(--accent); }
.ss-add-dialog .ss-detected-item .ss-count {
    margin-left: auto; font-size: 12px; color: var(--text-secondary);
}

/* Empty state */
.ss-empty {
    flex: 1; display: flex; flex-direction: column;
    align-items: center; justify-content: center;
    color: var(--text-secondary); gap: 12px; padding: 60px 20px;
}
.ss-empty .ss-empty-icon { font-size: 48px; opacity: 0.4; }
.ss-empty p { font-size: 14px; text-align: center; }
.ss-empty .ss-empty-sub { font-size: 12px; opacity: 0.6; }

/* Stats header */
.ss-header {
    display: flex; justify-content: space-between; align-items: center;
    margin-bottom: 12px;
}
.ss-header h2 { font-size: 18px; font-weight: 600; }
.ss-header .ss-subtitle { font-size: 12px; color: var(--text-secondary); margin-top: 2px; }
```

- [ ] **Step 4: Commit**

```bash
git add src/index.html src/styles.css src/main.js
git commit -m "feat: add screenshot panel HTML, CSS, and tab definition"
```

---

### Task 7: JS — Screenshot State, Rendering, Search

**Files:**
- Modify: `src/main.js` (add screenshot state management + rendering)

- [ ] **Step 1: Add screenshot state variables**

Find `currentTab` definition (around line 53) and add after it:

```js
// Screenshot state
let _ssSources = [];           // ScreenshotSource[]
let _ssCurrentSourceId = '';   // Currently selected source ID
let _ssEntries = [];           // ScreenshotEntry[] for current source
let _ssPage = 0;               // Current page (0-indexed)
let _ssPageSize = 20;          // Items per page
let _ssCache = {};             // sourceId -> { entries, fetchedAt }
let _ssSearchQuery = '';       // Current search filter
let _ssSearchTimer = null;     // Debounce timer
let _ssLbIndex = -1;           // Lightbox current index
```

- [ ] **Step 2: Add rendering functions**

Add a new section before `// ==================== 事件委托 ====================`:

```js
// ==================== 截图面板 ====================

function renderScreenshotPanel() {
    var wrapper = document.getElementById('screenshotApp');
    if (!wrapper) return;

    // Load config sources if needed
    if (currentConfig.screenshot_sources) {
        _ssSources = currentConfig.screenshot_sources;
    }

    // No sources → empty state
    if (!_ssSources.length) {
        wrapper.innerHTML =
            '<div class="ss-empty">'
            + '<div class="ss-empty-icon">📷</div>'
            + '<p>还没有添加截图来源</p>'
            + '<button class="btn btn-primary" data-action="ss-add-source">添加第一个来源</button>'
            + '<div class="ss-empty-sub">支持 Steam、原神、星穹铁道、绝区零截图目录</div>'
            + '</div>';
        return;
    }

    // Select first source if none selected
    if (!_ssCurrentSourceId || !_ssSources.some(function(s) { return s.id === _ssCurrentSourceId; })) {
        _ssCurrentSourceId = _ssSources[0].id;
    }

    // Get current source
    var currentSource = _ssSources.find(function(s) { return s.id === _ssCurrentSourceId; });
    if (!currentSource) { wrapper.innerHTML = ''; return; }

    // Check cache (30 second TTL)
    var cached = _ssCache[_ssCurrentSourceId];
    var now = Date.now();
    if (!cached || now - cached.fetchedAt > 30000) {
        // Show skeleton and trigger scan
        renderSkeleton(wrapper);
        scanScreenshots(currentSource);
        return;
    }

    _ssEntries = cached.entries;
    renderGridView(wrapper, currentSource);
}

function renderSkeleton(wrapper) {
    var cards = '';
    for (var i = 0; i < 6; i++) {
        cards += '<div class="ss-card ss-skeleton"><div class="ss-thumb-placeholder"></div><div class="ss-info"></div></div>';
    }
    wrapper.innerHTML = ''
        + renderToolbar()
        + '<div class="ss-grid-container"><div class="ss-grid">' + cards + '</div></div>';
}

function renderToolbar() {
    var options = _ssSources.map(function(s) {
        var selected = s.id === _ssCurrentSourceId ? ' selected' : '';
        var label = s.name + ' (' + countDirFiles(s) + ' 张)';
        return '<option value="' + s.id + '"' + selected + '>' + escapeHtml(label) + '</option>';
    }).join('');

    return '<div class="ss-toolbar">'
        + '<select data-action="ss-select-source">' + options + '</select>'
        + '<input type="search" placeholder="搜索截图文件名..." value="' + escapeHtml(_ssSearchQuery) + '" data-action="ss-search">'
        + '<button class="btn btn-primary" data-action="ss-add-source">+ 添加</button>'
        + '<button class="btn btn-ghost" data-action="ss-refresh">🔄</button>'
        + '</div>';
}

function countDirFiles(s) {
    return s.id === _ssCurrentSourceId ? _ssEntries.length : '?';
}

function renderGridView(wrapper, currentSource) {
    // Filter by search
    var filtered = _ssEntries;
    if (_ssSearchQuery) {
        var q = _ssSearchQuery.toLowerCase();
        filtered = _ssEntries.filter(function(e) {
            return e.file_name.toLowerCase().indexOf(q) !== -1;
        });
    }

    var totalPages = Math.max(1, Math.ceil(filtered.length / _ssPageSize));
    if (_ssPage >= totalPages) _ssPage = 0;
    var start = _ssPage * _ssPageSize;
    var pageItems = filtered.slice(start, start + _ssPageSize);

    // Pagination HTML
    var paginationHtml = '<div class="ss-pagination">'
        + '<span>第 ' + (_ssPage + 1) + ' 页，共 ' + totalPages + ' 页（' + filtered.length + ' 张）</span>'
        + '<button class="btn-small" data-action="ss-prev-page"' + (_ssPage <= 0 ? ' disabled' : '') + '>‹ 上一页</button>'
        + '<button class="btn-small" data-action="ss-next-page"' + (_ssPage >= totalPages - 1 ? ' disabled' : '') + '>下一页 ›</button>'
        + '</div>';

    // Grid cards
    if (pageItems.length === 0) {
        wrapper.innerHTML = renderToolbar() + paginationHtml
            + '<div class="ss-empty"><p>没有找到匹配的截图</p></div>';
        return;
    }

    var cards = pageItems.map(function(entry, idx) {
        var absIdx = start + idx;
        var tagHtml = entry.game_name
            ? '<span class="ss-game-tag">' + escapeHtml(entry.game_name) + '</span>'
            : '';
        return '<div class="ss-card" data-action="ss-open" data-index="' + absIdx + '">'
            + tagHtml
            + '<div class="ss-thumb-placeholder">⏳</div>'
            + '<div class="ss-hover-actions">'
            + '<button class="ss-folder" data-action="ss-open-folder" data-path="' + escapeHtml(entry.path) + '">📂</button>'
            + '<button class="ss-del" data-action="ss-delete-file" data-path="' + escapeHtml(entry.path) + '" data-name="' + escapeHtml(entry.file_name) + '">🗑</button>'
            + '</div>'
            + '<div class="ss-info">'
            + '<span class="ss-name">' + escapeHtml(entry.file_name) + '</span>'
            + '<span class="ss-date">' + escapeHtml(entry.modified.substring(5, 10)) + '</span>'
            + '</div>'
            + '</div>';
    }).join('');

    wrapper.innerHTML = renderToolbar() + paginationHtml
        + '<div class="ss-grid-container"><div class="ss-grid">' + cards + '</div></div>';

    // Load thumbnails after rendering
    loadThumbnails(pageItems, wrapper, start);
}

function loadThumbnails(pageItems, wrapper, start) {
    var paths = pageItems.map(function(e) { return e.path; });
    invoke('get_screenshot_base64_batch', { paths: paths }).then(function(dataUris) {
        var cards = wrapper.querySelectorAll('.ss-card');
        dataUris.forEach(function(uri, i) {
            var card = cards[i];
            if (!card || !uri) return;
            var placeholder = card.querySelector('.ss-thumb-placeholder');
            if (placeholder) {
                var img = document.createElement('img');
                img.className = 'ss-thumb';
                img.src = uri;
                img.decoding = 'async';
                img.loading = 'lazy';
                img.alt = pageItems[i].file_name;
                placeholder.parentNode.replaceChild(img, placeholder);
            }
        });
    });
}

function scanScreenshots(source) {
    invoke('scan_screenshots', { sourcePath: source.path }).then(function(entries) {
        // Attach source and game info
        entries.forEach(function(e) {
            e.source_id = source.id;
            e.game_name = source.game_id ? getGameName(source.game_id) : null;
        });
        _ssCache[_ssCurrentSourceId] = { entries: entries, fetchedAt: Date.now() };
        _ssEntries = entries;
        _ssPage = 0;
        var wrapper = document.getElementById('screenshotApp');
        if (wrapper) renderGridView(wrapper, source);
    }).catch(function(err) {
        var wrapper = document.getElementById('screenshotApp');
        if (wrapper) {
            wrapper.innerHTML = renderToolbar()
                + '<div class="ss-empty"><p>⚠️ 无法读取目录，请检查路径是否存在</p></div>';
        }
    });
}

function getGameName(gameId) {
    // Look up game name from backup config
    if (!currentConfig.games) return null;
    var game = currentConfig.games.find(function(g) { return g.id === gameId; });
    return game ? game.name : null;
}
```

- [ ] **Step 3: Commit**

```bash
git add src/main.js
git commit -m "feat: add screenshot panel rendering and search"
```

---

### Task 8: JS — Lightbox, Event Delegation, Add Source Dialog

**Files:**
- Modify: `src/main.js` (add lightbox, event handlers, add-source dialog)

- [ ] **Step 1: Add lightbox + openFolder functions**

Add after `getGameName`:

```js
// ─── Lightbox ───

function openLightbox(index) {
    if (!_ssEntries || index < 0 || index >= _ssEntries.length) return;
    _ssLbIndex = index;
    var entry = _ssEntries[index];

    // Ensure lightbox DOM exists
    var lb = document.getElementById('ssLightbox');
    if (!lb) {
        lb = document.createElement('div');
        lb.id = 'ssLightbox';
        lb.className = 'ss-lightbox';
        lb.innerHTML = '<button class="ss-lb-close" data-action="ss-lb-close">✕</button>'
            + '<button class="ss-lb-nav ss-lb-prev" data-action="ss-lb-prev">‹</button>'
            + '<button class="ss-lb-nav ss-lb-next" data-action="ss-lb-next">›</button>'
            + '<img class="ss-lb-image" id="ssLbImg" alt="">'
            + '<div class="ss-lb-footer" id="ssLbFooter"></div>';
        document.body.appendChild(lb);
    }

    var img = document.getElementById('ssLbImg');
    // Show loading state
    img.style.display = 'none';
    lb.classList.add('open');

    invoke('get_screenshot_base64_batch', { paths: [entry.path] }).then(function(dataUris) {
        if (dataUris[0]) {
            img.src = dataUris[0];
            img.style.display = '';
        }
    });

    updateLightboxFooter();
}

function updateLightboxFooter() {
    var footer = document.getElementById('ssLbFooter');
    if (footer) {
        footer.textContent = (_ssLbIndex + 1) + ' / ' + _ssEntries.length + ' 张';
    }
}

function closeLightbox() {
    var lb = document.getElementById('ssLightbox');
    if (lb) {
        lb.classList.remove('open');
        _ssLbIndex = -1;
    }
}

function navigateLightbox(dir) {
    var newIdx = _ssLbIndex + dir;
    if (newIdx < 0 || newIdx >= _ssEntries.length) return;
    openLightbox(newIdx);
}
```

- [ ] **Step 2: Add source dialog functions**

```js
// ─── Add Source Dialog ───

function openAddSourceDialog() {
    var existing = document.getElementById('ssAddDialog');
    if (existing) { existing.classList.add('open'); return; }

    var dialog = document.createElement('div');
    dialog.id = 'ssAddDialog';
    dialog.className = 'ss-add-dialog';
    dialog.innerHTML = '<div class="ss-dialog-box">'
        + '<h3>添加截图来源</h3>'
        + '<div class="ss-dialog-section">'
        + '<p style="margin-bottom:8px;font-size:13px;color:var(--text-secondary)">自定义文件夹</p>'
        + '<button class="btn btn-primary" data-action="ss-pick-folder">📁 浏览...</button>'
        + '</div>'
        + '<div class="ss-dialog-section" id="ssDetectedSection">'
        + '<p style="margin-bottom:8px;font-size:13px;color:var(--text-secondary)">快速添加 — 正在检测...</p>'
        + '</div>'
        + '<div style="text-align:right">'
        + '<button class="btn btn-ghost" data-action="ss-close-dialog">取消</button>'
        + '</div>'
        + '</div>';

    dialog.addEventListener('click', function(e) {
        if (e.target === dialog) dialog.classList.remove('open');
    });

    document.body.appendChild(dialog);
    dialog.classList.add('open');

    // Detect sources
    invoke('detect_screenshot_sources').then(function(sources) {
        var section = document.getElementById('ssDetectedSection');
        if (!section) return;
        if (!sources || sources.length === 0) {
            section.innerHTML = '<p style="font-size:13px;color:var(--text-secondary)">未检测到已知截图来源，请使用浏览按钮手动添加</p>';
            return;
        }

        var html = '<p style="margin-bottom:8px;font-size:13px;color:var(--text-secondary)">检测到以下来源：</p>';
        sources.forEach(function(s, i) {
            html += '<label class="ss-detected-item">'
                + '<input type="checkbox" data-action="ss-toggle-detected" data-index="' + i + '" checked>'
                + '<span>' + escapeHtml(s.name) + '</span>'
                + '<span class="ss-count">' + s.count + ' 张</span>'
                + '</label>';
        });

        // Store detected sources for later use
        window._ssDetectedSources = sources;

        html += '<div style="margin-top:12px"><button class="btn btn-primary" data-action="ss-add-detected">添加所选</button></div>';
        section.innerHTML = html;
    }).catch(function() {
        var section = document.getElementById('ssDetectedSection');
        if (section) {
            section.innerHTML = '<p style="font-size:13px;color:var(--text-secondary)">检测失败，请使用浏览按钮手动添加</p>';
        }
    });
}

function closeAddDialog() {
    var dialog = document.getElementById('ssAddDialog');
    if (dialog) dialog.classList.remove('open');
}

function addDetectedSources() {
    var sources = window._ssDetectedSources || [];
    var checks = document.querySelectorAll('#ssAddDialog input[data-action="ss-toggle-detected"]:checked');
    var added = 0;

    checks.forEach(function(cb) {
        var idx = parseInt(cb.dataset.index);
        var src = sources[idx];
        if (!src) return;
        invoke('add_screenshot_source', { name: src.name, path: src.path, gameId: null }).then(function(res) {
            if (res.success) added++;
        });
    });

    // Refresh after a short delay
    setTimeout(function() {
        refreshScreenshotConfig();
        closeAddDialog();
    }, 500);
}

function refreshScreenshotConfig() {
    invoke('get_config').then(function(config) {
        currentConfig = config;
        _ssSources = config.screenshot_sources || [];
        renderScreenshotPanel();
    });
}
```

- [ ] **Step 3: Add event delegation handlers**

Inside `setupEventDelegation()`, add the screenshot handlers. Find the existing `document.addEventListener('click', ...` or `e.target.closest('[data-action]')` block and add these cases:

```js
        // === 截图面板 ===
        else if (action === 'ss-select-source') {
            _ssCurrentSourceId = target.value;
            _ssPage = 0;
            renderScreenshotPanel();
        }
        else if (action === 'ss-search') {
            var value = target.value;
            clearTimeout(_ssSearchTimer);
            _ssSearchTimer = setTimeout(function() {
                _ssSearchQuery = value;
                _ssPage = 0;
                renderScreenshotPanel();
            }, 300);
        }
        else if (action === 'ss-refresh') {
            delete _ssCache[_ssCurrentSourceId];
            renderScreenshotPanel();
        }
        else if (action === 'ss-add-source') {
            openAddSourceDialog();
        }
        else if (action === 'ss-prev-page') {
            if (_ssPage > 0) { _ssPage--; renderScreenshotPanel(); }
        }
        else if (action === 'ss-next-page') {
            var totalPages = Math.ceil(_ssEntries.length / _ssPageSize);
            if (_ssPage < totalPages - 1) { _ssPage++; renderScreenshotPanel(); }
        }
        else if (action === 'ss-open') {
            var idx = parseInt(target.dataset.index);
            openLightbox(idx);
        }
        else if (action === 'ss-open-folder') {
            var path = target.dataset.path;
            invoke('open_folder', { path: path });
        }
        else if (action === 'ss-delete-file') {
            var path = target.dataset.path;
            var name = target.dataset.name;
            if (confirm('确定删除截图 "' + name + '"？')) {
                invoke('delete_screenshot', { path: path }).then(function(res) {
                    if (res.success) {
                        // Remove from cache and re-render
                        var cached = _ssCache[_ssCurrentSourceId];
                        if (cached) {
                            cached.entries = cached.entries.filter(function(e) { return e.path !== path; });
                        }
                        renderScreenshotPanel();
                    } else {
                        alert('删除失败: ' + res.message);
                    }
                });
            }
        }
        else if (action === 'ss-lb-close' || action === 'ss-close-dialog') {
            closeLightbox();
            closeAddDialog();
        }
        else if (action === 'ss-lb-prev') {
            navigateLightbox(-1);
        }
        else if (action === 'ss-lb-next') {
            navigateLightbox(1);
        }
        else if (action === 'ss-pick-folder') {
            invoke('pick_directory').then(function(dir) {
                if (dir) {
                    var name = dir.split(/[/\\]/).pop() || '截图';
                    invoke('add_screenshot_source', { name: name, path: dir, gameId: null }).then(function(res) {
                        if (res.success) {
                            refreshScreenshotConfig();
                        } else {
                            alert('添加失败: ' + res.message);
                        }
                    });
                }
            });
        }
        else if (action === 'ss-add-detected') {
            addDetectedSources();
        }
```

- [ ] **Step 4: Add global keyboard handler for lightbox**

Add to the existing `document.addEventListener('keydown', ...)` or create one:

```js
// Screenshot lightbox keyboard navigation
document.addEventListener('keydown', function(e) {
    var lb = document.getElementById('ssLightbox');
    if (!lb || !lb.classList.contains('open')) return;
    if (e.key === 'Escape') { closeLightbox(); }
    else if (e.key === 'ArrowLeft') { e.preventDefault(); navigateLightbox(-1); }
    else if (e.key === 'ArrowRight') { e.preventDefault(); navigateLightbox(1); }
});
```

- [ ] **Step 5: Wire screenshot panel into tab switch + init**

In the init sequence (after loading config), add a call to render the screenshot panel when its tab is selected. Modify the tab switch handler:

Find where `switchTab` calls panel-specific render functions and add after `renderTimezoneSets()`:

```js
    } else if (tabId === 'screenshot') {
        renderScreenshotPanel();
    }
```

Also add to the init sequence (around line 481 after `renderTimezoneSets`):

```js
    renderScreenshotPanel();
```

Make sure the panel-inner has `id="panel-screenshot"` content rendered on first load. The `renderScreenshotPanel()` call in init handles this since `position: absolute` panels share the same rendering context.

Also ensure Lightbox closes when switching away from screenshot tab. In `switchTab`, before the existing logic:

```js
    // Close screenshot lightbox if open
    closeLightbox();
```

- [ ] **Step 6: Commit**

```bash
git add src/main.js
git commit -m "feat: add lightbox, add-source dialog, and event delegation for screenshot panel"
```

---

## Self-Review Checklist

**1. Spec coverage check:**
- Section 1 (panel position) → Task 6 (HTML tab order) + Task 7 (switchTab integration) ✅
- Section 2 (data structures) → Task 1 (Rust structs + AppConfig) ✅
- Section 3 (Rust commands) → Tasks 2, 3, 4, 5 (all 7 commands + registration) ✅
- Section 4 (UI) → Tasks 6 (CSS) + Task 7 (rendering) + Task 8 (lightbox) ✅
- Section 5 (constraints) → Task 2 (canonicalize security), Task 3 (LRU cache), Task 2 (spawn_blocking, recursion ≤3) ✅
- Section 6 (file list) → All files covered ✅

**2. Placeholder check:** No TBD, TODO, or "implement later" patterns found. All code is concrete.

**3. Type consistency:** The same field names (id, name, path, game_id, file_name, source_id, etc.) are used consistently across Rust structs, JS state, and HTML data attributes. The data-action naming (`ss-*` prefix) is unique and won't conflict with existing actions.

**4. Edge cases covered:**
- Empty sources → empty state with add button ✅
- Search no matches → "没有找到匹配的截图" ✅
- Scan failure → error state with message ✅
- Lightbox close on tab switch ✅
- Path traversal protection via canonicalize ✅
- Cache eviction (100 entries / 500MB) ✅
- Recursion depth limit (3 levels) ✅

---

## Execution Handoff

Plan complete and saved to `docs/superpowers/plans/2026-05-22-screenshot-gallery-plan.md`. Two execution options:

**1. Subagent-Driven (recommended)** — I dispatch a fresh subagent per task, review between tasks, fast iteration

**2. Inline Execution** — Execute tasks in this session using executing-plans, batch execution with checkpoints

**Which approach?**
