// 防止 Windows 上 Release 模式出现额外控制台窗口
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use chrono::{NaiveDateTime, DateTime, Utc, TimeZone};
use chrono_tz::Tz;
use serde::{Deserialize, Serialize};
use std::fs;
use std::path::PathBuf;
use tauri::Manager;
use md5::{Md5, Digest};

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
    file_path: String,
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
}

impl Default for AppConfig {
    fn default() -> Self {
        AppConfig {
            backup_root: String::new(),
            games: vec![],
            timezone_sets: default_timezone_sets(),
        }
    }
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

#[tauri::command]
fn convert_to_timestamp(request: ConvertRequest) -> ConvertResponse {
    // 解析时区
    let tz: Tz = match request.timezone.parse() {
        Ok(tz) => tz,
        Err(_) => {
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
    let local_dt: DateTime<Tz> = tz.from_local_datetime(&naive_dt).unwrap();
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
    let tz: Tz = match request.timezone.parse() {
        Ok(tz) => tz,
        Err(_) => {
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
            let local_dt: DateTime<Tz> = utc_dt.with_timezone(&tz);
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
                (
                    meta["display_name"].as_str().unwrap_or(folder_name).to_string(),
                    meta["original_file_path"].as_str().unwrap_or("").to_string(),
                    meta["content_hash"].as_str().unwrap_or("").to_string(),
                    meta["pinned"].as_bool().unwrap_or(false),
                )
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
    let slot = match config.games.iter().find(|g| g.id == game_id) {
        Some(game) => match game.slots.iter().find(|s| s.id == slot_id) {
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
    let existing = list_backups_internal(&config, &game_id, &slot_id);
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
        .join(&game_id)
        .join(&slot_id)
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
) -> OpResult {
    let config = load_config(&app);
    let backup_dir = std::path::PathBuf::from(&config.backup_root)
        .join(&game_id)
        .join(&slot_id)
        .join(&folder_name);

    if !backup_dir.exists() {
        return OpResult { success: false, message: "备份不存在".to_string() };
    }

    // 读取 meta.json
    let meta_path = backup_dir.join("meta.json");
    let (original_path, _backup_hash) = if meta_path.exists() {
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
            .find(|g| g.id == game_id)
            .and_then(|g| g.slots.iter().find(|s| s.id == slot_id))
            .map(|s| s.key_file_patterns.clone())
            .unwrap_or_default();

        let current_hash = compute_hash(original_path.clone(), patterns).unwrap_or_default();
        let hash_match = list_backups_internal(&config, &game_id, &slot_id)
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

// ==================== 哈希计算 ====================

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

    // 计算备份文件夹中文件（排除 meta.json）的哈希
    let mut entries: Vec<std::path::PathBuf> = match std::fs::read_dir(&backup_dir) {
        Ok(entries) => entries
            .filter_map(|e| e.ok())
            .filter(|e| e.file_type().map(|t| t.is_file()).unwrap_or(false))
            .filter(|e| e.file_name() != "meta.json")
            .map(|e| e.path())
            .collect(),
        Err(_) => vec![],
    };
    entries.sort();

    let mut hasher = md5::Md5::new();
    for entry in &entries {
        let bytes = std::fs::read(entry).unwrap_or_default();
        let rel = entry.file_name().unwrap_or_default().to_string_lossy();
        let mut fh = md5::Md5::new();
        fh.update(&bytes);
        hasher.update(format!("{}:{:x}", rel, fh.finalize()).as_bytes());
    }
    let content_hash = format!("{:x}", hasher.finalize());

    // 更新 meta.json
    let meta_path = backup_dir.join("meta.json");
    if let Ok(json_str) = std::fs::read_to_string(&meta_path) {
        if let Ok(mut meta) = serde_json::from_str::<serde_json::Value>(&json_str) {
            meta["content_hash"] = serde_json::Value::String(content_hash.clone());
            if let Ok(new_json) = serde_json::to_string_pretty(&meta) {
                let _ = std::fs::write(&meta_path, new_json);
            }
        }
    }

    OpResult { success: true, message: format!("哈希已重算: {}", &content_hash[..8]) }
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
fn window_minimize(app: tauri::AppHandle) {
    if let Some(window) = app.get_webview_window("main") {
        let _ = window.minimize();
    }
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
    if let Some(window) = app.get_webview_window("main") {
        let _ = window.close();
    }
}

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
            recompute_backup_hash,
            toggle_backup_pin,
            toggle_game_pin,
            open_folder,
            add_timezone_set,
            remove_timezone_set,
            update_timezone_set,
            toggle_timezone_pin,
            window_minimize,
            window_toggle_maximize,
            window_close,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
