// @Service 备份 CRUD：列表、创建、删除、重命名、恢复、置顶
// 所有涉及文件系统路径的命令必须先调用 sanitize_path_component

use serde::{Deserialize, Serialize};
use crate::app_config::{AppConfig, OpResult};
use crate::svc::config_io::{load_config, save_config, log_info, log_error};
use crate::cmd::hash::{compute_single_hash, compute_file_hash};

// @Entity 备份元数据
#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct BackupInfo {
    pub folder_name: String,
    pub display_name: String,
    pub description: String,
    pub original_file_path: String,
    pub content_hash: String,
    pub pinned: bool,
}

// @Entity 恢复文件选择时的文件信息
#[derive(Debug, Serialize, Deserialize)]
pub struct FileInfo {
    pub name: String,
    pub original_path: String,
}

// @Entity 恢复操作响应体
#[derive(Debug, Serialize, Deserialize)]
pub struct RestoreResult {
    pub success: bool,
    pub message: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub available_files: Option<Vec<FileInfo>>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub need_backup_confirm: Option<String>,
}

// @Utils 路径安全校验：阻止 ..、/、\\ 等目录穿越字符
pub fn sanitize_path_component(name: &str) -> Result<String, OpResult> {
    if name.contains("..") || name.contains('/') || name.contains('\\') {
        return Err(OpResult {
            success: false,
            message: "无效的路径".to_string(),
        });
    }
    Ok(name.to_string())
}

// @Service 备份列表内部实现（无 IPC，供 create_backup 复用）
pub fn list_backups_internal(config: &AppConfig, game_id: &str, slot_id: &str) -> Vec<BackupInfo> {
    let game_dir = std::path::PathBuf::from(&config.backup_root)
        .join(game_id)
        .join(slot_id);

    if !game_dir.exists() { return vec![]; }

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

    backups.sort_by(|a, b| {
        b.pinned.cmp(&a.pinned).then_with(|| b.folder_name.cmp(&a.folder_name))
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
                let display_name = meta["display_name"].as_str().unwrap_or(folder_name).to_string();
                let pinned = meta["pinned"].as_bool().unwrap_or(false);
                let (original_path, hash) = if let Some(files) = meta["files"].as_object() {
                    let first = files.values().next().and_then(|v| v.as_object());
                    (
                        first.and_then(|f| f["original_path"].as_str()).unwrap_or("").to_string(),
                        first.and_then(|f| f["content_hash"].as_str()).unwrap_or("").to_string(),
                    )
                } else {
                    (
                        meta["original_file_path"].as_str().unwrap_or("").to_string(),
                        meta["content_hash"].as_str().unwrap_or("").to_string(),
                    )
                };
                (display_name, original_path, hash, pinned)
            })
            .unwrap_or_else(|| (folder_name.to_string(), String::new(), String::new(), false))
    } else {
        (folder_name.to_string(), String::new(), String::new(), false)
    };

    let description = folder_name
        .split(' ')
        .skip(2)
        .collect::<Vec<_>>()
        .join(" ");

    Some(BackupInfo {
        folder_name: folder_name.to_string(),
        display_name,
        description,
        original_file_path,
        content_hash,
        pinned,
    })
}

