# Rust 注释优化 + 全端日志优化 实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** main.rs 加 SpringBoot 视角架构标签注释 + JS/Rust 两端日志噪音移除与关键节点补充

**Architecture:** 按 main.rs 区块从上到下逐块处理，每个区块同时做注释和日志调整。JS 端仅日志增删，不与 Rust 端耦合。

**Tech Stack:** Tauri 2.0 Rust 后端 + 原生 JS 前端，无打包器/无 npm

**设计文档:** `docs/superpowers/specs/2026-05-23-rust-comments-and-log-optimization.md`

---

## 文件结构

| 文件 | 改动类型 | 说明 |
|------|---------|------|
| `src/main.js` | 仅日志增删 | 移除 11 处噪音 PERF/INFO，新增 3 处防御性 error 日志 |
| `src/main.rs` | 注释 + 日志 | 注释：~70 行标签注释；日志：新增 `log_info` 函数 + 5 处防御性日志 + 6 处关键节点日志 |

---

### Task 1: JS 端 — 移除 11 处噪音日志

**文件:** `src/main.js`

- [ ] **Step 1.1: 移除 TabSwitch「请求切到」PERF（行 171）**

  删除整行：
  ```
  window.__log.perf('TabSwitch', '请求切到' + tabId, { lock: _switchLock });
  ```

- [ ] **Step 1.2: 移除 5 处子渲染 PERF（行 316，574，593，666，670，683）**

  行 316:
  ```
  window.__log.perf('Render', 'renderTimezoneSets', { ms: ..., sets: ... });
  ```
  行 574:
  ```
  window.__log.perf('Render', 'renderFileTags', { ms: ..., files: ... });
  ```
  行 593:
  ```
  window.__log.perf('Render', 'renderGameTabs', { ms: ..., games: ... });
  ```
  行 666/670:
  ```
  window.__log.perf('Render', 'renderSlotTabs', ...
  ```
  行 683:
  ```
  window.__log.perf('Render', 'renderSlotTabs', { ms: ..., slots: ... });
  ```

- [ ] **Step 1.3: 移除 2 处「阻断」PERF（行 833，1512）**

  行 833:
  ```
  window.__log.perf('Backup', '阻断: refreshBackupList 锁占用中');
  ```
  行 1512:
  ```
  window.__log.perf('Backup', '阻断: refreshAll 锁占用中');
  ```

- [ ] **Step 1.4: 移除「refreshBackupList 0备份」PERF（行 861）**

  ```
  window.__log.perf('Render', 'refreshBackupList', { ms: ..., backups: 0, ipc: ipcMs });
  ```

- [ ] **Step 1.5: 移除「Settings 进入设置面板」INFO（行 1149）**

  ```
  window.__log.info('Settings', '进入设置面板');
  ```

- [ ] **Step 1.6: 新增 3 处防御性日志**

  **A) `loadConfig` 的 `__configPromise` 失败（在 `loadConfig` 函数内的 `if (!config)` 分支添加）：**
  ```js
  if (!config) {
      window.__log.error('Config', '获取配置失败: IPC 返回空');
      config = await invoke('get_config');
  }
  ```

  **B) `saveConfigToBackend` 函数包装 catch：**
  ```js
  async function saveConfigToBackend() {
      try {
          await invoke('set_config', { config: currentConfig });
      } catch (err) {
          window.__log.error('Config', '保存配置失败: ' + err);
      }
  }
  ```

  **C) `syncPendingReminders` 函数体开头加 try-catch：**
  ```js
  function syncPendingReminders() {
      try {
          // ... 现有逻辑 ...
      } catch (err) {
          window.__log.error('Reminder', '同步待提醒列表异常: ' + err);
      }
  }
  ```

- [ ] **Step 1.7: 验证 JS 语法**

  ```bash
  node --check src/main.js
  ```
  Expected: no syntax errors

---

### Task 2: Rust 端 — 新增 `log_info` 辅助函数

**文件:** `src/main.rs:1073-1085`

- [ ] **Step 2.1: 在 `log_error` 函数下方新增 `log_info`**

  ```rust
  /// 写入信息日志到应用日志目录（同 log_error，但标记 [info] 级别）
  fn log_info(app: &tauri::AppHandle, msg: &str) {
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
  ```

