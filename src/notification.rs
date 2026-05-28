// @Endpoint 发送系统通知（notify-rust）

use crate::app_config::OpResult;

#[tauri::command]
pub fn send_notification(_app: tauri::AppHandle, title: String, body: String) -> OpResult {
    let _ = notify_rust::Notification::new()
        .summary(&title)
        .body(&body)
        .show();
    OpResult { success: true, message: "已发送".to_string() }
}
