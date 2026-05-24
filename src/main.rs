// @Setup Tauri 2.0 桌面应用后端入口（仅 Windows 无边框窗口）
// @see src/main.js 前端 IPC 调用方
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use chrono::{NaiveDateTime, DateTime, Utc, TimeZone};
use chrono::Datelike;
use serde::{Deserialize, Serialize};
use std::fs;
use std::io::{Write, BufReader, BufWriter, Read};
use std::path::PathBuf;
use base64::Engine;
use tauri::Manager;
use md5::{Md5, Digest};

#[cfg(target_os = "windows")]
unsafe extern "system" {
    fn Beep(dwFreq: u32, dwDuration: u32) -> i32;
}

// ==================== 时区工具 ====================

// @Service 解析时区名称为固定偏移（含 DST 自动切换）
// 替代 chrono-tz 依赖节省 2-3MB，手动维护 7 个常用时区的 DST 规则
/// 解析时区名称为固定偏移（含 DST 支持）
fn resolve_timezone(tz_name: &str) -> Option<chrono::FixedOffset> {
    use chrono::FixedOffset;
    match tz_name {
        "Asia/Shanghai"     => Some(FixedOffset::east_opt(8 * 3600)?),
        "Asia/Kolkata"      => Some(FixedOffset::east_opt(5 * 3600 + 1800)?),
        "Asia/Tokyo"        => Some(FixedOffset::east_opt(9 * 3600)?),
        "UTC"               => Some(FixedOffset::east_opt(0)?),
        "Europe/London"     => {
            let now = chrono::Utc::now().naive_utc().date();
            let year = now.year();
            let bst_start = last_sunday_of_month(year, 3);
            let bst_end = last_sunday_of_month(year, 10);
            let offset = if now >= bst_start && now < bst_end { 1 } else { 0 };
            Some(FixedOffset::east_opt(offset * 3600)?)
        }
        "America/New_York"  => {
            let now = chrono::Utc::now().naive_utc().date();
            let year = now.year();
            let edt_start = nth_sunday_of_month(year, 3, 2);
            let edt_end = nth_sunday_of_month(year, 11, 1);
            let offset = if now >= edt_start && now < edt_end { -4 } else { -5 };
            Some(FixedOffset::east_opt(offset * 3600)?)
        }
        "Australia/Sydney"  => {
            let now = chrono::Utc::now().naive_utc().date();
            let year = now.year();
            let aedt_start = nth_sunday_of_month(year, 10, 1);
            let aedt_end = nth_sunday_of_month(year + 1, 4, 1);
            let offset = if now >= aedt_start && now < aedt_end { 11 } else { 10 };
            Some(FixedOffset::east_opt(offset * 3600)?)
        }
        _ => None,
    }
}

// @Utils 计算某月第 N 个星期日（DST 切换日期计算用）
/// 计算某月第 N 个星期日（n 从 1 开始）
fn nth_sunday_of_month(year: i32, month: u32, n: u32) -> chrono::NaiveDate {
    let first = chrono::NaiveDate::from_ymd_opt(year, month, 1).expect("valid date");
    let first_dow = first.weekday().num_days_from_sunday();
    let day = 1 + if first_dow == 0 { 0 } else { 7 - first_dow } + (n - 1) * 7;
    chrono::NaiveDate::from_ymd_opt(year, month, day).expect("valid date")
}

// @Utils 计算某月最后一个星期日（英国 DST 切换用）
/// 计算某月最后一个星期日
fn last_sunday_of_month(year: i32, month: u32) -> chrono::NaiveDate {
    let (next_y, next_m) = if month == 12 { (year + 1, 1) } else { (year, month + 1) };
    let last_day = chrono::NaiveDate::from_ymd_opt(next_y, next_m, 1).expect("valid date").pred_opt().expect("non-min date");
    let dow = last_day.weekday().num_days_from_sunday();
    last_day.pred_opt().expect("non-min date").checked_sub_days(chrono::Days::new(dow as u64)).expect("valid date")
}

// @Utils 计算某月的最后一天（月末模式提醒用）
/// 计算某月的最后一天
fn last_day_of_month(year: i32, month: u32) -> chrono::NaiveDate {
    let (next_y, next_m) = if month == 12 { (year + 1, 1) } else { (year, month + 1) };
    chrono::NaiveDate::from_ymd_opt(next_y, next_m, 1).expect("valid date").pred_opt().expect("non-min date")
}

// @Entity 时间→时间戳转换请求/响应体
#[derive(Debug, Serialize, Deserialize)]
struct ConvertRequest {
    datetime_str: String,
    timezone: String,
}

#[derive(Debug, Serialize, Deserialize)]
struct ConvertResponse {
    success: bool,
    timestamp: Option<i64>,
    error: Option<String>,
}

// 反向转换：时间戳 → 时间字符串
// @Entity 时间戳→时间转换请求/响应体
#[derive(Debug, Serialize, Deserialize)]
struct TimestampRequest {
    timestamp_ms: i64,
    timezone: String,
}

#[derive(Debug, Serialize, Deserialize)]
struct DatetimeResponse {
    success: bool,
    datetime_str: Option<String>,
    error: Option<String>,
}

// ==================== 配置 ====================

// @Entity 存档位配置：文件列表、备份序号、关键文件匹配模式
#[derive(Debug, Serialize, Deserialize, Clone)]
struct SlotConfig {
    id: String,
    name: String,
    #[serde(default)]
    file_paths: Vec<String>,
    #[serde(default = "default_next_backup_number")]
    next_backup_number: u32,
    #[serde(default)]
    key_file_patterns: Vec<String>,
}

fn default_next_backup_number() -> u32 { 1 }

// @Entity 游戏实体，ID 不可变（目录路径由 ID 构建，支持改名）
// @see id-based-entities skill
#[derive(Debug, Serialize, Deserialize, Clone)]
struct GameConfig {
    id: String,
    name: String,
    #[serde(default)]
    slots: Vec<SlotConfig>,
    #[serde(default)]
    pinned: bool,
}

// ==================== 时区转换套件 ====================

// @Entity 时区套件：包含时区、格式、置顶与排序
#[derive(Debug, Serialize, Deserialize, Clone)]
struct TimezoneSet {
    id: String,              // "beijing" or UUID
    timezone: String,        // "Asia/Shanghai"
    #[serde(default)]
    datetime_format: String, // "YYYY-MM-DD HH:mm:ss"
    #[serde(default)]
    pinned: bool,
    #[serde(default)]
    sort_order: u32,
}

fn default_timezone_sets() -> Vec<TimezoneSet> {
    vec![
        TimezoneSet {
            id: "beijing".to_string(),
            timezone: "Asia/Shanghai".to_string(),
            datetime_format: String::new(),
            pinned: false,
            sort_order: 0,
        },
        TimezoneSet {
            id: "india".to_string(),
            timezone: "Asia/Kolkata".to_string(),
            datetime_format: String::new(),
            pinned: false,
            sort_order: 1,
        },
    ]
}

// @Entity 应用配置根结构，对应 config.json 完整 schema
// 修改字段时需同步前端 currentConfig 访问路径
#[derive(Debug, Serialize, Deserialize, Clone)]
struct AppConfig {
    #[serde(default)]
    backup_root: String,
    #[serde(default)]
    games: Vec<GameConfig>,
    #[serde(default = "default_timezone_sets")]
    timezone_sets: Vec<TimezoneSet>,
    #[serde(default = "default_theme")]
    theme: String,
    #[serde(default = "default_tab_order")]
    tab_order: Vec<String>,
    #[serde(default)]
    todos: Vec<TodoItem>,
    #[serde(default)]
    auto_start: bool,
    #[serde(default = "default_true")]
    reminder_enabled: bool,
    #[serde(default)]
    holiday_data: Vec<HolidayYearConfig>,
    #[serde(default)]
    screenshot_sources: Vec<ScreenshotSource>,
    #[serde(default)]
    banners: Vec<BannerEntry>,
    #[serde(default)]
    pending_reminders: Vec<PendingReminder>,
}

