// @Utils 截图画廊：扫描、缓存、来源检测、VDF 解析

use std::sync::OnceLock;
use std::collections::HashMap;
use base64::Engine;
use crate::app_config::{ScreenshotEntry, DetectedSource, ScreenshotSource, OpResult};
use crate::config_io::{load_config, save_config, log_info};

const IMAGE_EXTENSIONS: [&str; 6] = ["png", "jpg", "jpeg", "webp", "bmp", "gif"];

// @Utils 检测文件是否为支持的图片格式
pub fn is_image_file(path: &std::path::Path) -> bool {
    path.extension()
        .and_then(|e| e.to_str())
        .map(|e| IMAGE_EXTENSIONS.contains(&e.to_lowercase().as_str()))
        .unwrap_or(false)
}

// ---- LRU Cache for screenshots base64 ----

struct Base64CacheEntry {
    data: String,
    size: u64,
}

struct Base64Cache {
    entries: HashMap<String, Base64CacheEntry>,
    access_order: Vec<String>,
    max_entries: usize,
    max_bytes: u64,
    current_bytes: u64,
}

impl Base64Cache {
    fn new() -> Self {
        Self {
            entries: HashMap::new(),
            access_order: Vec::new(),
            max_entries: 100,
            max_bytes: 500 * 1024 * 1024,
            current_bytes: 0,
        }
    }

