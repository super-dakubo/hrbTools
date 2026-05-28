// @Repository 配置读写、日志写入、开机自启
// 所有与文件系统和操作系统交互的基础设施函数

use std::fs;
use std::io::Write;
use std::path::PathBuf;
use serde_json;
use tauri::Manager;
use crate::app_config::AppConfig;

// @Repository 获取 config.json 路径（app_data_dir 下）
pub fn config_path(app: &tauri::AppHandle) -> PathBuf {
    app.path()
        .app_data_dir()
        .expect("无法获取应用数据目录")
        .join("config.json")
}

// @Repository 读取并解析 config.json，含旧格式迁移
pub fn load_config(app: &tauri::AppHandle) -> AppConfig {
    let path = config_path(app);
    if path.exists() {
        match fs::read_to_string(&path) {
            Ok(content) => {
                // 先尝试直接解析完整结构
                if let Ok(config) = serde_json::from_str::<AppConfig>(&content) {
                    return config;
                }
                // 如果直接解析失败，尝试从原始 JSON 读取并迁移旧格式
                let raw: serde_json::Value = match serde_json::from_str(&content) {
                    Ok(v) => v,
                    Err(e) => {
                        log_error(app, &format!("Config JSON parse error: {}", e));
                        return AppConfig::default();
                    }
                };
                // 尝试从原始值解析（可能包含未知字段）
                let mut config: AppConfig = match serde_json::from_value(raw.clone()) {
                    Ok(c) => c,
                    Err(e) => {
                        log_error(app, &format!("Config deserialize error: {}", e));
                        return AppConfig::default();
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
pub fn log_error(app: &tauri::AppHandle, msg: &str) {
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
pub fn log_info(app: &tauri::AppHandle, msg: &str) {
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
pub fn save_config(app: &tauri::AppHandle, config: &AppConfig) {
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

// @Setup Windows 注册表开机自启（reg.exe，仅在 set_config 中调）
pub fn set_auto_start(app: &tauri::AppHandle, enabled: bool) {
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
