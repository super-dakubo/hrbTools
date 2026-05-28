// @Entity 应用配置和数据结构的集中定义
// 所有模块共享的结构体统一放在此文件

use serde::{Deserialize, Serialize};

// ==================== 存档位配置 ====================

// @Entity 存档位配置：文件列表、备份序号、关键文件匹配模式
#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct SlotConfig {
    pub id: String,
    pub name: String,
    #[serde(default)]
    pub file_paths: Vec<String>,
    #[serde(default = "default_next_backup_number")]
    pub next_backup_number: u32,
    #[serde(default)]
    pub key_file_patterns: Vec<String>,
}

fn default_next_backup_number() -> u32 { 1 }

// @Entity 游戏实体，ID 不可变
#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct GameConfig {
    pub id: String,
    pub name: String,
    #[serde(default)]
    pub slots: Vec<SlotConfig>,
    #[serde(default)]
    pub pinned: bool,
}

// ==================== 时区转换套件 ====================

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct TimezoneSet {
    pub id: String,
    pub timezone: String,
    #[serde(default)]
    pub datetime_format: String,
    #[serde(default)]
    pub pinned: bool,
    #[serde(default)]
    pub sort_order: u32,
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

// ==================== 应用配置根结构 ====================

// @Entity 应用配置根结构，对应 config.json 完整 schema
#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct AppConfig {
    #[serde(default)]
    pub backup_root: String,
    #[serde(default)]
    pub games: Vec<GameConfig>,
    #[serde(default = "default_timezone_sets")]
    pub timezone_sets: Vec<TimezoneSet>,
    #[serde(default = "default_theme")]
    pub theme: String,
    #[serde(default = "default_tab_order")]
    pub tab_order: Vec<String>,
    #[serde(default)]
    pub todos: Vec<TodoItem>,
    #[serde(default)]
    pub auto_start: bool,
    #[serde(default = "default_true")]
    pub reminder_enabled: bool,
    #[serde(default)]
    pub holiday_data: Vec<HolidayYearConfig>,
    #[serde(default)]
    pub screenshot_sources: Vec<ScreenshotSource>,
    #[serde(default)]
    pub banners: Vec<BannerEntry>,
    #[serde(default)]
    pub pending_reminders: Vec<PendingReminder>,
}

fn default_theme() -> String { "system".to_string() }
fn default_true() -> bool { true }

fn default_tab_order() -> Vec<String> {
    vec![
        "convert".to_string(),
        "backup".to_string(),
        "todo".to_string(),
        "screenshot".to_string(),
        "log".to_string(),
    ]
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

// ==================== 截图画廊 ====================

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ScreenshotSource {
    #[serde(default)]
    pub id: String,
    #[serde(default)]
    pub name: String,
    #[serde(default)]
    pub path: String,
    #[serde(default)]
    pub game_id: Option<String>,
    #[serde(default)]
    pub sort_order: i32,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ScreenshotEntry {
    pub file_name: String,
    pub path: String,
    pub modified: String,
    pub size: u64,
    pub source_id: String,
    #[serde(default)]
    pub game_name: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DetectedSource {
    pub name: String,
    pub path: String,
    pub count: u32,
    pub source_type: String,
}

// ==================== 待办数据结构 ====================

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct TodoItem {
    pub id: String,
    pub text: String,
    pub done: bool,
    pub priority: i32,
    pub paused: bool,
    pub due_date: Option<String>,
    pub tags: Vec<String>,
    pub notes: String,
    pub reminder: Option<ReminderConfig>,
    pub repeat: Option<String>,
    pub sort_order: i32,
    pub created_at: String,
    pub completed_at: Option<String>,
    pub parent_id: Option<String>,
}

// Note: serde default is moved to field defaults where possible
// These defaults ensure backward compatibility with old config.json

impl Default for TodoItem {
    fn default() -> Self {
        TodoItem {
            id: String::new(),
            text: String::new(),
            done: false,
            priority: 0,
            paused: false,
            due_date: None,
            tags: vec![],
            notes: String::new(),
            reminder: None,
            repeat: None,
            sort_order: 0,
            created_at: String::new(),
            completed_at: None,
            parent_id: None,
        }
    }
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct ReminderConfig {
    pub datetime: String,
    pub workday_time: Option<String>,
    pub restday_time: Option<String>,
    pub sound: bool,
    pub day_mode: String,
}

impl Default for ReminderConfig {
    fn default() -> Self {
        ReminderConfig {
            datetime: String::new(),
            workday_time: None,
            restday_time: None,
            sound: false,
            day_mode: String::new(),
        }
    }
}

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub enum NotificationLevel {
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
pub struct BannerEntry {
    pub id: String,
    pub level: NotificationLevel,
    pub source: String,
    pub title: String,
    pub message: String,
    pub created_at: i64,
    #[serde(default = "default_auto_dismiss")]
    pub auto_dismiss: bool,
    pub read: bool,
}

fn default_auto_dismiss() -> bool { true }

impl Default for BannerEntry {
    fn default() -> Self {
        BannerEntry {
            id: String::new(),
            level: NotificationLevel::Info,
            source: String::new(),
            title: String::new(),
            message: String::new(),
            created_at: 0,
            auto_dismiss: true,
            read: false,
        }
    }
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct PendingReminder {
    pub id: String,
    pub todo_id: String,
    pub text: String,
    pub fire_at: i64,
    pub sound: bool,
    pub repeat: Option<String>,
    pub workday_time: Option<String>,
    pub restday_time: Option<String>,
    pub day_mode: String,
}

// ==================== 节假日配置 ====================

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct HolidayYearConfig {
    pub year: i32,
    pub holidays: Vec<HolidayPeriod>,
    pub makeup_days: Vec<String>,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct HolidayPeriod {
    pub name: String,
    pub start: String,
    pub end: String,
}

// ==================== 操作结果（跨模块共享） ====================

#[derive(Debug, Serialize, Deserialize)]
pub struct OpResult {
    pub success: bool,
    pub message: String,
}
