// 防止 Windows 上 Release 模式出现额外控制台窗口
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use chrono::{NaiveDateTime, DateTime, Utc, TimeZone};
use chrono::Datelike;
use serde::{Deserialize, Serialize};
use std::fs;
use std::io::{Write, BufWriter};
use std::path::PathBuf;
use tauri::Manager;
use md5::{Md5, Digest};

// ==================== 时区工具 ====================

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

/// 计算某月第 N 个星期日（n 从 1 开始）
fn nth_sunday_of_month(year: i32, month: u32, n: u32) -> chrono::NaiveDate {
    let first = chrono::NaiveDate::from_ymd_opt(year, month, 1).unwrap();
    let first_dow = first.weekday().num_days_from_sunday();
    let day = 1 + if first_dow == 0 { 0 } else { 7 - first_dow } + (n - 1) * 7;
    chrono::NaiveDate::from_ymd_opt(year, month, day).unwrap()
}

/// 计算某月最后一个星期日
fn last_sunday_of_month(year: i32, month: u32) -> chrono::NaiveDate {
    let (next_y, next_m) = if month == 12 { (year + 1, 1) } else { (year, month + 1) };
    let last_day = chrono::NaiveDate::from_ymd_opt(next_y, next_m, 1).unwrap().pred_opt().unwrap();
    let dow = last_day.weekday().num_days_from_sunday();
    last_day.pred_opt().unwrap().checked_sub_days(chrono::Days::new(dow as u64)).unwrap()
}

/// 计算某月的最后一天
fn last_day_of_month(year: i32, month: u32) -> chrono::NaiveDate {
    let (next_y, next_m) = if month == 12 { (year + 1, 1) } else { (year, month + 1) };
    chrono::NaiveDate::from_ymd_opt(next_y, next_m, 1).unwrap().pred_opt().unwrap()
}

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
    #[serde(default)]
    minimize_to_tray: bool,
    #[serde(default = "default_true")]
    reminder_enabled: bool,
}

fn default_theme() -> String { "system".to_string() }

fn default_true() -> bool { true }

fn default_tab_order() -> Vec<String> {
    vec!["convert".to_string(), "backup".to_string(), "todo".to_string()]
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
            minimize_to_tray: true,
            reminder_enabled: true,
        }
    }
}

// ==================== 待办数据结构 ====================

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
    last_notified: Option<i64>,
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
    sound: bool,
    #[serde(default)]
    day_mode: String,   // "fixed" | "last" | "second_last" | "third_last"，仅 monthly 有效
}

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

// ==================== 操作结果 ====================

#[derive(Debug, Serialize, Deserialize)]
struct OpResult {
    success: bool,
    message: String,
}

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
            Ok(json) => {
                let raw: serde_json::Value = serde_json::from_str(&json).unwrap_or_default();
                let mut config: AppConfig = serde_json::from_value(raw.clone()).unwrap_or_default();
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
                config
            }
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

// ==================== 开机自启 ====================

fn set_auto_start(enabled: bool) {
    let exe_path = std::env::current_exe().ok();
    let app_name = "HRB Tools";

    if enabled {
        if let Some(path) = exe_path {
            let path_str = path.to_string_lossy().to_string();
            let _ = std::process::Command::new("reg")
                .args(["add", "HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Run", "/v", app_name, "/t", "REG_SZ", "/d", &path_str, "/f"])
                .output();
        }
    } else {
        let _ = std::process::Command::new("reg")
            .args(["delete", "HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Run", "/v", app_name, "/f"])
            .output();
    }
}

// ==================== 时区工具 ====================

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

#[tauri::command]
fn get_config(app: tauri::AppHandle) -> AppConfig {
    load_config(&app)
}

#[tauri::command]
fn set_config(app: tauri::AppHandle, config: AppConfig) -> OpResult {
    set_auto_start(config.auto_start);
    save_config(&app, &config);
    OpResult {
        success: true,
        message: "配置已保存".to_string(),
    }
}

#[tauri::command]
fn pick_file() -> Option<String> {
    rfd::FileDialog::new()
        .pick_file()
        .map(|p| p.to_string_lossy().to_string())
}