// @Entity 截图来源/条目/自动检测结果
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
#[allow(dead_code)]
struct ScreenshotEntry {
    file_name: String,
    path: String,
    modified: String,
    size: u64,
    source_id: String,
    #[serde(default)]
    game_name: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
struct DetectedSource {
    name: String,
    path: String,
    count: u32,
    source_type: String,
}

fn default_theme() -> String { "system".to_string() }

fn default_true() -> bool { true }

fn default_tab_order() -> Vec<String> {
    vec!["convert".to_string(), "backup".to_string(), "todo".to_string(), "screenshot".to_string(), "log".to_string()]
}

impl Default for AppConfig {
    fn default() -> Self {
        AppConfig {
            backup_root: String::new(),
            games: vec![],
            timezone_sets: default_timezone_sets(),
            theme: default_theme(),
            tab_order: default_tab_order(),
            todos: vec![],
            auto_start: false,
            reminder_enabled: true,
            holiday_data: vec![],
            screenshot_sources: vec![],
            banners: vec![],
            pending_reminders: vec![],
        }
    }
}

// ==================== 待办数据结构 ====================

// @Entity 待办/提醒/横幅数据结构

#[derive(Debug, Serialize, Deserialize, Clone)]
struct TodoItem {
    #[serde(default)]
    id: String,
    #[serde(default)]
    text: String,
    #[serde(default)]
    done: bool,
    #[serde(default)]
    priority: i32,
    #[serde(default)]
    paused: bool,
    #[serde(default)]
    due_date: Option<String>,
    #[serde(default)]
    tags: Vec<String>,
    #[serde(default)]
    notes: String,
    #[serde(default)]
    reminder: Option<ReminderConfig>,
    #[serde(default)]
    repeat: Option<String>,
    #[serde(default)]
    sort_order: i32,
    #[serde(default)]
    created_at: String,
    #[serde(default)]
    completed_at: Option<String>,
    #[serde(default)]
    parent_id: Option<String>,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
struct ReminderConfig {
    #[serde(default)]
    datetime: String,
    #[serde(default)]
    workday_time: Option<String>,  // "HH:MM"
    #[serde(default)]
    restday_time: Option<String>,  // "HH:MM"
    #[serde(default)]
    sound: bool,
    #[serde(default)]
    day_mode: String,   // "fixed" | "last" | "second_last" | "third_last"，仅 monthly 有效
}

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
enum NotificationLevel {
    #[default]
    #[serde(rename = "Info")]
    Info,
    #[serde(rename = "Success")]
    Success,
    #[serde(rename = "Warning")]
    Warning,
    #[serde(rename = "Error")]
    Error,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
struct BannerEntry {
    #[serde(default)]
    id: String,
    #[serde(default)]
    level: NotificationLevel,
    #[serde(default)]
    source: String,
    #[serde(default)]
    title: String,
    #[serde(default)]
    message: String,
    #[serde(default)]
    created_at: i64,
    #[serde(default = "default_auto_dismiss")]
    auto_dismiss: bool,
    #[serde(default)]
    read: bool,
}

fn default_auto_dismiss() -> bool { true }

// @Service 通用通知推送：任意模块调用，写入 config.banners
fn push_notification(
    app: &tauri::AppHandle,
    level: NotificationLevel,
    source: &str,
    title: &str,
    message: &str,
) {
    use std::time::{SystemTime, UNIX_EPOCH};
    let mut config = load_config(app);
    let auto_dismiss = matches!(level, NotificationLevel::Info | NotificationLevel::Success | NotificationLevel::Warning);
    config.banners.push(BannerEntry {
        id: format!("notif_{}", SystemTime::now().duration_since(UNIX_EPOCH).unwrap().as_nanos()),
        level,
        source: source.to_string(),
        title: title.to_string(),
        message: message.to_string(),
        created_at: chrono::Utc::now().timestamp_millis(),
        auto_dismiss,
        read: false,
    });
    save_config(app, &config);
}

#[derive(Debug, Serialize, Deserialize, Clone)]
struct PendingReminder {
    id: String,
    todo_id: String,
    text: String,
    fire_at: i64,
    sound: bool,
    #[serde(default)]
    repeat: Option<String>,
    #[serde(default)]
    workday_time: Option<String>,
    #[serde(default)]
    restday_time: Option<String>,
    #[serde(default)]
    day_mode: String,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
struct HolidayYearConfig {
    #[serde(default)]
    year: i32,
    #[serde(default)]
    holidays: Vec<HolidayPeriod>,
    #[serde(default)]
    makeup_days: Vec<String>,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
struct HolidayPeriod {
    #[serde(default)]
    name: String,
    #[serde(default)]
    start: String,
    #[serde(default)]
    end: String,
}

// ==================== 节假日判定 ====================

// @Service 节假日判定：补班日优先 → 假期段 → 周末兜底
// JS 端 getDayType() 保持独立实现，修改需同步两端
fn get_day_type(date: &chrono::NaiveDate, holiday: Option<&HolidayYearConfig>) -> &'static str {
    let mmdd = format!("{:02}{:02}", date.month(), date.day());
    let weekday = date.weekday().num_days_from_monday(); // 0=Mon..6=Sun

    if let Some(h) = holiday {
        // 补班日（周末上班）→ 工作日
        if h.makeup_days.contains(&mmdd) {
            return "workday";
        }
        // 在假期段内 → 休息日（跨年段如 1228-0102 也算在内）
        if h.holidays.iter().any(|p| {
            if p.start.as_str() <= p.end.as_str() {
                mmdd >= p.start && mmdd <= p.end
            } else {
                mmdd >= p.start || mmdd <= p.end
            }
        }) {
            return "restday";
        }
    }

    // 周末且非补班 → 休息日
    if weekday >= 5 { // 周六=5, 周日=6
        return "restday";
    }