- [ ] **Step 2.2: cargo check**

  ```bash
  cd d:/code/hello_world && cargo check
  ```
  Expected: OK

---

### Task 3: Rust 端 — 新增防御性日志 + 关键节点日志

**文件:** `src/main.rs`（多行散布）

- [ ] **Step 3.1: `resolve_timezone` 匹配失败加日志（行 53，`_ => None` 分支前）**

  ```rust
  _ => {
      // 未知时区名，记录以便排查配置错误
      None
  }
  ```

  Note: `resolve_timezone` 是纯函数，当前没有 `app: &tauri::AppHandle` 参数。**不改函数签名**，保持纯函数特性。此条日志在调用方记录。

- [ ] **Step 3.2: `sanitize_path_component` 拒绝前加日志**

  `sanitize_path_component` 也是纯函数（无 `app` 参数）。**不改函数签名**，在**调用方**记录。所有调用此函数的命令在收到 `Err` 时，调用方已有 return 逻辑，只需在 return 前加一行日志。

- [ ] **Step 3.3: `load_config` 解析/读取失败加日志**

  行 1066 (`Err(_) => AppConfig::default()`) 前：
  ```rust
  Err(e) => {
      log_error(app, &format!("Config read error: {}", e));
      AppConfig::default()
  }
  ```

  行 1017 (`serde_json::from_str(&json).unwrap_or_default()`) 展开为：
  ```rust
  let config_result = serde_json::from_value(raw.clone());
  let mut config: AppConfig = match config_result {
      Ok(c) => c,
      Err(e) => {
          log_error(app, &format!("Config parse error: {}", e));
          AppConfig::default()
      }
  };
  ```

- [ ] **Step 3.4: `list_backups_internal` read_dir 失败加日志**

  行 1303 (`Err(_) => vec![]`) 改为：
  ```rust
  Err(e) => {
      // 注意：list_backups_internal 目前没有 app 参数，改签名影响透传
      // 不在 list_backups_internal 内部加，改在调用方 list_backups 命令加
      vec![]
  }
  ```

  `list_backups` 命令（行 1520-1526）返回前加：
  ```rust
  #[tauri::command]
  fn list_backups(app: tauri::AppHandle, game_id: String, slot_id: String) -> Vec<BackupInfo> {
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
  ```

- [ ] **Step 3.5: 关键节点命令 — 5 个写操作入口加 `log_info`**

  **`create_backup`** 行 1368 函数体开头：
  ```rust
  log_info(&app, &format!("create_backup: game={}, slot={}, files={}", game_id, slot_id, file_paths.len()));
  ```

  **`restore_backup`** 行 1629 函数体开头：
  ```rust
  log_info(&app, &format!("restore_backup: folder={}, skip_backup={}", folder_name, skip_backup));
  ```

  **`delete_backup`** 行 1534 函数体开头：
  ```rust
  log_info(&app, &format!("delete_backup: folder={}", folder_name));
  ```

  **`add_screenshot_source`** 行 945 函数体开头：
  ```rust
  log_info(&app, &format!("add_screenshot_source: name={}, path={}", name, path));
  ```

  **`delete_screenshot`** 行 988 函数体开头：
  ```rust
  log_info(&app, &format!("delete_screenshot: path={}", path));
  ```

  **`set_config`** 行 1224 加载旧配置后：
  ```rust
  log_info(&app, &format!("set_config: auto_start={}, theme={}", config.auto_start, config.theme));
  ```

- [ ] **Step 3.6: cargo check**

  ```bash
  cd d:/code/hello_world && cargo check
  ```
  Expected: OK

---

### Task 4: Rust 端 — 注释优化前半部分（行 1 ~ 1001）

**文件:** `src/main.rs:1-1001`

逐结构体/函数添加 `// @{标签}` 注释。以下为完整清单：

- [ ] **Step 4.1: 文件头（行 1-2）**

  ```rust
  // @Setup Tauri 2.0 桌面应用后端入口（仅 Windows 无边框窗口）
  // @see src/main.js 前端 IPC 调用方
  #![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]
  ```