#[tauri::command]
fn pick_directory() -> Option<String> {
    rfd::FileDialog::new()
        .pick_folder()
        .map(|p| p.to_string_lossy().to_string())
}

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
        created_at: String::new(),
        original_file_path,
        content_hash,
        pinned,
    })
}

#[tauri::command]
fn create_backup(
    app: tauri::AppHandle,
    game_id: String,
    slot_id: String,
    file_paths: Vec<String>,
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

#[tauri::command]
fn list_backups(app: tauri::AppHandle, game_id: String, slot_id: String) -> Vec<BackupInfo> {
    let config = load_config(&app);
    list_backups_internal(&config, &game_id, &slot_id)
}

#[tauri::command]
fn delete_backup(
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

    match std::fs::remove_dir_all(&backup_dir) {
        Ok(_) => OpResult { success: true, message: "备份已删除".to_string() },
        Err(e) => OpResult { success: false, message: format!("删除失败: {}", e) },
    }
}

#[tauri::command]
fn rename_backup(
    app: tauri::AppHandle,
    game_id: String,
    slot_id: String,
    folder_name: String,
    new_description: String,
) -> OpResult {
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

#[tauri::command]
fn restore_backup(
    app: tauri::AppHandle,
    game_id: String,
    slot_id: String,
    folder_name: String,
    skip_backup: bool,
    selected_files: Option<Vec<String>>,
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
                // 旧格式向后兼容
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

    // 多文件且未指定 selected_files 时返回文件列表
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

    // 检查原始文件是否需要先备份
    if !skip_backup {
        let needs_backup = to_restore.iter().any(|(_, orig)| {
            std::path::Path::new(orig).exists()
        });
        if needs_backup {
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

// ==================== 哈希计算 ====================

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

/// 简单通配符匹配：支持 *xxx、xxx*、*xxx*
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

#[tauri::command]
fn toggle_backup_pin(
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

#[tauri::command]
fn toggle_game_pin(app: tauri::AppHandle, game_id: String) -> OpResult {
    let mut config = load_config(&app);
    if let Some(game) = config.games.iter_mut().find(|g| g.id == game_id) {
        game.pinned = !game.pinned;
    }
    save_config(&app, &config);
    OpResult { success: true, message: "已更新".to_string() }
}

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

#[tauri::command]
fn add_timezone_set(app: tauri::AppHandle) -> OpResult {
    let mut config = load_config(&app);
    let id = format!("set-{}", config.timezone_sets.len() + 1);
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

#[tauri::command]
fn toggle_timezone_pin(app: tauri::AppHandle, set_id: String) -> OpResult {
    let mut config = load_config(&app);
    if let Some(set) = config.timezone_sets.iter_mut().find(|s| s.id == set_id) {
        set.pinned = !set.pinned;
    }
    save_config(&app, &config);
    OpResult { success: true, message: "已更新".to_string() }
}

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

    #[cfg(not(target_os = "windows"))]
    {
        std::process::Command::new("open")
            .arg(&log_dir)
            .spawn()
            .map_err(|e| format!("打开日志文件夹失败: {}", e))?;
    }

    Ok(())
}

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

fn main() {
    tauri::Builder::default()
        .setup(|app| {
            // 系统托盘
            use tauri::tray::TrayIconBuilder;
            use tauri::menu::{MenuBuilder, MenuItem};

            let show = MenuItem::with_id(app, "show", "显示", true, None::<&str>)?;
            let quit = MenuItem::with_id(app, "quit", "退出", true, None::<&str>)?;
            let menu = MenuBuilder::new(app).items(&[&show, &quit]).build()?;

            let _tray = TrayIconBuilder::new()
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
            std::thread::spawn(move || {
                loop {
                    std::thread::sleep(std::time::Duration::from_secs(1));
                    let config_path = match app_handle.path().app_data_dir() {
                        Ok(p) => p.join("config.json"),
                        Err(_) => continue,
                    };
                    let json = match std::fs::read_to_string(&config_path) {
                        Ok(s) => s,
                        Err(_) => continue,
                    };
                    let raw: serde_json::Value = match serde_json::from_str(&json) {
                        Ok(v) => v,
                        Err(_) => continue,
                    };
                    let mut config: AppConfig = match serde_json::from_value(raw) {
                        Ok(c) => c,
                        Err(_) => continue,
                    };
                    let now = chrono::Utc::now().timestamp_millis();
                    let mut changed = false;
                    if !config.reminder_enabled { continue; }

                    for todo in config.todos.iter_mut() {
                        if todo.done { continue; }
                        if todo.paused { continue; }
                        let reminder = match &todo.reminder {
                            Some(r) => r,
                            None => continue,
                        };
                        let reminder_dt = match chrono::NaiveDateTime::parse_from_str(
                            &reminder.datetime, "%Y-%m-%dT%H:%M"
                        ) {
                            Ok(dt) => dt,
                            Err(_) => continue,
                        };
                        let reminder_ts = reminder_dt.and_utc().timestamp_millis();
                        if reminder_ts <= now {
                            let last = todo.last_notified.unwrap_or(0);
                            if now - last < 60000 { continue; }
                            let _ = notify_rust::Notification::new()
                                .summary("HRB Tools")
                                .body(&todo.text)
                        
                                .show();
                            todo.last_notified = Some(now);
                            changed = true;
                            // 重复任务自动推期
                            if let Some(repeat) = &todo.repeat {
                                let mut next_dt = reminder_dt;
                                let adv_due = |d: &mut Option<String>| {
                                    if let &mut Some(ref due) = d {
                                        if let Ok(due_d) = chrono::NaiveDate::parse_from_str(due, "%Y-%m-%d") {
                                            let new_due = match repeat.as_str() {
                                                "daily" => due_d + chrono::Days::new(1),
                                                "weekly" => due_d + chrono::Days::new(7),
                                                "monthly" => due_d + chrono::Months::new(1),
                                                _ => due_d,
                                            };
                                            *d = Some(new_due.format("%Y-%m-%d").to_string());
                                        }
                                    }
                                };
                                match repeat.as_str() {
                                    "daily" => next_dt += chrono::Duration::days(1),
                                    "weekly" => next_dt += chrono::Duration::days(7),
                                    "monthly" => {
                                        let day_mode = reminder.day_mode.as_str();
                                        match day_mode {
                                            "last" => {
                                                let next = next_dt.checked_add_months(chrono::Months::new(1)).unwrap_or(next_dt);
                                                let last = last_day_of_month(next.year(), next.month());
                                                next_dt = chrono::NaiveDateTime::new(last, next_dt.time());
                                            }
                                            "second_last" => {
                                                let next = next_dt.checked_add_months(chrono::Months::new(1)).unwrap_or(next_dt);
                                                let last = last_day_of_month(next.year(), next.month());
                                                next_dt = chrono::NaiveDateTime::new(last - chrono::Days::new(1), next_dt.time());
                                            }
                                            "third_last" => {
                                                let next = next_dt.checked_add_months(chrono::Months::new(1)).unwrap_or(next_dt);
                                                let last = last_day_of_month(next.year(), next.month());
                                                next_dt = chrono::NaiveDateTime::new(last - chrono::Days::new(2), next_dt.time());
                                            }
                                            _ => { // "fixed" 或空字符串 = 向后兼容
                                                next_dt = next_dt.checked_add_months(chrono::Months::new(1)).unwrap_or(next_dt);
                                            }
                                        }
                                    }
                                    _ => {}
                                }
                                todo.reminder = Some(ReminderConfig {
                                    datetime: next_dt.format("%Y-%m-%dT%H:%M").to_string(),
                                    sound: reminder.sound,
                                    day_mode: reminder.day_mode.clone(),
                                });
                                adv_due(&mut todo.due_date);
                            }
                        }
                    }

                    if changed {
                        if let Ok(json) = serde_json::to_string_pretty(&config) {
                            let _ = std::fs::write(&config_path, json);
                        }
                    }
                }
            });
            Ok(())
        })
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
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
