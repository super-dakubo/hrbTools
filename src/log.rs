// @Endpoint 日志写入、打开日志目录、读取今日日志

use std::fs;
use std::io::{Write, BufWriter};
use std::path::PathBuf;
use tauri::Manager;

fn get_app_dir(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    app.path().app_data_dir().map_err(|e| e.to_string())
}

// @Endpoint 日志写入/打开目录/读取今日日志
#[tauri::command]
pub fn log_write(app_handle: tauri::AppHandle, lines: Vec<String>) -> Result<(), String> {
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
    }

    // 文件 ~10MB 轮转
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
pub fn open_log_folder(app_handle: tauri::AppHandle) -> Result<(), String> {
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
pub fn read_today_logs(app_handle: tauri::AppHandle) -> Result<Vec<String>, String> {
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