// @Endpoint 创建存档备份
#[tauri::command]
pub fn create_backup(
    app: tauri::AppHandle,
    game_id: String,
    slot_id: String,
    file_paths: Vec<String>,
) -> OpResult {
    if let Err(e) = sanitize_path_component(&game_id) { return e; }
    if let Err(e) = sanitize_path_component(&slot_id) { return e; }
    log_info(&app, &format!("create_backup: game={}, slot={}, files={}", game_id, slot_id, file_paths.len()));
    let mut config = load_config(&app);

    if config.backup_root.is_empty() {
        return OpResult { success: false, message: "请先在设置中配置备份根目录".to_string() };
    }
    if file_paths.is_empty() {
        return OpResult { success: false, message: "请先添加存档文件".to_string() };
    }
    for fp in &file_paths {
        let source = std::path::PathBuf::from(fp);
        if !source.exists() {
            return OpResult { success: false, message: format!("文件不存在: {}", fp) };
        }
    }

    let slot = match config.games.iter().find(|g| g.id == game_id) {
        Some(game) => match game.slots.iter().find(|s| s.id == slot_id) {
            Some(s) => s.clone(),
            None => return OpResult { success: false, message: "存档位不存在".to_string() },
        },
        None => return OpResult { success: false, message: "游戏不存在".to_string() },
    };
    let backup_number = slot.next_backup_number;

    let mut file_hashes: std::collections::HashMap<String, String> = std::collections::HashMap::new();
    for fp in &file_paths {
        let path = std::path::Path::new(fp);
        let file_name = path.file_name()
            .map(|n| n.to_string_lossy().to_string())
            .unwrap_or_else(|| fp.clone());
        let hash = match compute_single_hash(fp.clone(), slot.key_file_patterns.clone()) {
            Ok(h) => h,
            Err(e) => return OpResult { success: false, message: format!("计算哈希失败: {}", e) },
        };
        file_hashes.insert(file_name, hash);
    }

    // 去重检查
    let existing = list_backups_internal(&config, &game_id, &slot_id);
    if let Some(latest) = existing.first() {
        let meta_path = std::path::PathBuf::from(&config.backup_root)
            .join(&game_id).join(&slot_id).join(&latest.folder_name).join("meta.json");
        if let Ok(meta_str) = std::fs::read_to_string(&meta_path) {
            if let Ok(meta) = serde_json::from_str::<serde_json::Value>(&meta_str) {
                let all_match = if let Some(old_files) = meta["files"].as_object() {
                    file_hashes.iter().all(|(name, hash)| {
                        old_files.get(name)
                            .and_then(|f| f["content_hash"].as_str())
                            .map(|h| h == hash).unwrap_or(false)
                    }) && file_hashes.len() == old_files.len()
                } else {
                    file_hashes.len() == 1
                        && meta["content_hash"].as_str().map(|h| h == file_hashes.values().next().unwrap()).unwrap_or(false)
                };
                if all_match {
                    return OpResult { success: false, message: "存档未变化，无需重复备份".to_string() };
                }
            }
        }
    }

    let now = chrono::Local::now();
    let timestamp_part = now.format("%Y-%m-%d %H-%M-%S").to_string();
    let folder_name = format!("{} {}", timestamp_part, backup_number);
    let display_name_full = format!("{} {}", now.format("%Y-%m-%d %H:%M:%S"), backup_number);

    let backup_dir = std::path::PathBuf::from(&config.backup_root)
        .join(&game_id).join(&slot_id).join(&folder_name);
    if let Err(e) = std::fs::create_dir_all(&backup_dir) {
        return OpResult { success: false, message: format!("创建备份目录失败: {}", e) };
    }

    let mut files_meta = serde_json::Map::new();
    for fp in &file_paths {
        let source = std::path::Path::new(fp);
        let file_name = source.file_name()
            .map(|n| n.to_string_lossy().to_string())
            .unwrap_or_else(|| fp.clone());
        let dest = backup_dir.join(&file_name);
        if let Err(e) = std::fs::copy(source, &dest) {
            return OpResult { success: false, message: format!("复制文件失败: {}", e) };
        }
        let hash = file_hashes.get(&file_name).cloned().unwrap_or_default();
        files_meta.insert(file_name.clone(), serde_json::json!({
            "original_path": fp, "content_hash": hash,
        }));
    }

    let meta = serde_json::json!({
        "display_name": display_name_full,
        "description": backup_number.to_string(),
        "files": files_meta,
    });
    if let Ok(json) = serde_json::to_string_pretty(&meta) {
        let _ = std::fs::write(backup_dir.join("meta.json"), json);
    }

    if let Some(game) = config.games.iter_mut().find(|g| g.id == game_id) {
        if let Some(s) = game.slots.iter_mut().find(|s| s.id == slot_id) {
            s.next_backup_number += 1;
        }
    }
    save_config(&app, &config);
    OpResult { success: true, message: format!("备份成功: {}", folder_name) }
}

// @Endpoint 获取备份列表
#[tauri::command]
pub fn list_backups(app: tauri::AppHandle, game_id: String, slot_id: String) -> Vec<BackupInfo> {
    if sanitize_path_component(&game_id).is_err() || sanitize_path_component(&slot_id).is_err() {
        log_error(&app, &format!("SECURITY: blocked path component: game={}, slot={}", game_id, slot_id));
        return vec![];
    }
    let config = load_config(&app);
    let result = list_backups_internal(&config, &game_id, &slot_id);
    if result.is_empty() {
        let game_dir = std::path::PathBuf::from(&config.backup_root).join(&game_id).join(&slot_id);
        if !game_dir.exists() {
            log_info(&app, &format!("list_backups: dir not found: {:?}", game_dir));
        }
    }
    result
}