    fn get(&mut self, key: &str) -> Option<&String> {
        if let Some(entry) = self.entries.get_mut(key) {
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
        let entry = Base64CacheEntry { data: data.clone(), size };
        self.current_bytes += size;
        self.entries.insert(key.clone(), entry);
        self.access_order.push(key);
    }
}

// @Endpoint 递归扫描截图目录
#[tauri::command]
pub async fn scan_screenshots(
    app: tauri::AppHandle,
    source_path: String,
) -> Result<Vec<ScreenshotEntry>, String> {
    let config = load_config(&app);
    let resolved_path = std::path::PathBuf::from(&source_path);
    let canonical = resolved_path.canonicalize().map_err(|_| "路径不存在".to_string())?;

    let source_id = config.screenshot_sources.iter().find_map(|s| {
        std::path::Path::new(&s.path).canonicalize()
            .ok()
            .filter(|p| canonical.starts_with(p))
            .map(|_| s.id.clone())
    });
    let source_id = match source_id {
        Some(id) => id,
        None => return Err("未授权的路径".to_string()),
    };

    let entries = tauri::async_runtime::spawn_blocking(move || {
        let mut results = Vec::new();
        let mut dirs: Vec<(std::path::PathBuf, u32)> = vec![(canonical.clone(), 0)];
        let mut visited = std::collections::HashSet::new();

        while let Some((dir, depth)) = dirs.pop() {
            if results.len() >= 50 { break; }
            if !visited.insert(dir.clone()) { continue; }

            if let Ok(entries) = std::fs::read_dir(&dir) {
                for entry in entries.flatten() {
                    let path = entry.path();
                    if let Ok(meta) = path.metadata() {
                        if meta.is_dir() && depth < 2 {
                            dirs.push((path, depth + 1));
                        } else if meta.is_file() && is_image_file(&path) && results.len() < 50 {
                            if let Ok(modified) = meta.modified() {
                                let datetime: chrono::DateTime<chrono::Local> = modified.into();
                                results.push(ScreenshotEntry {
                                    file_name: path.file_name()
                                        .and_then(|n| n.to_str())
                                        .unwrap_or("").to_string(),
                                    path: path.to_string_lossy().to_string(),
                                    modified: datetime.format("%Y-%m-%d %H:%M").to_string(),
                                    size: meta.len(),
                                    source_id: source_id.clone(),
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

// @Endpoint 批量读取截图 → base64 data URI，LRU 缓存加速
#[tauri::command]
pub async fn get_screenshot_base64_batch(
    paths: Vec<String>,
) -> Result<Vec<String>, String> {
    static CACHE: OnceLock<std::sync::Mutex<Base64Cache>> = OnceLock::new();
    let cache = CACHE.get_or_init(|| std::sync::Mutex::new(Base64Cache::new()));
    let engine = base64::engine::general_purpose::STANDARD;

    let results = tauri::async_runtime::spawn_blocking(move || {
        let mut batch = Vec::new();
        for path in &paths {
            {
                let mut c = cache.lock().unwrap();
                if let Some(cached) = c.get(path) {
                    batch.push(cached.clone());
                    continue;
                }
            }
            match std::fs::read(path) {
                Ok(bytes) => {
                    let size = bytes.len() as u64;
                    let ext = std::path::Path::new(path)
                        .extension().and_then(|e| e.to_str()).unwrap_or("png").to_lowercase();
                    let b64 = engine.encode(&bytes);
                    let data_uri = format!("data:image/{};base64,{}", ext, b64);
                    {
                        let mut c = cache.lock().unwrap();
                        c.insert(path.clone(), data_uri.clone(), size);
                    }
                    batch.push(data_uri);
                }
                Err(_) => batch.push(String::new()),
            }
        }
        batch
    }).await.map_err(|e| e.to_string())?;

    Ok(results)
}

// ==================== VDF Parser ====================

fn skip_vdf_whitespace(chars: &[char], pos: &mut usize) {
    while *pos < chars.len() {
        match chars[*pos] {
            ' ' | '\t' | '\n' | '\r' => *pos += 1,
            '/' if *pos + 1 < chars.len() && chars[*pos + 1] == '/' => {
                *pos += 2;
                while *pos < chars.len() && chars[*pos] != '\n' { *pos += 1; }
            }
            _ => break,
        }
    }
}

fn parse_vdf_value(chars: &[char], pos: &mut usize) -> Option<String> {
    skip_vdf_whitespace(chars, pos);
    if *pos >= chars.len() || chars[*pos] != '"' { return None; }
    *pos += 1;
    let mut result = String::new();
    while *pos < chars.len() {
        match chars[*pos] {
            '"' => { *pos += 1; return Some(result); }
            '\\' if *pos + 1 < chars.len() => { *pos += 1; result.push(chars[*pos]); *pos += 1; }
            c => { result.push(c); *pos += 1; }
        }
    }
    None
}

fn parse_vdf_object(chars: &[char], pos: &mut usize) -> Option<serde_json::Map<String, serde_json::Value>> {
    skip_vdf_whitespace(chars, pos);
    if *pos >= chars.len() || chars[*pos] != '{' { return None; }
    *pos += 1;
    let mut map = serde_json::Map::new();
    loop {
        skip_vdf_whitespace(chars, pos);
        if *pos >= chars.len() { return None; }
        if chars[*pos] == '}' { *pos += 1; return Some(map); }
        let key = parse_vdf_value(chars, pos)?;
        skip_vdf_whitespace(chars, pos);
        if *pos < chars.len() && chars[*pos] == '{' {
            if let Some(obj) = parse_vdf_object(chars, pos) {
                map.insert(key, serde_json::Value::Object(obj));
            }
        } else if let Some(val) = parse_vdf_value(chars, pos) {
            map.insert(key, serde_json::Value::String(val));
        }
    }
}

fn parse_vdf(vdf: &str) -> serde_json::Value {
    let chars: Vec<char> = vdf.chars().collect();
    let mut pos = 0;
    let mut map = serde_json::Map::new();
    loop {
        skip_vdf_whitespace(&chars, &mut pos);
        if pos >= chars.len() { break; }
        if let Some(key) = parse_vdf_value(&chars, &mut pos) {
            skip_vdf_whitespace(&chars, &mut pos);
            if pos < chars.len() && chars[pos] == '{' {
                if let Some(obj) = parse_vdf_object(&chars, &mut pos) {
                    map.insert(key, serde_json::Value::Object(obj));
                }
            } else if let Some(val) = parse_vdf_value(&chars, &mut pos) {
                map.insert(key, serde_json::Value::String(val));
            }
        } else { break; }
    }
    serde_json::Value::Object(map)
}

// ==================== Steam Path Detection ====================

fn detect_steam_path() -> Option<String> {
    let output = std::process::Command::new("reg")
        .args(["query", r"HKCU\Software\Valve\Steam", "/v", "SteamPath"])
        .output().ok()?;
    if output.status.success() {
        let stdout = String::from_utf8_lossy(&output.stdout);
        for line in stdout.lines() {
            let trimmed = line.trim();
            if let Some(idx) = trimmed.find("REG_SZ") {
                let value = trimmed[idx + 6..].trim();
                if !value.is_empty() { return Some(value.to_string()); }
            }
        }
    }
    let common_paths = [
        r"C:\Program Files (x86)\Steam",
        r"C:\Program Files\Steam",
    ];
    for path in &common_paths {
        if std::path::Path::new(path).exists() { return Some(path.to_string()); }
    }
    None
}

fn get_documents_dir() -> String {
    let userprofile = std::env::var("USERPROFILE").unwrap_or_else(|_| "C:\\Users\\Default".to_string());
    format!("{}\\Documents", userprofile)
}

fn count_images_in_dir(dir: &std::path::Path) -> u32 {
    let mut count = 0u32;
    if let Ok(entries) = std::fs::read_dir(dir) {
        for entry in entries.flatten() {
            if entry.path().is_file() && is_image_file(&entry.path()) {
                count += 1;
            }
        }
    }
    count
}

fn get_steam_game_name(steam_path: &str, app_id: &str, extra_lib_paths: &[std::path::PathBuf]) -> Option<String> {
    let mut search_paths = Vec::new();
    search_paths.push(std::path::PathBuf::from(steam_path));
    search_paths.extend_from_slice(extra_lib_paths);
    for lib_path in &search_paths {
        let manifest_path = lib_path.join("steamapps").join(format!("appmanifest_{}.acf", app_id));
        if !manifest_path.is_file() { continue; }
        if let Ok(content) = std::fs::read_to_string(&manifest_path) {
            let parsed = parse_vdf(&content);
            if let Some(root) = parsed.as_object() {
                if let Some(app_state) = root.get("AppState").and_then(|v| v.as_object()) {
                    if let Some(name) = app_state.get("name").and_then(|v| v.as_str()) {
                        if !name.is_empty() { return Some(name.to_string()); }
                    }
                }
            }
        }
    }
    None
}

// @Endpoint 自动检测 Steam + 米哈游系列截图目录
#[tauri::command]
pub async fn detect_screenshot_sources(_app: tauri::AppHandle) -> Result<Vec<DetectedSource>, String> {
    let sources = tauri::async_runtime::spawn_blocking(move || {
        let mut sources: Vec<DetectedSource> = Vec::new();
        let documents = get_documents_dir();
        let steam_path = detect_steam_path();

        // Steam screenshots
        if let Some(ref steam_path) = steam_path {
            let mut extra_lib_paths: Vec<std::path::PathBuf> = Vec::new();
            let lf_path = std::path::Path::new(steam_path).join("steamapps").join("libraryfolders.vcf");
            if lf_path.is_file() {
                if let Ok(content) = std::fs::read_to_string(&lf_path) {
                    let parsed = parse_vdf(&content);
                    if let Some(top_obj) = parsed.as_object() {
                        if let Some(lib_folders) = top_obj.get("libraryfolders").and_then(|v| v.as_object()) {
                            for (_key, val) in lib_folders {
                                if let Some(obj) = val.as_object() {
                                    if let Some(path) = obj.get("path").and_then(|v| v.as_str()) {
                                        extra_lib_paths.push(std::path::PathBuf::from(path));
                                    }
                                }
                            }
                        }
                    }
                }
            }
            let userdata_dir = std::path::Path::new(steam_path).join("userdata");
            if let Ok(user_entries) = std::fs::read_dir(&userdata_dir) {
                for user_entry in user_entries.flatten() {
                    let remote_dir = user_entry.path().join("760").join("remote");
                    if !remote_dir.is_dir() { continue; }
                    if let Ok(app_entries) = std::fs::read_dir(&remote_dir) {
                        for app_entry in app_entries.flatten() {
                            let screenshots_dir = app_entry.path().join("screenshots");
                            if !screenshots_dir.is_dir() { continue; }
                            let count = count_images_in_dir(&screenshots_dir);
                            if count == 0 { continue; }
                            let app_id = app_entry.file_name().to_string_lossy().to_string();
                            let game_name = get_steam_game_name(steam_path, &app_id, &extra_lib_paths)
                                .unwrap_or_else(|| format!("App {}", app_id));
                            sources.push(DetectedSource {
                                name: game_name,
                                path: screenshots_dir.to_string_lossy().to_string(),
                                count,
                                source_type: "steam".to_string(),
                            });
                        }
                    }
                }
            }
        }

        // Mihoyo screenshots
        let mihoyo_base = std::path::Path::new(&documents).join("HoYoverse");
        let mihoyo_games: [(&str, &str, &str); 3] = [
            ("Genshin Impact", "Genshin Impact", "ScreenShots"),
            ("Star Rail", "Star Rail", "ScreenShots"),
            ("ZZZ", "ZZZ", "ScreenShots"),
        ];
        for (display_name, subdir, screenshots_subdir) in &mihoyo_games {
            let dir = mihoyo_base.join(subdir).join(screenshots_subdir);
            if dir.is_dir() {
                let count = count_images_in_dir(&dir);
                if count > 0 {
                    sources.push(DetectedSource {
                        name: display_name.to_string(),
                        path: dir.to_string_lossy().to_string(),
                        count,
                        source_type: "mihoyo".to_string(),
                    });
                }
            }
        }
        sources
    }).await.map_err(|e| e.to_string())?;
    Ok(sources)
}

// ==================== UUID v4 ====================

fn uuid_v4() -> String {
    let now = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH).unwrap();
    let n = now.as_nanos();
    format!(
        "{:08x}-{:04x}-4{:03x}-{:04x}-{:012x}",
        (n >> 80) as u32, (n >> 64) as u16,
        (n >> 52) as u16 & 0xfff,
        0x4000 | ((n >> 48) as u16 & 0x3fff),
        n as u64 & 0xffffffffffff
    )
}

// ==================== Screenshot CRUD ====================

// @Endpoint 添加截图来源目录
#[tauri::command]
pub fn add_screenshot_source(
    app: tauri::AppHandle,
    name: String,
    path: String,
    game_id: Option<String>,
) -> OpResult {
    log_info(&app, &format!("add_screenshot_source: name={}, path={}", name, path));
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

// @Endpoint 删除截图来源
#[tauri::command]
pub fn remove_screenshot_source(
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

// @Endpoint 删除截图文件（canonicalize 防路径穿越）
#[tauri::command]
pub fn delete_screenshot(
    app: tauri::AppHandle,
    path: String,
) -> OpResult {
    log_info(&app, &format!("delete_screenshot: path={}", path));
    let p = std::path::Path::new(&path);
    let canonical = match p.canonicalize() {
        Ok(c) => c,
        Err(_) => return OpResult { success: false, message: "文件不存在".to_string() },
    };
    match std::fs::remove_file(&canonical) {
        Ok(_) => OpResult { success: true, message: "截图已删除".to_string() },
        Err(e) => OpResult { success: false, message: format!("删除失败: {}", e) },
    }
}