- [ ] **Step 4.2: 时区工具区块（行 19-105）**

  - `resolve_timezone`: `// @Service 解析时区名称为固定偏移（含 DST 自动切换）\n// 替代 chrono-tz 依赖节省 2-3MB，手动维护 7 个常用时区的 DST 规则`
  - `nth_sunday_of_month`: `// @Utils 计算某月第 N 个星期日（DST 切换日期计算用）`
  - `last_sunday_of_month`: `// @Utils 计算某月最后一个星期日（英国 DST 切换用）`
  - `last_day_of_month`: `// @Utils 计算某月的最后一天（月末模式提醒用）`
  - `ConvertRequest`/`ConvertResponse`: `// @Entity 时间→时间戳转换请求/响应体`
  - `TimestampRequest`/`DatetimeResponse`: `// @Entity 时间戳→时间转换请求/响应体`

- [ ] **Step 4.3: 配置结构体区块（行 106-255）**

  - `SlotConfig`: `// @Entity 存档位配置：文件列表、备份序号、关键文件匹配模式`
  - `GameConfig`: `// @Entity 游戏实体，ID 不可变（目录路径由 ID 构建，支持改名）\n// @see id-based-entities skill`
  - `TimezoneSet`: `// @Entity 时区套件：包含时区、格式、置顶与排序`
  - `AppConfig`: `// @Entity 应用配置根结构，对应 config.json 完整 schema\n// 修改字段时需同步前端 currentConfig 访问路径`
  - `ScreenshotSource/Entry/DetectedSource`: `// @Entity 截图来源/条目/自动检测结果`
  - `TodoItem/ReminderConfig/BannerEntry/PendingReminder`: `// @Entity 待办/提醒/横幅数据结构`

- [ ] **Step 4.4: 节假日 + 备份 + 操作结果（行 350-416）**

  - `get_day_type`: `// @Service 节假日判定：补班日优先 → 假期段 → 周末兜底\n// JS 端 getDayType() 保持独立实现，修改需同步两端`
  - `BackupInfo`: `// @Entity 备份元数据，对应 meta.json 序列化结构`
  - `OpResult`: `// @Entity 写操作统一响应体 { success, message }`
  - `FileInfo`: `// @Entity 恢复文件选择时的文件信息`
  - `RestoreResult`: `// @Entity 恢复操作响应体（含多文件选择、备份确认状态）`

- [ ] **Step 4.5: 截图区块（行 428-1001）**

  - `is_image_file`: `// @Utils 检测文件是否为支持的图片格式（png/jpg/webp/bmp/gif）`
  - `Base64Cache`: `// @Entity LRU 图片缓存：100 条目 / 500MB，Mutex + OnceLock 全局单例`
  - `scan_screenshots`: `// @Endpoint 递归扫描截图目录（最多 2 层/50 张），按修改时间倒序\n// 安全校验：canonicalize 防路径穿越 + source_id 授权检查`
  - `get_screenshot_base64_batch`: `// @Endpoint 批量读取截图 → base64 data URI，LRU 缓存加速`
  - `detect_screenshot_sources`: `// @Endpoint 自动检测 Steam + 米哈游系列截图目录`
  - VDF parser functions: `// @Utils Steam VDF 格式解析器（char-indexed UTF-8 安全）`
  - `uuid_v4`: `// @Utils 基于时间戳的 UUID v4 生成器`
  - `add/remove_screenshot_source`, `delete_screenshot`: `// @Endpoint ...`

- [ ] **Step 4.6: cargo check**

  ```bash
  cd d:/code/hello_world && cargo check
  ```
  Expected: OK

---

### Task 5: Rust 端 — 注释优化后半部分（行 1002 ~ 2527）

**文件:** `src/main.rs:1002-2527`

- [ ] **Step 5.1: 配置持久化（行 1002-1113）**

  - `config_path`: `// @Repository 获取 config.json 路径（app_data_dir 下）`
  - `load_config`: `// @Repository 读取并解析 config.json，含旧格式迁移\n// 安全写入：先写 .tmp → rename 原子替换，写入前备份 .bak`
  - `save_config`: `// @Repository 原子写入配置：tmp + rename，写入前备份已有文件`
  - `log_error` / `log_info`: `// @Utils 后端日志写入（与前端日志同文件）`