// @Endpoint 删除备份目录
#[tauri::command]
pub fn delete_backup(app: tauri::AppHandle, game_id: String, slot_id: String, folder_name: String) -> OpResult {
    if let Err(e) = sanitize_path_component(&game_id) { return e; }
    if let Err(e) = sanitize_path_component(&slot_id) { return e; }
    if let Err(e) = sanitize_path_component(&folder_name) { return e; }
    log_info(&app, &format!("delete_backup: folder={}", folder_name));
    let config = load_config(&app);
    let backup_dir = std::path::PathBuf::from(&config.backup_root)
        .join(&game_id).join(&slot_id).join(&folder_name);
    if !backup_dir.exists() {
        return OpResult { success: false, message: "备份不存在".to_string() };
    }
    match std::fs::remove_dir_all(&backup_dir) {
        Ok(_) => OpResult { success: true, message: "备份已删除".to_string() },
        Err(e) => OpResult { success: false, message: format!("删除失败: {}", e) },
    }
}

// @Endpoint 重命名备份
#[tauri::command]
pub fn rename_backup(app: tauri::AppHandle, game_id: String, slot_id: String, folder_name: String, new_description: String) -> OpResult {
    if let Err(e) = sanitize_path_component(&game_id) { return e; }
    if let Err(e) = sanitize_path_component(&slot_id) { return e; }
    if let Err(e) = sanitize_path_component(&folder_name) { return e; }
    if let Err(e) = sanitize_path_component(&new_description) { return e; }
    let config = load_config(&app);
    let game_dir = std::path::PathBuf::from(&config.backup_root).join(&game_id).join(&slot_id);
    let old_path = game_dir.join(&folder_name);
    if !old_path.exists() {
        return OpResult { success: false, message: "备份不存在".to_string() };
    }
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
    let meta_path = new_path.join("meta.json");
    if let Ok(json_str) = std::fs::read_to_string(&meta_path) {
        if let Ok(mut meta) = serde_json::from_str::<serde_json::Value>(&json_str) {
            let new_display = if new_description.is_empty() {
                meta["display_name"].as_str().unwrap_or("").split(' ').take(2).collect::<Vec<_>>().join(" ")
            } else {
                let time_part = meta["display_name"].as_str().unwrap_or("").split(' ').take(2).collect::<Vec<_>>().join(" ");
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

// @Endpoint 恢复备份
#[tauri::command]
pub fn restore_backup(
    app: tauri::AppHandle, game_id: String, slot_id: String, folder_name: String,
    skip_backup: bool, selected_files: Option<Vec<String>>,
) -> RestoreResult {
    log_info(&app, &format!("restore_backup: folder={}, skip_backup={}", folder_name, skip_backup));
    if let Err(e) = sanitize_path_component(&game_id) {
        return RestoreResult { success: false, message: e.message, available_files: None, need_backup_confirm: None };
    }
    if let Err(e) = sanitize_path_component(&slot_id) {
        return RestoreResult { success: false, message: e.message, available_files: None, need_backup_confirm: None };
    }
    if let Err(e) = sanitize_path_component(&folder_name) {
        return RestoreResult { success: false, message: e.message, available_files: None, need_backup_confirm: None };
    }
    let config = load_config(&app);
    let backup_dir = std::path::PathBuf::from(&config.backup_root)
        .join(&game_id).join(&slot_id).join(&folder_name);
    if !backup_dir.exists() {
        return RestoreResult { success: false, message: "备份不存在".to_string(), available_files: None, need_backup_confirm: None };
    }
    let meta_path = backup_dir.join("meta.json");
    let files_info: Vec<FileInfo> = if meta_path.exists() {
        let meta_str = std::fs::read_to_string(&meta_path).unwrap_or_default();
        if let Ok(meta) = serde_json::from_str::<serde_json::Value>(&meta_str) {
            if let Some(files) = meta["files"].as_object() {
                files.iter().map(|(name, info)| FileInfo {
                    name: name.clone(),
                    original_path: info["original_path"].as_str().unwrap_or("").to_string(),
                }).collect()
            } else if let Some(original_path) = meta["original_file_path"].as_str() {
                let backup_file = find_backup_file(&backup_dir);
                let name = backup_file.as_ref()
                    .and_then(|p| p.file_name()).map(|n| n.to_string_lossy().to_string())
                    .unwrap_or_else(|| "save.dat".to_string());
                vec![FileInfo { name, original_path: original_path.to_string() }]
            } else { vec![] }
        } else { vec![] }
    } else { vec![] };

    if files_info.is_empty() {
        return RestoreResult { success: false, message: "备份中没有文件信息".to_string(), available_files: None, need_backup_confirm: None };
    }
    if files_info.len() > 1 && selected_files.is_none() {
        return RestoreResult {
            success: false, message: "请选择要恢复的文件".to_string(),
            available_files: Some(files_info), need_backup_confirm: None,
        };
    }
    let to_restore: Vec<&FileInfo> = if let Some(ref selected) = selected_files {
        files_info.iter().filter(|f| selected.contains(&f.name)).collect()
    } else { files_info.iter().collect() };
    if to_restore.is_empty() {
        return RestoreResult { success: false, message: "未选择要恢复的文件".to_string(), available_files: None, need_backup_confirm: None };
    }
    if !skip_backup {
        let needs_backup = to_restore.iter().any(|f| std::path::Path::new(&f.original_path).exists());
        if needs_backup {
            let patterns: Vec<String> = config.games.iter()
                .find(|g| g.id == game_id)
                .and_then(|g| g.slots.iter().find(|s| s.id == slot_id))
                .map(|s| s.key_file_patterns.clone())
                .unwrap_or_default();
            let first_original = &to_restore[0].original_path;
            let current_hash = compute_single_hash(first_original.clone(), patterns).unwrap_or_default();
            let hash_match = list_backups_internal(&config, &game_id, &slot_id)
                .iter().any(|b| b.content_hash == current_hash);
            if !hash_match {
                return RestoreResult {
                    success: false, message: "目标文件未备份，请确认".to_string(),
                    available_files: None, need_backup_confirm: Some(first_original.clone()),
                };
            }
        }
    }
    let mut restored = 0;
    for file in &to_restore {
        let backup_file = backup_dir.join(&file.name);
        if !backup_file.exists() { continue; }
        if let Some(parent) = std::path::Path::new(&file.original_path).parent() {
            let _ = std::fs::create_dir_all(parent);
        }
        match std::fs::copy(&backup_file, &file.original_path) {
            Ok(_) => restored += 1,
            Err(e) => return RestoreResult {
                success: false, message: format!("恢复 {} 失败: {}", file.name, e),
                available_files: None, need_backup_confirm: None,
            },
        }
    }
    RestoreResult {
        success: true, message: format!("已恢复 {}/{} 个文件", restored, to_restore.len()),
        available_files: None, need_backup_confirm: None,
    }
}

fn find_backup_file(backup_dir: &std::path::Path) -> Option<std::path::PathBuf> {
    std::fs::read_dir(backup_dir).ok()?
        .filter_map(|e| e.ok())
        .filter(|e| e.file_type().map(|t| t.is_file()).unwrap_or(false))
        .filter(|e| e.file_name() != "meta.json")
        .map(|e| e.path())
        .next()
}

// @Endpoint 切换备份置顶状态
#[tauri::command]
pub fn toggle_backup_pin(app: tauri::AppHandle, game_id: String, slot_id: String, folder_name: String) -> OpResult {
    if let Err(e) = sanitize_path_component(&game_id) { return e; }
    if let Err(e) = sanitize_path_component(&slot_id) { return e; }
    if let Err(e) = sanitize_path_component(&folder_name) { return e; }
    let config = load_config(&app);
    let backup_dir = std::path::PathBuf::from(&config.backup_root)
        .join(&game_id).join(&slot_id).join(&folder_name);
    if !backup_dir.exists() {
        return OpResult { success: false, message: "备份不存在".to_string() };
    }
    let meta_path = backup_dir.join("meta.json");
    let current_pinned = std::fs::read_to_string(&meta_path)
        .ok().and_then(|json| serde_json::from_str::<serde_json::Value>(&json).ok())
        .and_then(|meta| meta["pinned"].as_bool()).unwrap_or(false);
    let new_pinned = !current_pinned;
    if let Ok(json_str) = std::fs::read_to_string(&meta_path) {
        if let Ok(mut meta) = serde_json::from_str::<serde_json::Value>(&json_str) {
            meta["pinned"] = serde_json::Value::Bool(new_pinned);
            if let Ok(new_json) = serde_json::to_string_pretty(&meta) {
                let _ = std::fs::write(&meta_path, new_json);
            }
        }
    }
    OpResult { success: true, message: if new_pinned { "已置顶".to_string() } else { "已取消置顶".to_string() } }
}

// @Endpoint 切换游戏置顶状态
#[tauri::command]
pub fn toggle_game_pin(app: tauri::AppHandle, game_id: String) -> OpResult {
    let mut config = load_config(&app);
    if let Some(game) = config.games.iter_mut().find(|g| g.id == game_id) {
        game.pinned = !game.pinned;
    }
    save_config(&app, &config);
    OpResult { success: true, message: "已更新".to_string() }
}

// @Endpoint 在资源管理器中打开指定路径
#[tauri::command]
pub fn open_folder(path: String) -> OpResult {
    let path = std::path::Path::new(&path);
    let target = if path.is_dir() { path.to_path_buf() }
    else if let Some(parent) = path.parent() { parent.to_path_buf() }
    else { return OpResult { success: false, message: "无法获取文件夹路径".to_string() }; };
    if !target.exists() {
        return OpResult { success: false, message: "文件夹不存在".to_string() };
    }
    #[cfg(target_os = "windows")] {
        std::process::Command::new("explorer")
            .arg(target.to_string_lossy().as_ref())
            .spawn()
            .map(|_| OpResult { success: true, message: "已打开文件夹".to_string() })
            .unwrap_or(OpResult { success: false, message: "打开文件夹失败".to_string() })
    }
    #[cfg(target_os = "macos")] {
        std::process::Command::new("open")
            .arg(target.to_string_lossy().as_ref())
            .spawn()
            .map(|_| OpResult { success: true, message: "已打开文件夹".to_string() })
            .unwrap_or(OpResult { success: false, message: "打开文件夹失败".to_string() })
    }
    #[cfg(target_os = "linux")] {
        std::process::Command::new("xdg-open")
            .arg(target.to_string_lossy().as_ref())
            .spawn()
            .map(|_| OpResult { success: true, message: "已打开文件夹".to_string() })
            .unwrap_or(OpResult { success: false, message: "打开文件夹失败".to_string() })
    }
}

// @Endpoint 重算备份文件中所有文件的哈希
#[tauri::command]
pub fn recompute_backup_hash(app: tauri::AppHandle, game_id: String, slot_id: String, folder_name: String) -> OpResult {
    use md5::Digest;
    if let Err(e) = sanitize_path_component(&game_id) { return e; }
    if let Err(e) = sanitize_path_component(&slot_id) { return e; }
    if let Err(e) = sanitize_path_component(&folder_name) { return e; }
    let config = load_config(&app);
    let backup_dir = std::path::PathBuf::from(&config.backup_root)
        .join(&game_id).join(&slot_id).join(&folder_name);
    if !backup_dir.exists() {
        return OpResult { success: false, message: "备份不存在".to_string() };
    }
    let meta_path = backup_dir.join("meta.json");
    let meta_str = std::fs::read_to_string(&meta_path).unwrap_or_default();
    let mut meta: serde_json::Value = serde_json::from_str(&meta_str).unwrap_or(serde_json::Value::Null);

    if let Some(files) = meta["files"].as_object_mut() {
        for (name, info) in files.iter_mut() {
            let file_path = backup_dir.join(name);
            if file_path.exists() && file_path.is_file() {
                let new_hash = compute_file_hash(&file_path).unwrap_or_default();
                info["content_hash"] = serde_json::Value::String(new_hash);
            }
        }
        let summary = files.values().next()
            .and_then(|f| f["content_hash"].as_str())
            .map(|h| h[..8.min(h.len())].to_string())
            .unwrap_or_default();
        if let Ok(new_json) = serde_json::to_string_pretty(&meta) {
            let _ = std::fs::write(&meta_path, new_json);
        }
        OpResult { success: true, message: format!("哈希已重算: {}", summary) }
    } else if meta["content_hash"].as_str().is_some() {
        let entries: Vec<std::path::PathBuf> = std::fs::read_dir(&backup_dir).into_iter().flatten()
            .filter_map(|e| e.ok())
            .filter(|e| e.file_type().map(|t| t.is_file()).unwrap_or(false))
            .filter(|e| e.file_name() != "meta.json")
            .map(|e| e.path())
            .collect();
        let new_hash = if entries.len() == 1 {
            compute_file_hash(&entries[0]).unwrap_or_default()
        } else {
            let mut hasher = md5::Md5::new();
            let mut sorted_entries = entries.clone();
            sorted_entries.sort();
            for entry in &sorted_entries {
                let file_hash = compute_file_hash(entry).unwrap_or_default();
                let rel = entry.strip_prefix(&backup_dir).unwrap_or(entry);
                hasher.update(format!("{}:{}", rel.to_string_lossy(), file_hash).as_bytes());
            }
            format!("{:x}", hasher.finalize())
        };
        meta["content_hash"] = serde_json::Value::String(new_hash.clone());
        if let Ok(new_json) = serde_json::to_string_pretty(&meta) {
            let _ = std::fs::write(&meta_path, new_json);
        }
        OpResult { success: true, message: format!("哈希已重算: {}", &new_hash[..8.min(new_hash.len())]) }
    } else {
        OpResult { success: false, message: "meta.json 格式异常".to_string() }
    }
}