    "workday"
}

// ==================== 备份信息 ====================

// @Entity 备份元数据，对应 meta.json 序列化结构

#[derive(Debug, Serialize, Deserialize, Clone)]
struct BackupInfo {
    folder_name: String,
    display_name: String,
    description: String,
    original_file_path: String,
    content_hash: String,
    pinned: bool,
}

// ==================== 操作结果 ====================

// @Entity 写操作统一响应体 { success, message }
#[derive(Debug, Serialize, Deserialize)]
struct OpResult {
    success: bool,
    message: String,
}

// @Entity 恢复文件选择时的文件信息
#[derive(Debug, Serialize, Deserialize)]
struct FileInfo {
    name: String,
    original_path: String,
}

// @Entity 恢复操作响应体（含多文件选择、备份确认状态）
#[derive(Debug, Serialize, Deserialize)]
struct RestoreResult {
    success: bool,
    message: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    available_files: Option<Vec<FileInfo>>,
    #[serde(skip_serializing_if = "Option::is_none")]
    need_backup_confirm: Option<String>,
}

/// 校验路径组件，防止目录遍历
// @Utils 路径安全校验：阻止 ..、/、\\ 等目录穿越字符
fn sanitize_path_component(name: &str) -> Result<String, OpResult> {
    if name.contains("..") || name.contains('/') || name.contains('\\') {
        return Err(OpResult {
            success: false,
            message: "无效的路径".to_string(),
        });
    }
    Ok(name.to_string())
}

// ==================== 截图画廊 ====================

const IMAGE_EXTENSIONS: [&str; 6] = ["png", "jpg", "jpeg", "webp", "bmp", "gif"];

// @Utils 检测文件是否为支持的图片格式（png/jpg/webp/bmp/gif）
fn is_image_file(path: &std::path::Path) -> bool {
    path.extension()
        .and_then(|e| e.to_str())
        .map(|e| IMAGE_EXTENSIONS.contains(&e.to_lowercase().as_str()))
        .unwrap_or(false)
}

// ---- LRU Cache for screenshots base64 ----

// @Entity LRU 图片缓存：100 条目 / 500MB，Mutex + OnceLock 全局单例

struct Base64CacheEntry {
    data: String,
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
            size,
        };
        self.current_bytes += size;
        self.entries.insert(key.clone(), entry);
        self.access_order.push(key);
    }
}

#[tauri::command]
// @Endpoint 递归扫描截图目录（最多 2 层/50 张），按修改时间倒序
// 安全校验：canonicalize 防路径穿越 + source_id 授权检查
async fn scan_screenshots(
    app: tauri::AppHandle,
    source_path: String,
) -> Result<Vec<ScreenshotEntry>, String> {
    let config = load_config(&app);
    let resolved_path = std::path::PathBuf::from(&source_path);

    // Security: canonicalize to detect path traversal
    let canonical = resolved_path.canonicalize().map_err(|_| "路径不存在".to_string())?;

    // Verify that resolved path is under a registered source and capture source_id
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

    // Run blocking I/O on thread pool
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
                    // Combine metadata calls: is_dir/is_file share one syscall
                    if let Ok(meta) = path.metadata() {
                        if meta.is_dir() && depth < 2 {
                            // Depth limit: at most 2 sub-directory levels from root
                            dirs.push((path, depth + 1));
                        } else if meta.is_file() && is_image_file(&path) && results.len() < 50 {
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

#[tauri::command]
// @Endpoint 批量读取截图 → base64 data URI，LRU 缓存加速
async fn get_screenshot_base64_batch(
    paths: Vec<String>,
) -> Result<Vec<String>, String> {
    use std::sync::OnceLock;
    static CACHE: OnceLock<std::sync::Mutex<Base64Cache>> = OnceLock::new();
    let cache = CACHE.get_or_init(|| std::sync::Mutex::new(Base64Cache::new()));

    let engine = base64::engine::general_purpose::STANDARD;

    let results = tauri::async_runtime::spawn_blocking(move || {
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
                Err(_) => batch.push(String::new()),
            }
        }
        batch
    }).await.map_err(|e| e.to_string())?;

    Ok(results)
}

// ---- VDF Parser ----

// @Utils Steam VDF 格式解析器（char-indexed UTF-8 安全）

/// Skip whitespace and line comments in VDF format (char-indexed, UTF-8 safe)
fn skip_vdf_whitespace(chars: &[char], pos: &mut usize) {
    while *pos < chars.len() {
        match chars[*pos] {
            ' ' | '\t' | '\n' | '\r' => *pos += 1,
            '/' if *pos + 1 < chars.len() && chars[*pos + 1] == '/' => {
                *pos += 2;
                while *pos < chars.len() && chars[*pos] != '\n' {
                    *pos += 1;
                }
            }
            _ => break,
        }
    }
}

/// Parse a quoted VDF string value (char-indexed, UTF-8 safe)
fn parse_vdf_value(chars: &[char], pos: &mut usize) -> Option<String> {
    skip_vdf_whitespace(chars, pos);
    if *pos >= chars.len() || chars[*pos] != '"' {
        return None;
    }
    *pos += 1;

    let mut result = String::new();
    while *pos < chars.len() {
        match chars[*pos] {
            '"' => {
                *pos += 1;
                return Some(result);
            }
            '\\' if *pos + 1 < chars.len() => {
                *pos += 1;
                result.push(chars[*pos]);
                *pos += 1;
            }
            c => {
                result.push(c);
                *pos += 1;
            }
        }
    }
    None
}

/// Parse a VDF object block (char-indexed, UTF-8 safe)
fn parse_vdf_object(
    chars: &[char],
    pos: &mut usize,
) -> Option<serde_json::Map<String, serde_json::Value>> {
    skip_vdf_whitespace(chars, pos);
    if *pos >= chars.len() || chars[*pos] != '{' {
        return None;
    }
    *pos += 1;

    let mut map = serde_json::Map::new();

    loop {
        skip_vdf_whitespace(chars, pos);
        if *pos >= chars.len() {
            return None;
        }
        if chars[*pos] == '}' {
            *pos += 1;
            return Some(map);
        }

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

/// Parse a VDF string into serde_json::Value (UTF-8 safe via char-indexed parser)
fn parse_vdf(vdf: &str) -> serde_json::Value {
    let chars: Vec<char> = vdf.chars().collect();
    let mut pos = 0;
    let mut map = serde_json::Map::new();

    loop {
        skip_vdf_whitespace(&chars, &mut pos);
        if pos >= chars.len() {
            break;
        }

        if let Some(key) = parse_vdf_value(&chars, &mut pos) {
            skip_vdf_whitespace(&chars, &mut pos);
            if pos < chars.len() && chars[pos] == '{' {
                if let Some(obj) = parse_vdf_object(&chars, &mut pos) {
                    map.insert(key, serde_json::Value::Object(obj));
                }
            } else if let Some(val) = parse_vdf_value(&chars, &mut pos) {
                map.insert(key, serde_json::Value::String(val));
            }
        } else {
            break;
        }
    }

    serde_json::Value::Object(map)
}

// ---- Steam Path Detection ----

/// Detect Steam installation path using registry or common fallback locations
fn detect_steam_path() -> Option<String> {
    let output = std::process::Command::new("reg")
        .args(["query", r"HKCU\Software\Valve\Steam", "/v", "SteamPath"])
        .output()
        .ok()?;

    if output.status.success() {
        let stdout = String::from_utf8_lossy(&output.stdout);
        for line in stdout.lines() {
            let trimmed = line.trim();
            if let Some(idx) = trimmed.find("REG_SZ") {
                let value = trimmed[idx + 6..].trim();
                if !value.is_empty() {
                    return Some(value.to_string());
                }
            }
        }
    }

    // Fallback: check common installation paths
    let common_paths = [
        r"C:\Program Files (x86)\Steam",
        r"C:\Program Files\Steam",
    ];

    for path in &common_paths {
        if std::path::Path::new(path).exists() {
            return Some(path.to_string());
        }
    }

    None
}

/// Get the user's Documents directory path
fn get_documents_dir() -> String {
    let userprofile =
        std::env::var("USERPROFILE").unwrap_or_else(|_| "C:\\Users\\Default".to_string());
    format!("{}\\Documents", userprofile)
}

/// Count image files in a directory (non-recursive)
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

// @Utils 从 Steam appmanifest.acf 中查找游戏名称

/// Look up a Steam game name from app manifest in any library folder
fn get_steam_game_name(
    steam_path: &str,
    app_id: &str,
    extra_lib_paths: &[std::path::PathBuf],
) -> Option<String> {
    let mut search_paths = Vec::new();
    search_paths.push(std::path::PathBuf::from(steam_path));
    search_paths.extend_from_slice(extra_lib_paths);

    for lib_path in &search_paths {
        let manifest_path = lib_path.join("steamapps").join(format!("appmanifest_{}.acf", app_id));
        if !manifest_path.is_file() {
            continue;
        }
        if let Ok(content) = std::fs::read_to_string(&manifest_path) {
            let parsed = parse_vdf(&content);
            if let Some(root) = parsed.as_object() {
                if let Some(app_state) = root.get("AppState").and_then(|v| v.as_object()) {
                    if let Some(name) = app_state.get("name").and_then(|v| v.as_str()) {
                        if !name.is_empty() {
                            return Some(name.to_string());
                        }
                    }
                }
            }
        }
    }

    None
}

// @Endpoint 自动检测 Steam + 米哈游系列截图目录
#[tauri::command]
async fn detect_screenshot_sources(_app: tauri::AppHandle) -> Result<Vec<DetectedSource>, String> {
    let sources = tauri::async_runtime::spawn_blocking(move || {
        let mut sources: Vec<DetectedSource> = Vec::new();
        let documents = get_documents_dir();

        // ---- Steam Screenshots ----
        let steam_path = detect_steam_path();
        if let Some(ref steam_path) = steam_path {
            // Collect additional library paths from libraryfolders.vcf
            let mut extra_lib_paths: Vec<std::path::PathBuf> = Vec::new();
            let lf_path = std::path::Path::new(steam_path)
                .join("steamapps")
                .join("libraryfolders.vcf");
            if lf_path.is_file() {
                if let Ok(content) = std::fs::read_to_string(&lf_path) {
                    let parsed = parse_vdf(&content);
                    if let Some(top_obj) = parsed.as_object() {
                        if let Some(lib_folders) =
                            top_obj.get("libraryfolders").and_then(|v| v.as_object())
                        {
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

            // Scan userdata for screenshots
            let userdata_dir = std::path::Path::new(steam_path).join("userdata");
            if let Ok(user_entries) = std::fs::read_dir(&userdata_dir) {
                for user_entry in user_entries.flatten() {
                    let remote_dir = user_entry.path().join("760").join("remote");
                    if !remote_dir.is_dir() {
                        continue;
                    }
                    if let Ok(app_entries) = std::fs::read_dir(&remote_dir) {
                        for app_entry in app_entries.flatten() {
                            let screenshots_dir = app_entry.path().join("screenshots");
                            if !screenshots_dir.is_dir() {
                                continue;
                            }

                            let count = count_images_in_dir(&screenshots_dir);
                            if count == 0 {
                                continue;
                            }

                            let app_id =
                                app_entry.file_name().to_string_lossy().to_string();
                            let game_name =
                                get_steam_game_name(steam_path, &app_id, &extra_lib_paths)
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

        // ---- Mihoyo Screenshots ----
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
    })
    .await
    .map_err(|e| e.to_string())?;

    Ok(sources)
}

// ---- UUID v4 Helper ----

// @Utils 基于时间戳的 UUID v4 生成器
fn uuid_v4() -> String {
    let now = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap();
    let n = now.as_nanos();
    format!(
        "{:08x}-{:04x}-4{:03x}-{:04x}-{:012x}",
        (n >> 80) as u32,
        (n >> 64) as u16,
        (n >> 52) as u16 & 0xfff,
        0x4000 | ((n >> 48) as u16 & 0x3fff),
        n as u64 & 0xffffffffffff
    )
}

// ---- Screenshot CRUD Commands ----

// @Endpoint 添加截图来源目录
#[tauri::command]
fn add_screenshot_source(
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

// @Endpoint 删除截图文件（canonicalize 防路径穿越）
#[tauri::command]
fn delete_screenshot(
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

// ==================== 配置持久化 ====================

// @Repository 获取 config.json 路径（app_data_dir 下）
fn config_path(app: &tauri::AppHandle) -> PathBuf {
    app.path()
        .app_data_dir()
        .expect("无法获取应用数据目录")
        .join("config.json")
}

// @Repository 读取并解析 config.json，含旧格式迁移
// 安全写入：先写 .tmp → rename 原子替换，写入前备份 .bak
fn load_config(app: &tauri::AppHandle) -> AppConfig {
    let path = config_path(app);
    if path.exists() {
        match fs::read_to_string(&path) {
            Ok(json) => {
                let raw: serde_json::Value = serde_json::from_str(&json).unwrap_or_default();
                let config_result = serde_json::from_value(raw.clone());
                let mut config: AppConfig = match config_result {
                    Ok(c) => c,
                    Err(e) => {
                        log_error(app, &format!("Config parse error: {}", e));
                        AppConfig::default()
                    }
                };
                // 迁移旧格式: file_path (String) → file_paths (Vec)
                if let Some(games) = raw["games"].as_array() {
                    for (i, game) in games.iter().enumerate() {
                        if let Some(slots) = game["slots"].as_array() {
                            for (j, slot) in slots.iter().enumerate() {
                                if config
                                    .games
                                    .get(i)
                                    .and_then(|g| g.slots.get(j))
                                    .map(|s| s.file_paths.is_empty())
                                    .unwrap_or(false)
                                {
                                    if let Some(old_path) = slot["file_path"].as_str() {
                                        if !old_path.is_empty() {
                                            if let Some(g) = config.games.get_mut(i) {
                                                if let Some(s) = g.slots.get_mut(j) {
                                                    s.file_paths = vec![old_path.to_string()];
                                                }
                                            }
                                        }
                                    }
                                }
                            }
                        }
                    }
                }
                // 迁移旧格式: reminder.datetime → workday_time/restday_time
                for todo in config.todos.iter_mut() {
                    let needs_migrate = todo.reminder.as_ref().map_or(false, |r| {
                        r.workday_time.is_none()
                            && r.restday_time.is_none()
                            && !r.datetime.is_empty()
                            && r.datetime.len() >= 16
                    });
                    // 仅迁移重复待办（repeat.is_some() 如 daily/weekly）：
                    // 重复待办的触发时间取决于当前是工作日还是休息日，需要 workday_time/restday_time 字段。
                    // 非重复的一次性待办使用固定的 reminder.datetime 就够了，不需迁移。
                    if needs_migrate && todo.repeat.is_some() {
                        if let Some(ref mut rem) = todo.reminder {
                            let time = rem.datetime.get(11..16).unwrap_or("00:00").to_string();
                            rem.workday_time = Some(time.clone());
                            rem.restday_time = Some(time);
                        }
                    }
                }
                config
            }
            Err(e) => {
                log_error(app, &format!("Config read error: {}", e));
                AppConfig::default()
            },
        }
    } else {
        AppConfig::default()
    }
}

// @Utils 后端日志写入（与前端日志同文件）

/// 写入错误日志到应用日志目录（Tauri 日志系统低层写入，不依赖前端）
fn log_error(app: &tauri::AppHandle, msg: &str) {
    if let Ok(app_dir) = app.path().app_data_dir() {
        let log_dir = app_dir.join("logs");
        let _ = fs::create_dir_all(&log_dir);
        let today = chrono::Local::now().format("%Y-%m-%d").to_string();
        let log_path = log_dir.join(format!("{}.log", today));
        if let Ok(mut file) = fs::OpenOptions::new().create(true).append(true).open(&log_path) {
            let ts = chrono::Local::now().format("%H:%M:%S%.3f");
            let _ = writeln!(file, "[{}][error] {}", ts, msg);
            let _ = file.flush();
        }
    }
}

/// 写入信息日志到应用日志目录（同 log_error，但标记 [info] 级别）
fn log_info(app: &tauri::AppHandle, msg: &str) {
    if let Ok(app_dir) = app.path().app_data_dir() {
        let log_dir = app_dir.join("logs");
        let _ = fs::create_dir_all(&log_dir);
        let today = chrono::Local::now().format("%Y-%m-%d").to_string();
        let log_path = log_dir.join(format!("{}.log", today));
        if let Ok(mut file) = fs::OpenOptions::new().create(true).append(true).open(&log_path) {
            let ts = chrono::Local::now().format("%H:%M:%S%.3f");
            let _ = writeln!(file, "[{}][info] {}", ts, msg);
            let _ = file.flush();
        }
    }
}

// @Repository 原子写入配置：tmp + rename，写入前备份已有文件

fn save_config(app: &tauri::AppHandle, config: &AppConfig) {
    let path = config_path(app);
    if let Some(parent) = path.parent() {
        let _ = fs::create_dir_all(parent);
    }

    // 备份旧配置：写新配置前将已有 config.json 备份为 config.json.bak
    if path.exists() {
        let bak_path = path.with_extension("json.bak");
        if let Err(e) = fs::copy(&path, &bak_path) {
            log_error(app, &format!("备份配置文件失败: {}", e));
        }
    }

    if let Ok(json) = serde_json::to_string_pretty(config) {
        // 原子写入：先写临时文件再 rename，防止崩溃时 config.json 损坏
        let tmp_path = path.with_extension("tmp");
        if let Err(e) = fs::write(&tmp_path, &json) {
            log_error(app, &format!("写入临时配置文件失败: {}", e));
            return;
        }
        if let Err(e) = fs::rename(&tmp_path, &path) {
            log_error(app, &format!("重命名配置文件失败: {}", e));
            let _ = fs::remove_file(&tmp_path);
        }
    }
}

// ==================== 开机自启 ====================

// @Setup Windows 注册表开机自启（reg.exe，仅在 set_config 中调）
fn set_auto_start(app: &tauri::AppHandle, enabled: bool) {
    let exe_path = std::env::current_exe().ok();
    let app_name = "HRB Tools";

    if enabled {
        if let Some(path) = exe_path {
            let path_str = format!("\"{}\" --minimized", path.to_string_lossy());
            match std::process::Command::new("reg")
                .args(["add", "HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Run", "/v", app_name, "/t", "REG_SZ", "/d", &path_str, "/f"])
                .output()
            {
                Ok(o) => {
                    if !o.status.success() {
                        log_error(app, &format!("[set_auto_start] reg.exe add failed: {}", String::from_utf8_lossy(&o.stderr)));
                    }
                }
                Err(e) => {
                    log_error(app, &format!("[set_auto_start] reg.exe add error: {}", e));
                }
            }
        }
    } else {
        match std::process::Command::new("reg")
            .args(["delete", "HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Run", "/v", app_name, "/f"])
            .output()
        {
            Ok(o) => {
                if !o.status.success() {
                    log_error(app, &format!("[set_auto_start] reg.exe delete failed: {}", String::from_utf8_lossy(&o.stderr)));
                }
            }
            Err(e) => {
                log_error(app, &format!("[set_auto_start] reg.exe delete error: {}", e));
            }
        }
    }
}

// ==================== 时区工具 ====================

// @Endpoint datetime→timestamp 转换，支持 4 种输入格式
#[tauri::command]
fn convert_to_timestamp(request: ConvertRequest) -> ConvertResponse {
    // 解析时区
    let tz = match resolve_timezone(&request.timezone) {
        Some(tz) => tz,
        None => {
            return ConvertResponse {
                success: false,
                timestamp: None,
                error: Some(format!("无效时区: {}", request.timezone)),
            };
        }
    };

    // 支持多种时间格式
    let formats = [
        "%Y-%m-%d %H:%M:%S",
        "%Y/%m/%d %H:%M:%S",
        "%Y-%m-%dT%H:%M:%S",
        "%Y-%m-%d %H:%M",
    ];

    let naive_dt = formats
        .iter()
        .find_map(|&fmt| NaiveDateTime::parse_from_str(&request.datetime_str, fmt).ok());

    let naive_dt = match naive_dt {
        Some(dt) => dt,
        None => {
            return ConvertResponse {
                success: false,
                timestamp: None,
                error: Some("无法解析时间，请使用 YYYY-MM-DD HH:MM:SS 格式".to_string()),
            };
        }
    };

    // 本地时区时间 → UTC → Unix 时间戳（毫秒）
    let local_dt = tz.from_local_datetime(&naive_dt).unwrap();
    let utc_dt: DateTime<Utc> = local_dt.with_timezone(&Utc);
    let timestamp = utc_dt.timestamp_millis();

    ConvertResponse {
        success: true,
        timestamp: Some(timestamp),
        error: None,
    }
}

// @Endpoint timestamp→datetime 转换
#[tauri::command]
fn convert_to_datetime(request: TimestampRequest) -> DatetimeResponse {
    let tz = match resolve_timezone(&request.timezone) {
        Some(tz) => tz,
        None => {
            return DatetimeResponse {
                success: false,
                datetime_str: None,
                error: Some(format!("无效时区: {}", request.timezone)),
            };
        }
    };

    // 毫秒时间戳 → UTC → 本地时区时间字符串
    match Utc.timestamp_millis_opt(request.timestamp_ms) {
        chrono::LocalResult::Single(utc_dt) => {
            let local_dt = utc_dt.with_timezone(&tz);
            let datetime_str = local_dt.format("%Y-%m-%d %H:%M:%S").to_string();
            DatetimeResponse {
                success: true,
                datetime_str: Some(datetime_str),
                error: None,
            }
        }
        _ => DatetimeResponse {
            success: false,
            datetime_str: None,
            error: Some("无效的时间戳".to_string()),
        },
    }
}

// @Endpoint 读取/写入完整配置
#[tauri::command]
fn get_config(app: tauri::AppHandle) -> AppConfig {
    load_config(&app)
}

#[tauri::command]
fn set_config(app: tauri::AppHandle, config: AppConfig) -> OpResult {
    log_info(&app, &format!("set_config: auto_start={}, theme={}", config.auto_start, config.theme));
    // 仅 auto_start 变化时才调 reg.exe，避免每次保存都 spawn 进程
    let old = load_config(&app);
    if old.auto_start != config.auto_start {
        set_auto_start(&app, config.auto_start);
    }
    save_config(&app, &config);
    OpResult {
        success: true,
        message: "配置已保存".to_string(),
    }
}

// @Endpoint 读取/保存节假日数据
#[tauri::command]
fn get_holiday_data(app: tauri::AppHandle) -> Vec<HolidayYearConfig> {
    load_config(&app).holiday_data
}

// @Endpoint 保存节假日数据
#[tauri::command]
fn save_holiday_data(app: tauri::AppHandle, data: Vec<HolidayYearConfig>) -> OpResult {
    let mut config = load_config(&app);
    config.holiday_data = data;
    save_config(&app, &config);
    OpResult {
        success: true,
        message: "节假日数据已保存".to_string(),
    }
}

// @Endpoint 系统文件/文件夹选择对话框
#[tauri::command]
fn pick_file(app: tauri::AppHandle, start_dir: Option<String>) -> Option<String> {
    let window = app.get_webview_window("main");
    let mut dialog = rfd::FileDialog::new();
    if let Some(ref w) = window {
        dialog = dialog.set_parent(w);
    }
    if let Some(ref dir) = start_dir {
        if !dir.is_empty() {
            dialog = dialog.set_directory(dir);
        }
    }
    dialog.pick_file()
        .map(|p| p.to_string_lossy().to_string())
}

// @Endpoint 系统文件选择对话框（文件夹模式）
#[tauri::command]
fn pick_directory(app: tauri::AppHandle, start_dir: Option<String>) -> Option<String> {
    let window = app.get_webview_window("main");
    let mut dialog = rfd::FileDialog::new();
    if let Some(ref w) = window {
        dialog = dialog.set_parent(w);
    }
    if let Some(ref dir) = start_dir {
        if !dir.is_empty() {
            dialog = dialog.set_directory(dir);
        }
    }
    dialog.pick_folder()
        .map(|p| p.to_string_lossy().to_string())
}

// @Service 备份列表内部实现（无 IPC，供 create_backup 复用）
fn list_backups_internal(config: &AppConfig, game_id: &str, slot_id: &str) -> Vec<BackupInfo> {
    let game_dir = std::path::PathBuf::from(&config.backup_root)
        .join(game_id)
        .join(slot_id);

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
        .skip(2) // YYYY-MM-DD HH-MM-SS description
        .collect::<Vec<_>>()
        .join(" ");

    Some(BackupInfo {
        folder_name: folder_name.to_string(),
        display_name,
        description,
        original_file_path,
        content_hash,
        pinned,
    })
}

// @Endpoint 创建存档备份：校验路径 → 计算哈希 → 去重检查 → 复制文件 → 写入 meta.json
#[tauri::command]
fn create_backup(
    app: tauri::AppHandle,
    game_id: String,
    slot_id: String,
    file_paths: Vec<String>,
) -> OpResult {
    if let Err(e) = sanitize_path_component(&game_id) { return e; }
    if let Err(e) = sanitize_path_component(&slot_id) { return e; }
    log_info(&app, &format!("create_backup: game={}, slot={}, files={}", game_id, slot_id, file_paths.len()));
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
        let meta_path = std::path::PathBuf::from(&config.backup_root)
            .join(&game_id).join(&slot_id).join(&latest.folder_name).join("meta.json");
        if let Ok(meta_str) = std::fs::read_to_string(&meta_path) {
            if let Ok(meta) = serde_json::from_str::<serde_json::Value>(&meta_str) {
                // 检查新格式 "files"
                let all_match = if let Some(old_files) = meta["files"].as_object() {
                    file_hashes.iter().all(|(name, hash)| {
                        old_files.get(name)
                            .and_then(|f| f["content_hash"].as_str())
                            .map(|h| h == hash)
                            .unwrap_or(false)
                    }) && file_hashes.len() == old_files.len()
                } else {
                    // 旧格式: 单文件比对
                    file_hashes.len() == 1
                        && meta["content_hash"].as_str().map(|h| h == file_hashes.values().next().unwrap()).unwrap_or(false)
                };
                if all_match {
                    return OpResult {
                        success: false,
                        message: "存档未变化，无需重复备份".to_string(),
                    };
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

    // 9. 写入 meta.json (新格式)
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

// @Endpoint 获取备份列表（按修改时间倒序）
#[tauri::command]
fn list_backups(app: tauri::AppHandle, game_id: String, slot_id: String) -> Vec<BackupInfo> {
    if sanitize_path_component(&game_id).is_err() || sanitize_path_component(&slot_id).is_err() {
        log_error(&app, &format!("SECURITY: blocked path component: game={}, slot={}", game_id, slot_id));
        return vec![];
    }
    let config = load_config(&app);
    let result = list_backups_internal(&config, &game_id, &slot_id);
    if result.is_empty() {
        let game_dir = std::path::PathBuf::from(&config.backup_root).join(&game_id).join(&slot_id);
        if !game_dir.exists() {
            log_info(&app, &format!("list_backups: dir not found: {:?}", game_dir));
        }
    }
    result
}

// @Endpoint 删除备份目录（rmtree 递归删除）
#[tauri::command]
fn delete_backup(
    app: tauri::AppHandle,
    game_id: String,
    slot_id: String,
    folder_name: String,
) -> OpResult {
    if let Err(e) = sanitize_path_component(&game_id) { return e; }
    if let Err(e) = sanitize_path_component(&slot_id) { return e; }
    if let Err(e) = sanitize_path_component(&folder_name) { return e; }
    log_info(&app, &format!("delete_backup: folder={}", folder_name));
    let config = load_config(&app);
    let backup_dir = std::path::PathBuf::from(&config.backup_root)
        .join(&game_id)
        .join(&slot_id)
        .join(&folder_name);

    if !backup_dir.exists() {
        return OpResult { success: false, message: "备份不存在".to_string() };
    }

    match std::fs::remove_dir_all(&backup_dir) {
        Ok(_) => OpResult { success: true, message: "备份已删除".to_string() },
        Err(e) => OpResult { success: false, message: format!("删除失败: {}", e) },
    }
}

// @Endpoint 重命名备份目录（显示名/描述）
#[tauri::command]
fn rename_backup(
    app: tauri::AppHandle,
    game_id: String,
    slot_id: String,
    folder_name: String,
    new_description: String,
) -> OpResult {
    if let Err(e) = sanitize_path_component(&game_id) { return e; }
    if let Err(e) = sanitize_path_component(&slot_id) { return e; }
    if let Err(e) = sanitize_path_component(&folder_name) { return e; }
    if let Err(e) = sanitize_path_component(&new_description) { return e; }
    let config = load_config(&app);
    let game_dir = std::path::PathBuf::from(&config.backup_root)
        .join(&game_id)
        .join(&slot_id);

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

// @Endpoint 恢复备份含三种流程：直接恢复/多文件选择/需要先备份确认
#[tauri::command]
fn restore_backup(
    app: tauri::AppHandle,
    game_id: String,
    slot_id: String,
    folder_name: String,
    skip_backup: bool,
    selected_files: Option<Vec<String>>,
) -> RestoreResult {
    log_info(&app, &format!("restore_backup: folder={}, skip_backup={}", folder_name, skip_backup));
    if let Err(e) = sanitize_path_component(&game_id) {
        return RestoreResult { success: false, message: e.message, available_files: None, need_backup_confirm: None };
    }
    if let Err(e) = sanitize_path_component(&slot_id) {
        return RestoreResult { success: false, message: e.message, available_files: None, need_backup_confirm: None };
    }
    if let Err(e) = sanitize_path_component(&folder_name) {
        return RestoreResult { success: false, message: e.message, available_files: None, need_backup_confirm: None };
    }
    let config = load_config(&app);
    let backup_dir = std::path::PathBuf::from(&config.backup_root)
        .join(&game_id)
        .join(&slot_id)
        .join(&folder_name);

    if !backup_dir.exists() {
        return RestoreResult { success: false, message: "备份不存在".to_string(), available_files: None, need_backup_confirm: None };
    }

    // 读取 meta.json，收集文件信息
    let meta_path = backup_dir.join("meta.json");
    let files_info: Vec<FileInfo> = if meta_path.exists() {
        let meta_str = std::fs::read_to_string(&meta_path).unwrap_or_default();
        if let Ok(meta) = serde_json::from_str::<serde_json::Value>(&meta_str) {
            if let Some(files) = meta["files"].as_object() {
                files.iter().map(|(name, info)| {
                    FileInfo {
                        name: name.clone(),
                        original_path: info["original_path"].as_str().unwrap_or("").to_string(),
                    }
                }).collect()
            } else if let Some(original_path) = meta["original_file_path"].as_str() {
                // 旧格式向后兼容
                let backup_file = find_backup_file(&backup_dir);
                let name = backup_file
                    .as_ref()
                    .and_then(|p| p.file_name())
                    .map(|n| n.to_string_lossy().to_string())
                    .unwrap_or_else(|| "save.dat".to_string());
                vec![FileInfo { name, original_path: original_path.to_string() }]
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
        return RestoreResult { success: false, message: "备份中没有文件信息".to_string(), available_files: None, need_backup_confirm: None };
    }

    // 多文件且未指定 selected_files 时返回文件列表
    if files_info.len() > 1 && selected_files.is_none() {
        return RestoreResult {
            success: false,
            message: "请选择要恢复的文件".to_string(),
            available_files: Some(files_info),
            need_backup_confirm: None,
        };
    }

    // 筛选要恢复的文件
    let to_restore: Vec<&FileInfo> = if let Some(ref selected) = selected_files {
        files_info.iter().filter(|f| selected.contains(&f.name)).collect()
    } else {
        files_info.iter().collect()
    };

    if to_restore.is_empty() {
        return RestoreResult { success: false, message: "未选择要恢复的文件".to_string(), available_files: None, need_backup_confirm: None };
    }

    // 检查原始文件是否需要先备份
    if !skip_backup {
        let needs_backup = to_restore.iter().any(|f| {
            std::path::Path::new(&f.original_path).exists()
        });
        if needs_backup {
            let patterns: Vec<String> = config.games.iter()
                .find(|g| g.id == game_id)
                .and_then(|g| g.slots.iter().find(|s| s.id == slot_id))
                .map(|s| s.key_file_patterns.clone())
                .unwrap_or_default();

            let first_original = &to_restore[0].original_path;
            let current_hash = compute_single_hash(first_original.clone(), patterns).unwrap_or_default();
            let hash_match = list_backups_internal(&config, &game_id, &slot_id)
                .iter()
                .any(|b| b.content_hash == current_hash);

            if !hash_match {
                return RestoreResult {
                    success: false,
                    message: "目标文件未备份，请确认".to_string(),
                    available_files: None,
                    need_backup_confirm: Some(first_original.clone()),
                };
            }
        }
    }

    // 逐个恢复选中文件
    let mut restored = 0;
    for file in &to_restore {
        let backup_file = backup_dir.join(&file.name);
        if !backup_file.exists() {
            continue;
        }
        // 确保目标目录存在
        if let Some(parent) = std::path::Path::new(&file.original_path).parent() {
            let _ = std::fs::create_dir_all(parent);
        }
        match std::fs::copy(&backup_file, &file.original_path) {
            Ok(_) => restored += 1,
            Err(e) => {
                return RestoreResult {
                    success: false,
                    message: format!("恢复 {} 失败: {}", file.name, e),
                    available_files: None,
                    need_backup_confirm: None,
                };
            }
        }
    }

    RestoreResult {
        success: true,
        message: format!("已恢复 {}/{} 个文件", restored, to_restore.len()),
        available_files: None,
        need_backup_confirm: None,
    }
}

// @Utils 在备份目录中找第一个非 meta.json 的文件（旧格式兼容用）
fn find_backup_file(backup_dir: &std::path::Path) -> Option<std::path::PathBuf> {
    std::fs::read_dir(backup_dir).ok()?
        .filter_map(|e| e.ok())
        .filter(|e| e.file_type().map(|t| t.is_file()).unwrap_or(false))
        .filter(|e| e.file_name() != "meta.json")
        .map(|e| e.path())
        .next()
}

// ==================== 哈希计算 ====================

// @Endpoint 计算文件哈希（MD5，支持通配符过滤）
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

// @Utils 计算单个文件 MD5 哈希
fn compute_file_hash(path: &std::path::Path) -> Result<String, String> {
    let file = std::fs::File::open(path)
        .map_err(|e| format!("打开文件失败: {}", e))?;
    let mut reader = BufReader::new(file);
    let mut hasher = Md5::new();
    let mut buf = [0u8; 8192];
    loop {
        let n = reader.read(&mut buf)
            .map_err(|e| format!("读取文件失败: {}", e))?;
        if n == 0 { break; }
        hasher.update(&buf[..n]);
    }
    Ok(format!("{:x}", hasher.finalize()))
}

// @Utils 计算目录哈希：按通配符过滤文件，拼接 MD5
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
            patterns.iter().any(|pat| simple_glob_match(pat, &fname))
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

// @Utils 简单通配符匹配：支持 *xxx、xxx*、*xxx*
fn simple_glob_match(pattern: &str, name: &str) -> bool {
    let pattern = pattern.to_lowercase();
    let name = name.to_lowercase();
    if let Some(suffix) = pattern.strip_prefix('*').and_then(|s| s.strip_suffix('*')) {
        return name.contains(suffix);
    }
    if let Some(suffix) = pattern.strip_prefix('*') {
        return name.ends_with(suffix);
    }
    if let Some(prefix) = pattern.strip_suffix('*') {
        return name.starts_with(prefix);
    }
    name == pattern
}

// @Endpoint 切换备份/游戏置顶状态
#[tauri::command]
fn toggle_backup_pin(
    app: tauri::AppHandle,
    game_id: String,
    slot_id: String,
    folder_name: String,
) -> OpResult {
    if let Err(e) = sanitize_path_component(&game_id) { return e; }
    if let Err(e) = sanitize_path_component(&slot_id) { return e; }
    if let Err(e) = sanitize_path_component(&folder_name) { return e; }
    let config = load_config(&app);
    let backup_dir = std::path::PathBuf::from(&config.backup_root)
        .join(&game_id)
        .join(&slot_id)
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

// @Endpoint 切换游戏置顶状态
#[tauri::command]
fn toggle_game_pin(app: tauri::AppHandle, game_id: String) -> OpResult {
    let mut config = load_config(&app);
    if let Some(game) = config.games.iter_mut().find(|g| g.id == game_id) {
        game.pinned = !game.pinned;
    }
    save_config(&app, &config);
    OpResult { success: true, message: "已更新".to_string() }
}

// @Endpoint 在资源管理器中打开指定路径
#[tauri::command]
fn open_folder(path: String) -> OpResult {
    let path = std::path::Path::new(&path);
    let target = if path.is_dir() {
        path.to_path_buf()
    } else if let Some(parent) = path.parent() {
        parent.to_path_buf()
    } else {
        return OpResult { success: false, message: "无法获取文件夹路径".to_string() };
    };

    if !target.exists() {
        return OpResult { success: false, message: "文件夹不存在".to_string() };
    }

    #[cfg(target_os = "windows")]
    {
        std::process::Command::new("explorer")
            .arg(target.to_string_lossy().as_ref())
            .spawn()
            .map(|_| OpResult { success: true, message: "已打开文件夹".to_string() })
            .unwrap_or(OpResult { success: false, message: "打开文件夹失败".to_string() })
    }

    #[cfg(target_os = "macos")]
    {
        std::process::Command::new("open")
            .arg(target.to_string_lossy().as_ref())
            .spawn()
            .map(|_| OpResult { success: true, message: "已打开文件夹".to_string() })
            .unwrap_or(OpResult { success: false, message: "打开文件夹失败".to_string() })
    }

    #[cfg(target_os = "linux")]
    {
        std::process::Command::new("xdg-open")
            .arg(target.to_string_lossy().as_ref())
            .spawn()
            .map(|_| OpResult { success: true, message: "已打开文件夹".to_string() })
            .unwrap_or(OpResult { success: false, message: "打开文件夹失败".to_string() })
    }
}

// @Endpoint 重算备份文件中所有文件的哈希
#[tauri::command]
fn recompute_backup_hash(
    app: tauri::AppHandle,
    game_id: String,
    slot_id: String,
    folder_name: String,
) -> OpResult {
    if let Err(e) = sanitize_path_component(&game_id) { return e; }
    if let Err(e) = sanitize_path_component(&slot_id) { return e; }
    if let Err(e) = sanitize_path_component(&folder_name) { return e; }
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
        // 新格式: 逐个文件重算哈希
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
    } else if meta["content_hash"].as_str().is_some() {
        // 旧格式兼容: 重算单文件哈希
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
            let mut sorted_entries = entries.clone();
            sorted_entries.sort();
            for entry in &sorted_entries {
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

// ==================== 时区套件管理 ====================

// @Endpoint 时区套件 CRUD
#[tauri::command]
fn add_timezone_set(app: tauri::AppHandle) -> OpResult {
    let mut config = load_config(&app);
    // 取已有最大编号 + 1，避免删除后添加导致 ID 冲突
    let max_id = config.timezone_sets.iter()
        .filter_map(|s| s.id.strip_prefix("set-"))
        .filter_map(|n| n.parse::<u32>().ok())
        .max()
        .unwrap_or(0);
    let id = format!("set-{}", max_id + 1);
    let sort_order = config.timezone_sets.len() as u32;
    config.timezone_sets.push(TimezoneSet {
        id,
        timezone: "Asia/Shanghai".to_string(),
        datetime_format: String::new(),
        pinned: false,
        sort_order,
    });
    save_config(&app, &config);
    OpResult { success: true, message: "已添加".to_string() }
}

// @Endpoint 删除时区套件
#[tauri::command]
fn remove_timezone_set(app: tauri::AppHandle, set_id: String) -> OpResult {
    if set_id == "beijing" {
        return OpResult { success: false, message: "默认时区不可删除".to_string() };
    }
    let mut config = load_config(&app);
    config.timezone_sets.retain(|s| s.id != set_id);
    save_config(&app, &config);
    OpResult { success: true, message: "已删除".to_string() }
}

#[tauri::command]
fn update_timezone_set(app: tauri::AppHandle, set_id: String, timezone: String, datetime_format: String) -> OpResult {
    let mut config = load_config(&app);
    if let Some(set) = config.timezone_sets.iter_mut().find(|s| s.id == set_id) {
        if set_id != "beijing" {
            set.timezone = timezone;
        }
        set.datetime_format = datetime_format;
    }
    save_config(&app, &config);
    OpResult { success: true, message: "已更新".to_string() }
}

// @Endpoint/更新时区套件
#[tauri::command]
fn toggle_timezone_pin(app: tauri::AppHandle, set_id: String) -> OpResult {
    let mut config = load_config(&app);
    if let Some(set) = config.timezone_sets.iter_mut().find(|s| s.id == set_id) {
        set.pinned = !set.pinned;
    }
    save_config(&app, &config);
    OpResult { success: true, message: "已更新".to_string() }
}

// @Endpoint 发送系统通知（notify-rust）
#[tauri::command]
fn send_notification(_app: tauri::AppHandle, title: String, body: String) -> OpResult {
    let _ = notify_rust::Notification::new()
        .summary(&title)
        .body(&body)
        .show();
    OpResult { success: true, message: "已发送".to_string() }
}

#[tauri::command]
fn window_minimize(app: tauri::AppHandle) {
    if let Some(window) = app.get_webview_window("main") {
        let _ = window.hide();
    }
    // 托盘图标已在 setup 中创建
}

#[tauri::command]
fn window_toggle_maximize(app: tauri::AppHandle) {
    if let Some(window) = app.get_webview_window("main") {
        if window.is_maximized().unwrap_or(false) {
            let _ = window.unmaximize();
        } else {
            let _ = window.maximize();
        }
    }
}

#[tauri::command]
fn window_close(app: tauri::AppHandle) {
    app.exit(0);
}

// ==================== 日志命令 ====================

fn get_app_dir(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    app.path().app_data_dir().map_err(|e| e.to_string())
}

// @Endpoint 日志写入/打开目录/读取今日日志
#[tauri::command]
fn log_write(app_handle: tauri::AppHandle, lines: Vec<String>) -> Result<(), String> {
    let app_dir = get_app_dir(&app_handle)?;
    let log_dir = app_dir.join("logs");
    fs::create_dir_all(&log_dir).map_err(|e| e.to_string())?;

    let today = chrono::Local::now().format("%Y-%m-%d").to_string();
    let log_path = log_dir.join(format!("{}.log", today));

    // 写入日志（块作用域确保文件句柄在轮转前关闭）
    {
        let mut file = BufWriter::new(
            fs::OpenOptions::new()
                .create(true)
                .append(true)
                .open(&log_path)
                .map_err(|e| e.to_string())?,
        );
        for line in &lines {
            writeln!(file, "{}", line).map_err(|e| e.to_string())?;
        }
        file.flush().map_err(|e| e.to_string())?;
    } // file 在此关闭

    // 文件 ~10MB 轮转（此时句柄已关闭，Windows 可重命名）
    if let Ok(meta) = fs::metadata(&log_path) {
        if meta.len() > 10 * 1024 * 1024 {
            let bak1 = log_dir.join(format!("{}.1.log", today));
            let bak2 = log_dir.join(format!("{}.2.log", today));
            let _ = fs::remove_file(&bak2);
            let _ = fs::rename(&bak1, &bak2);
            let _ = fs::rename(&log_path, &bak1);
        }
    }

    Ok(())
}

// @Endpoint 打开日志目录
#[tauri::command]
fn open_log_folder(app_handle: tauri::AppHandle) -> Result<(), String> {
    let app_dir = get_app_dir(&app_handle)?;
    let log_dir = app_dir.join("logs");
    fs::create_dir_all(&log_dir).map_err(|e| e.to_string())?;

    #[cfg(target_os = "windows")]
    {
        let path_str = log_dir.to_string_lossy().replace('/', "\\");
        std::process::Command::new("explorer")
            .arg(path_str)
            .spawn()
            .map_err(|e| format!("打开日志文件夹失败: {}", e))?;
    }

    #[cfg(target_os = "macos")]
    {
        std::process::Command::new("open")
            .arg(&log_dir)
            .spawn()
            .map_err(|e| format!("打开日志文件夹失败: {}", e))?;
    }

    #[cfg(target_os = "linux")]
    {
        std::process::Command::new("xdg-open")
            .arg(&log_dir)
            .spawn()
            .map_err(|e| format!("打开日志文件夹失败: {}", e))?;
    }

    Ok(())
}

// @Endpoint 读取今日日志
#[tauri::command]
fn read_today_logs(app_handle: tauri::AppHandle) -> Result<Vec<String>, String> {
    let app_dir = get_app_dir(&app_handle)?;
    let log_dir = app_dir.join("logs");
    let today = chrono::Local::now().format("%Y-%m-%d").to_string();
    let log_path = log_dir.join(format!("{}.log", today));

    if !log_path.exists() {
        return Ok(Vec::new());
    }

    let content = fs::read_to_string(&log_path).map_err(|e| e.to_string())?;
    let lines = content.lines().map(|l| l.to_string()).collect();
    Ok(lines)
}

// @Service 提醒推期逻辑：daily 按工作日/休息日，monthly 支持月末模式

/// 计算每日提醒的下一次触发时间戳（从明天开始扫描）
fn advance_daily_reminder(
    workday_time: &Option<String>,
    restday_time: &Option<String>,
    holiday_data: &[HolidayYearConfig],
) -> Option<i64> {
    let beijing = chrono::FixedOffset::east_opt(8 * 3600).unwrap();
    let today = chrono::Utc::now().with_timezone(&beijing).date_naive();
    let mut next_day = today + chrono::Days::new(1);
    let mut max_days = 366i32;
    loop {
        let next_holiday = holiday_data.iter().find(|h| h.year == next_day.year());
        let day_type = get_day_type(&next_day, next_holiday);
        let time_str = if day_type == "workday" { workday_time } else { restday_time };
        if let Some(t) = time_str {
            if let Some((h_str, m_str)) = t.split_once(':') {
                if let (Ok(h), Ok(m)) = (h_str.parse::<u32>(), m_str.parse::<u32>()) {
                    if let Some(time) = chrono::NaiveTime::from_hms_opt(h, m, 0) {
                        let dt = chrono::NaiveDateTime::new(next_day, time);
                        return Some(beijing.from_local_datetime(&dt).single().expect("Beijing has no DST").timestamp_millis());
                    }
                }
            }
        }
        next_day = next_day + chrono::Days::new(1);
        max_days -= 1;
        if max_days <= 0 { return None; }
    }
}

// @Service 月度提醒推期：支持月末/倒数第2/倒数第3模式
fn advance_monthly_reminder(current_fire_at: i64, day_mode: &str) -> Option<i64> {
    let beijing = chrono::FixedOffset::east_opt(8 * 3600).unwrap();
    let utc_dt = chrono::DateTime::from_timestamp_millis(current_fire_at)?;
    let local_dt = utc_dt.naive_utc();
    match day_mode {
        "last" => {
            let next = local_dt.checked_add_months(chrono::Months::new(1))?;
            let last = last_day_of_month(next.year(), next.month());
            let dt = chrono::NaiveDateTime::new(last, local_dt.time());
            Some(beijing.from_local_datetime(&dt).single().expect("Beijing has no DST").timestamp_millis())
        }
        "second_last" => {
            let next = local_dt.checked_add_months(chrono::Months::new(1))?;
            let last = last_day_of_month(next.year(), next.month());
            let dt = chrono::NaiveDateTime::new(last - chrono::Days::new(1), local_dt.time());
            Some(beijing.from_local_datetime(&dt).single().expect("Beijing has no DST").timestamp_millis())
        }
        "third_last" => {
            let next = local_dt.checked_add_months(chrono::Months::new(1))?;
            let last = last_day_of_month(next.year(), next.month());
            let dt = chrono::NaiveDateTime::new(last - chrono::Days::new(2), local_dt.time());
            Some(beijing.from_local_datetime(&dt).single().expect("Beijing has no DST").timestamp_millis())
        }
        _ => { // "fixed"
            let next = local_dt.checked_add_months(chrono::Months::new(1))?;
            let dt = chrono::NaiveDateTime::new(next.date(), local_dt.time());
            Some(beijing.from_local_datetime(&dt).single().expect("Beijing has no DST").timestamp_millis())
        }
    }
}

// @Service 提醒线程：生产者/消费者模式，JS 产 pending_reminders，Rust 每 5s 消费
fn reminder_thread(app_handle: tauri::AppHandle) {
    // 持久化日志句柄（避免每5秒开关文件）
    let mut log_file: Option<(String, std::io::BufWriter<std::fs::File>)> = None;
    let mut write_log = |line: &str| {
        let today = chrono::Local::now().format("%Y-%m-%d").to_string();
        let reopen = log_file.as_ref().map_or(true, |(d, _)| *d != today);
        if reopen {
            if let Ok(app_dir) = app_handle.path().app_data_dir() {
                let log_dir = app_dir.join("logs");
                let _ = std::fs::create_dir_all(&log_dir);
                let log_path = log_dir.join(format!("{}.log", today));
                if let Ok(file) = std::fs::OpenOptions::new()
                    .create(true)
                    .append(true)
                    .open(&log_path)
                {
                    log_file = Some((today, std::io::BufWriter::new(file)));
                }
            }
        }
        if let Some((_, ref mut writer)) = log_file {
            let ts = chrono::Local::now().format("%H:%M:%S%.3f");
            let _ = writeln!(writer, "[{}][reminder] {}", ts, line);
            let _ = writer.flush();
        }
    };

    write_log("提醒线程启动");
    let mut last_reminder_log_sec = 0i64;
    loop {
        std::thread::sleep(std::time::Duration::from_secs(5));
        let config_path = match app_handle.path().app_data_dir() {
            Ok(p) => p.join("config.json"),
            Err(_) => continue,
        };
        let json = match std::fs::read_to_string(&config_path) {
            Ok(s) => s,
            Err(_) => continue,
        };
        let mut config: AppConfig = match serde_json::from_str(&json) {
            Ok(c) => c,
            Err(_) => continue,
        };
        let now = chrono::Utc::now().timestamp_millis();
        if !config.reminder_enabled {
            let sec = now / 1000;
            if sec - last_reminder_log_sec >= 60 {
                write_log("reminder_enabled = false，跳过");
                last_reminder_log_sec = sec;
            }
            continue;
        }

        let mut reminder_fired = false;
        let mut to_remove: Vec<String> = Vec::new();
        let mut to_add: Vec<PendingReminder> = Vec::new();
        let mut to_done: Vec<String> = Vec::new();

        for reminder in &config.pending_reminders {
            if reminder.fire_at > now { continue; }
            // 跳过过于陈旧的（>5min），防止长时间关机后开机批量触发
            if now - reminder.fire_at > 300_000 {
                to_remove.push(reminder.id.clone());
                continue;
            }

            // 触发通知
            let _ = notify_rust::Notification::new()
                .summary("HRB Tools")
                .body(&reminder.text)
                .show();

            // 声音
            if reminder.sound {
                #[cfg(target_os = "windows")]
                unsafe { Beep(880, 200); }
            }

            // 写入横幅
            push_notification(&app_handle, NotificationLevel::Info, "提醒",
                &format!("⏰ {}", reminder.text), "");

            // 周期任务推期
            if let Some(ref repeat) = reminder.repeat {
                let next_fire = match repeat.as_str() {
                    "daily" => advance_daily_reminder(
                        &reminder.workday_time, &reminder.restday_time, &config.holiday_data),
                    "weekly" => Some(reminder.fire_at + 7 * 24 * 60 * 60 * 1000),
                    "monthly" => advance_monthly_reminder(reminder.fire_at, &reminder.day_mode),
                    _ => None,
                };
                if let Some(next_ms) = next_fire {
                    to_add.push(PendingReminder {
                        id: format!("{}_{}", reminder.todo_id, next_ms),
                        todo_id: reminder.todo_id.clone(),
                        text: reminder.text.clone(),
                        fire_at: next_ms,
                        sound: reminder.sound,
                        repeat: reminder.repeat.clone(),
                        workday_time: reminder.workday_time.clone(),
                        restday_time: reminder.restday_time.clone(),
                        day_mode: reminder.day_mode.clone(),
                    });
                }
            } else {
                // 一次性：标记待办完成
                to_done.push(reminder.todo_id.clone());
            }

            to_remove.push(reminder.id.clone());
            reminder_fired = true;

            // 显示窗口
            if let Some(w) = app_handle.get_webview_window("main") {
                let _ = w.show();
                let _ = w.unminimize();
                let _ = w.set_always_on_top(true);
                let _ = w.set_focus();
                let _ = w.set_always_on_top(false);
            }
        }

        // 批量应用变更
        config.pending_reminders.retain(|r| !to_remove.contains(&r.id));
        config.pending_reminders.extend(to_add);

        for todo_id in to_done {
            if let Some(todo) = config.todos.iter_mut().find(|t| t.id == todo_id) {
                todo.done = true;
                todo.completed_at = Some(
                    chrono::Utc::now().format("%Y-%m-%dT%H:%M:%S%.3fZ").to_string()
                );
            }
        }

        if reminder_fired {
            save_config(&app_handle, &config);
            if let Some(w) = app_handle.get_webview_window("main") {
                let _ = w.eval("try{window.__onReminderFired()}catch(e){}");
            }
        }
    }
}

// @Setup 应用入口：托盘图标 → 窗口初始化 → 提醒线程
fn main() {
    tauri::Builder::default()
        .setup(|app| {
            // 系统托盘
            use tauri::tray::TrayIconBuilder;
            use tauri::menu::{MenuBuilder, MenuItem};

            let show = MenuItem::with_id(app, "show", "显示", true, None::<&str>)?;
            let quit = MenuItem::with_id(app, "quit", "退出", true, None::<&str>)?;
            let menu = MenuBuilder::new(app).items(&[&show, &quit]).build()?;

            // --minimized 参数：开机自启（带此参数）→隐藏到托盘，手动启动→显示窗口
            let is_minimized = std::env::args().any(|a| a == "--minimized");
            if !is_minimized {
                if let Some(window) = app.get_webview_window("main") {
                    let _ = window.show();
                    let _ = window.set_focus();
                }
            }

            let _tray = TrayIconBuilder::new()
                .icon(tauri::image::Image::new_owned(include_bytes!("../icons/32x32.raw").to_vec(), 32, 32))
                .tooltip("HRB Tools")
                .menu(&menu)
                .on_menu_event(move |app, event| {
                    match event.id().as_ref() {
                        "show" => {
                            if let Some(window) = app.get_webview_window("main") {
                                let _ = window.show();
                                let _ = window.set_focus();
                            }
                        }
                        "quit" => { app.exit(0); }
                        _ => {}
                    }
                })
                .on_tray_icon_event(|tray, event| {
                    if let tauri::tray::TrayIconEvent::Click { .. } = event {
                        let app = tray.app_handle();
                        if let Some(window) = app.get_webview_window("main") {
                            let _ = window.show();
                            let _ = window.set_focus();
                        }
                    }
                })
                .build(app)?;

            let app_handle = app.handle().clone();
            std::thread::spawn(move || reminder_thread(app_handle));
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            convert_to_timestamp,
            convert_to_datetime,
            get_config,
            set_config,
            get_holiday_data,
            save_holiday_data,
            pick_file,
            pick_directory,
            create_backup,
            list_backups,
            delete_backup,
            rename_backup,
            restore_backup,
            compute_hash,
            recompute_backup_hash,
            toggle_backup_pin,
            toggle_game_pin,
            open_folder,
            add_timezone_set,
            remove_timezone_set,
            update_timezone_set,
            toggle_timezone_pin,
            send_notification,
            window_minimize,
            window_toggle_maximize,
            window_close,
            log_write,
            open_log_folder,
            read_today_logs,
            scan_screenshots,
            get_screenshot_base64_batch,
            detect_screenshot_sources,
            add_screenshot_source,
            remove_screenshot_source,
            delete_screenshot,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
