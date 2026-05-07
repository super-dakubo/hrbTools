// 防止 Windows 上 Release 模式出现额外控制台窗口
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use chrono::{NaiveDateTime, DateTime, Utc, TimeZone};
use chrono_tz::Tz;
use serde::{Deserialize, Serialize};
use std::fs;
use std::path::PathBuf;
use tauri::Manager;

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
                    created_at: String::new(),
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
            restore_backup
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}