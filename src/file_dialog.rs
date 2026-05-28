// @Endpoint 系统文件/文件夹选择对话框（rfd）

use tauri::Manager;

#[tauri::command]
pub fn pick_file(app: tauri::AppHandle, start_dir: Option<String>) -> Option<String> {
    let window = app.get_webview_window("main");
    let mut dialog = rfd::FileDialog::new();
    if let Some(ref w) = window {
        dialog = dialog.set_parent(w);
    }
    if let Some(ref dir) = start_dir {
        if !dir.is_empty() {
            dialog = dialog.set_directory(dir);
        }
    }
    dialog.pick_file()
        .map(|p| p.to_string_lossy().to_string())
}

#[tauri::command]
pub fn pick_directory(app: tauri::AppHandle, start_dir: Option<String>) -> Option<String> {
    let window = app.get_webview_window("main");
    let mut dialog = rfd::FileDialog::new();
    if let Some(ref w) = window {
        dialog = dialog.set_parent(w);
    }
    if let Some(ref dir) = start_dir {
        if !dir.is_empty() {
            dialog = dialog.set_directory(dir);
        }
    }
    dialog.pick_folder()
        .map(|p| p.to_string_lossy().to_string())
}
