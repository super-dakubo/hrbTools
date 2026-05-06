# CLAUDE.md

本文档为 Claude Code (claude.ai/code) 在此代码库中工作提供指导。

## 常用命令

- `cargo tauri dev` – 启动 Tauri 开发服务器（Rust 后端 + 网页前端）
- `cargo tauri build` – 为当前平台构建生产版本二进制文件
- `cargo build` – 仅编译 Rust 后端

## 架构概述

这是一个 Tauri 2.0 桌面应用程序，功能是将日期时间字符串转换为 Unix 时间戳。遵循标准的 Tauri 架构：

- **前端**：纯 HTML/CSS/JS，位于 `src/` 目录
  - `index.html` – 单页界面，包含日期时间输入框、时区下拉菜单和结果显示区域
  - `styles.css` – 现代化响应式样式设计，采用居中卡片布局
  - `main.js` – 处理 UI 事件，通过 `invoke('convert_to_timestamp', …)` 调用 Rust 后端

- **后端**：Rust 代码，位于 `src/main.rs`
  - 使用 `#[tauri::command]` 定义 `convert_to_timestamp` 命令
  - 使用 `chrono` 和 `chrono‑tz` 解析日期时间字符串并转换时区
  - 需要 `use chrono::TimeZone` trait 才能调用 `from_local_datetime`
  - 返回通过 `serde` 序列化的结构化 `ConvertResponse`（包含成功/错误信息）

- **构建系统**
  - `build.rs` – Tauri 构建脚本，调用 `tauri_build::build()` 生成运行时上下文
  - `tauri.conf.json` – Tauri 2.0 配置（窗口标题/尺寸、图标路径、前端目录）

- **数据流程**
  1. 前端发送 JSON 格式的 `{ datetime_str, timezone }`
  2. Rust 验证时区，解析日期时间（支持多种格式）
  3. 本地时间 → UTC → Unix 时间戳（秒）
  4. 响应 `{ success, timestamp, error }` 返回给前端

- **依赖项**
  - `tauri = "2.0"` – 桌面应用框架
  - `tauri-build = "2"` – 构建时依赖，`build.rs` 使用
  - `serde`, `serde_json` – JSON 序列化
  - `chrono`（开启 `serde` feature），`chrono‑tz` – 日期时间解析和时区转换

- **平台特定说明**
  - `#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]` 在 Windows 发布版本中隐藏控制台窗口。