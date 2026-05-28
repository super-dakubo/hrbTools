// @Utils 哈希计算：MD5 文件哈希、目录哈希、通配符匹配

use std::io::Read;
use md5::{Md5, Digest};

// @Endpoint 计算文件哈希（MD5，支持通配符过滤）
#[tauri::command]
pub fn compute_hash(
    file_paths: Vec<String>,
    patterns: Vec<String>,
) -> Result<std::collections::HashMap<String, String>, String> {
    let mut result = std::collections::HashMap::new();
    for file_path in &file_paths {
        let path = std::path::Path::new(file_path);
        if !path.exists() {
            return Err(format!("路径不存在: {}", file_path));
        }
        let file_name = path
            .file_name()
            .map(|n| n.to_string_lossy().to_string())
            .unwrap_or_else(|| file_path.clone());
        let hash = if path.is_file() {
            compute_file_hash(path)?
        } else {
            compute_dir_hash(path, &patterns)?
        };
        result.insert(file_name, hash);
    }
    Ok(result)
}

// @Utils 计算单个文件/目录哈希
pub fn compute_single_hash(file_path: String, patterns: Vec<String>) -> Result<String, String> {
    let path = std::path::Path::new(&file_path);
    if !path.exists() {
        return Err(format!("路径不存在: {}", file_path));
    }
    if path.is_file() {
        compute_file_hash(path)
    } else {
        compute_dir_hash(path, &patterns)
    }
}

// @Utils 计算单个文件 MD5 哈希
pub fn compute_file_hash(path: &std::path::Path) -> Result<String, String> {
    let file =
        std::fs::File::open(path).map_err(|e| format!("打开文件失败: {}", e))?;
    let mut reader = std::io::BufReader::new(file);
    let mut hasher = Md5::new();
    let mut buf = [0u8; 8192];
    loop {
        let n = reader
            .read(&mut buf)
            .map_err(|e| format!("读取文件失败: {}", e))?;
        if n == 0 {
            break;
        }
        hasher.update(&buf[..n]);
    }
    Ok(format!("{:x}", hasher.finalize()))
}

// @Utils 计算目录哈希：按通配符过滤文件，拼接 MD5
pub fn compute_dir_hash(
    dir: &std::path::Path,
    patterns: &[String],
) -> Result<String, String> {
    let mut entries: Vec<std::path::PathBuf> = std::fs::read_dir(dir)
        .map_err(|e| format!("读取目录失败: {}", e))?
        .filter_map(|e| e.ok())
        .filter(|e| e.file_type().map(|t| t.is_file()).unwrap_or(false))
        .map(|e| e.path())
        .collect();
    entries.sort();

    let filtered: Vec<&std::path::PathBuf> = if patterns.is_empty() {
        entries.iter().collect()
    } else {
        entries
            .iter()
            .filter(|p| {
                let fname = p.file_name().unwrap_or_default().to_string_lossy();
                patterns.iter().any(|pat| simple_glob_match(pat, &fname))
            })
            .collect()
    };

    let mut hasher = Md5::new();
    for entry in &filtered {
        let rel = entry.strip_prefix(dir).unwrap_or(entry);
        let rel_str = rel.to_string_lossy().replace('\\', "/");
        let file_hash = compute_file_hash(entry)?;
        hasher.update(format!("{}:{}", rel_str, file_hash).as_bytes());
    }
    Ok(format!("{:x}", hasher.finalize()))
}

// @Utils 简单通配符匹配：支持 *xxx、xxx*、*xxx*
pub fn simple_glob_match(pattern: &str, name: &str) -> bool {
    let pattern = pattern.to_lowercase();
    let name = name.to_lowercase();
    if let Some(suffix) = pattern.strip_prefix('*').and_then(|s| s.strip_suffix('*')) {
        return name.contains(suffix);
    }
    if let Some(suffix) = pattern.strip_prefix('*') {
        return name.ends_with(suffix);
    }
    if let Some(prefix) = pattern.strip_suffix('*') {
        return name.starts_with(prefix);
    }
    name == pattern
}