- [ ] **Step 5.2: 开机自启 + 时区转换命令（行 1115-1216）**

  - `set_auto_start`: `// @Setup Windows 注册表开机自启（reg.exe，仅在 set_config 中调）`
  - `convert_to_timestamp`: `// @Endpoint datetime→timestamp 转换，支持 4 种输入格式`
  - `convert_to_datetime`: `// @Endpoint timestamp→datetime 转换`

- [ ] **Step 5.3: 配置/文件/备份命令（行 1218-1764）**

  - `get_config/set_config`: `// @Endpoint 读取/写入完整配置`
  - `get_holiday_data/save_holiday_data`: `// @Endpoint 读取/保存节假日数据`
  - `pick_file/pick_directory`: `// @Endpoint 系统文件/文件夹选择对话框`
  - `list_backups_internal`: `// @Service 备份列表内部实现（无 IPC，供 create_backup 复用）`
  - `create_backup/list_backups/delete_backup/rename_backup`: `// @Endpoint ...`
  - `restore_backup`: `// @Endpoint 恢复备份含三种流程：直接恢复/多文件选择/需要先备份确认`
  - `find_backup_file`: `// @Utils 在备份目录中找第一个非 meta.json 的文件（旧格式兼容用）`

- [ ] **Step 5.4: 哈希 + 时区套件 + 通知/窗口（行 1776-2132）**

  - `compute_hash/compute_file_hash/compute_dir_hash`: `// @Endpoint/@Utils ...`
  - `simple_glob_match`: `// @Utils 简单通配符匹配：*xxx / xxx* / *xxx*`
  - `toggle_backup_pin/toggle_game_pin`: `// @Endpoint ...`
  - `open_folder`: `// @Endpoint 在资源管理器中打开指定路径`
  - `recompute_backup_hash`: `// @Endpoint 重算备份文件中所有文件的哈希`
  - 时区套件 CRUD: `// @Endpoint ...`
  - `send_notification`: `// @Endpoint 发送系统通知`
  - 窗口控制: `// @Endpoint 窗口最小化/最大化/关闭`

- [ ] **Step 5.5: 日志命令 + 提醒系统 + main()（行 2134-2527）**

  - `log_write/open_log_folder/read_today_logs`: `// @Endpoint 日志读写/打开日志目录`
  - `advance_daily_reminder/advance_monthly_reminder`: `// @Service 提醒推期逻辑：daily 按工作日/休息日，monthly 支持月末模式`
  - `main()` setup: `// @Setup 应用入口：托盘图标 → 窗口初始化 → 提醒线程\n// 提醒线程：生产者/消费者模式，JS 产 pending_reminders，Rust 每 5s 消费`

- [ ] **Step 5.6: cargo check**

  ```bash
  cd d:/code/hello_world && cargo check
  ```
  Expected: OK

---

### Task 6: 最终验证

- [ ] **Step 6.1: 全量 cargo check**

  ```bash
  cd d:/code/hello_world && cargo check 2>&1
  ```
  Expected: OK, no warnings

- [ ] **Step 6.2: JS 语法检查**

  ```bash
  node --check src/main.js
  ```
  Expected: no errors

- [ ] **Step 6.3: git diff review**

  ```bash
  git diff --stat
  ```
  预期：main.rs +~90 行 / main.js -11 +3 行

- [ ] **Step 6.4: 提交**

  ```bash
  git add .
  git commit -m "docs: add SpringBoot-style architecture annotations to main.rs
  refactor: remove noisy PERF logs from JS side, add defensive logging to Rust backend

  - Add @Endpoint/@Service/@Entity/@Setup/@Repository/@Utils labels mapping
    Tauri concepts to SpringBoot layering for easier onboarding
  - Remove 11 non-essential PERF/INFO log lines from main.js
  - Add 3 defensive error logs to JS side (Config fetch/save, Reminder sync)
  - Add log_info helper to Rust backend for non-error logging
  - Add 5 defensive logs (path security, config parse, backup read)
  - Add 6 key-node logs for write operations (backup/restore/delete/config)

  Co-Authored-By: Claude Opus 4.5 <noreply@anthropic.com>"
  ```
