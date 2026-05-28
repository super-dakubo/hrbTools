// @Endpoint 时间与时间戳双向转换

use chrono::{DateTime, Utc, TimeZone, NaiveDateTime};
use serde::{Deserialize, Serialize};
use crate::tz;

// @Entity 时间→时间戳转换请求/响应体
#[derive(Debug, Serialize, Deserialize)]
pub struct ConvertRequest {
    pub datetime_str: String,
    pub timezone: String,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct ConvertResponse {
    pub success: bool,
    pub timestamp: Option<i64>,
    pub error: Option<String>,
}

// @Entity 时间戳→时间转换请求/响应体
#[derive(Debug, Serialize, Deserialize)]
pub struct TimestampRequest {
    pub timestamp_ms: i64,
    pub timezone: String,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct DatetimeResponse {
    pub success: bool,
    pub datetime_str: Option<String>,
    pub error: Option<String>,
}

// @Endpoint datetime→timestamp 转换，支持 4 种输入格式
#[tauri::command]
pub fn convert_to_timestamp(request: ConvertRequest) -> ConvertResponse {
    let tz = match tz::resolve_timezone(&request.timezone) {
        Some(tz) => tz,
        None => {
            return ConvertResponse {
                success: false,
                timestamp: None,
                error: Some(format!("无效时区: {}", request.timezone)),
            };
        }
    };

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
pub fn convert_to_datetime(request: TimestampRequest) -> DatetimeResponse {
    let tz = match tz::resolve_timezone(&request.timezone) {
        Some(tz) => tz,
        None => {
            return DatetimeResponse {
                success: false,
                datetime_str: None,
                error: Some(format!("无效时区: {}", request.timezone)),
            };
        }
    };

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
