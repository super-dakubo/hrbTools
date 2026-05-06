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

    // 本地时区时间 → UTC → Unix 时间戳（秒）
    let local_dt: DateTime<Tz> = tz.from_local_datetime(&naive_dt).unwrap();
    let utc_dt: DateTime<Utc> = local_dt.with_timezone(&Utc);
    let timestamp = utc_dt.timestamp();

    ConvertResponse {
        success: true,
        timestamp: Some(timestamp),
        error: None,
    }
}

fn main() {
    tauri::Builder::default()
        .invoke_handler(tauri::generate_handler![convert_to_timestamp])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}