// @Setup Tauri 2.0 桌面应用后端入口（仅 Windows 无边框窗口）
// @see src/main.js 前端 IPC 调用方
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use chrono::TimeZone;
use chrono::Datelike;
use std::io::Write;
use tauri::Manager;

mod app_config;
use app_config::*;
mod tz;
use tz::*;
mod config_io;
use config_io::*;
mod holiday;
use holiday::*;
mod time_convert;
mod file_dialog;
mod notification;
mod log;
mod hash;
mod screenshot;
mod backup;

#[cfg(target_os = "windows")]
unsafe extern "system" {
    fn Beep(dwFreq: u32, dwDuration: u32) -> i32;
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

            // 写入横幅（直接推入本地 config，随后续 save_config 一起持久化）
            config.banners.push(BannerEntry {
                id: format!("notif_{}", std::time::SystemTime::now()
                    .duration_since(std::time::UNIX_EPOCH).unwrap().as_nanos()),
                level: NotificationLevel::Info,
                source: "提醒".to_string(),
                title: format!("⏰ {}", reminder.text),
                message: String::new(),
                created_at: chrono::Utc::now().timestamp_millis(),
                auto_dismiss: true,
                read: false,
            });

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
            time_convert::convert_to_timestamp,
            time_convert::convert_to_datetime,
            get_config,
            set_config,
            get_holiday_data,
            save_holiday_data,
            file_dialog::pick_file,
            file_dialog::pick_directory,
            backup::create_backup,
            backup::list_backups,
            backup::delete_backup,
            backup::rename_backup,
            backup::restore_backup,
            hash::compute_hash,
            backup::recompute_backup_hash,
            backup::toggle_backup_pin,
            backup::toggle_game_pin,
            backup::open_folder,
            add_timezone_set,
            remove_timezone_set,
            update_timezone_set,
            toggle_timezone_pin,
            notification::send_notification,
            window_minimize,
            window_toggle_maximize,
            window_close,
            log::log_write,
            log::open_log_folder,
            log::read_today_logs,
            screenshot::scan_screenshots,
            screenshot::get_screenshot_base64_batch,
            screenshot::detect_screenshot_sources,
            screenshot::add_screenshot_source,
            screenshot::remove_screenshot_source,
            screenshot::delete_screenshot,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}

#[cfg(test)]
mod tests {
    use super::*;
    use screenshot::is_image_file;
    use backup::sanitize_path_component;

    // ==================== sanitize_path_component ====================

    #[test]
    fn sanitize_normal_name() {
        assert_eq!(
            sanitize_path_component("my-save-file").unwrap(),
            "my-save-file"
        );
    }

    #[test]
    fn sanitize_rejects_dotdot() {
        assert!(sanitize_path_component("..").is_err());
    }

    #[test]
    fn sanitize_rejects_slash() {
        assert!(sanitize_path_component("foo/bar").is_err());
    }

    #[test]
    fn sanitize_rejects_backslash() {
        assert!(sanitize_path_component("foo\\bar").is_err());
    }

    #[test]
    fn sanitize_rejects_dotdot_in_middle() {
        assert!(sanitize_path_component("foo/../bar").is_err());
    }

    #[test]
    fn sanitize_accepts_unicode() {
        assert_eq!(
            sanitize_path_component("存档_备份_2026").unwrap(),
            "存档_备份_2026"
        );
    }

    #[test]
    fn sanitize_accepts_dashes_and_dots() {
        assert_eq!(
            sanitize_path_component("my-backup-v2.1").unwrap(),
            "my-backup-v2.1"
        );
    }

    // ==================== is_image_file ====================

    #[test]
    fn is_png_image() {
        assert!(is_image_file(std::path::Path::new("screenshot.png")));
    }

    #[test]
    fn is_jpg_image() {
        assert!(is_image_file(std::path::Path::new("photo.jpg")));
        assert!(is_image_file(std::path::Path::new("photo.jpeg")));
    }

    #[test]
    fn is_webp_image() {
        assert!(is_image_file(std::path::Path::new("image.webp")));
    }

    #[test]
    fn is_bmp_image() {
        assert!(is_image_file(std::path::Path::new("image.bmp")));
    }

    #[test]
    fn is_gif_image() {
        assert!(is_image_file(std::path::Path::new("animation.gif")));
    }

    #[test]
    fn not_image_txt() {
        assert!(!is_image_file(std::path::Path::new("readme.txt")));
    }

    #[test]
    fn not_image_no_ext() {
        assert!(!is_image_file(std::path::Path::new("Makefile")));
    }

    #[test]
    fn is_image_case_insensitive() {
        assert!(is_image_file(std::path::Path::new("screenshot.PNG")));
        assert!(is_image_file(std::path::Path::new("screenshot.JPG")));
        assert!(is_image_file(std::path::Path::new("screenshot.WebP")));
    }
}
