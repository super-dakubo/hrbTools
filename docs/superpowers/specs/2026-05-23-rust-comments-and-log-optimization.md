# Rust 注释优化 + 全端日志优化设计

## 动机

1. **注释**：项目使用 Tauri（Rust），团队中有 SpringBoot 背景的开发者，需要一套清晰的架构标签来降低理解成本
2. **日志**：当前日志存在两级问题 — 前端 PERF 噪音过多掩盖关键信息，后端缺少错误上下文和防御性日志

## 改动范围

- `src/main.rs`：注释 + 日志调整
- `src/main.js`：日志调整（仅增删，不涉及注释改动）

---

## 1. 注释风格约定

### 标签映射

| 标签 | 对应 SpringBoot | main.rs 适用对象 |
|------|----------------|-----------------|
| `// @Endpoint` | `@Controller` / `@RequestMapping` | `#[tauri::command]` 函数 |
| `// @Service` | `@Service` | 业务逻辑函数（备份、时区、提醒等） |
| `// @Entity` | `@Entity` | 数据结构体（AppConfig, SlotConfig 等） |
| `// @Setup` | `@Configuration` / `@SpringBootApplication` | `main()`, `setup()` |
| `// @Repository` | `@Repository` | 配置持久化（load_config / save_config） |
| `// @Utils` | `@Utils` | 工具函数（escapeHtml, hash, VDF parser 等） |

### 三层注释结构

每个函数/结构体最多三层：

```rust
// @{标签} {一句话说明做什么}
// {补充说明：设计决策、边界条件、注意事项}
// {关键行内注释：说明"为什么这样写"，不说"是什么"}
```

- 第一行必选（标签 + 概要）
- 第二行可选，只在有非显而易见的设计决策时加
- 第三行行内注释，只在逻辑不直观处加

### 示例

```rust
// @Entity 游戏实体，ID 不可变（目录路径由 ID 构建，支持改名）
struct GameConfig { id: String, name: String, ... }

// @Endpoint 创建存档备份：校验路径 → 计算哈希 → 去重检查 → 复制文件 → 写入 meta.json
#[tauri::command]
fn create_backup(...) -> OpResult { ... }

// @Utils 简单通配符匹配：支持 *xxx、xxx*、*xxx*
fn simple_glob_match(pattern: &str, name: &str) -> bool { ... }
```

---

## 2. JS 端日志调整

### 移除（13 处噪音）

| # | 行号 | 内容 | 理由 |
|---|------|------|------|
| 1 | 171 | `TabSwitch 请求切到{tab}` | "执行切到"紧随其后，此行冗余 |
| 2 | 316 | `renderTimezoneSets PERF` | 子渲染 PERF，Tab 总 PERF 已覆盖 |
| 3 | 574 | `renderFileTags PERF` | 同上 |
| 4 | 593 | `renderGameTabs PERF` | 同上 |
| 5 | 666 | `renderSlotTabs PERF` (空) | 同上 |
| 6 | 670 | `renderSlotTabs PERF` (空, 第二分支) | 同上 |
| 7 | 683 | `renderSlotTabs PERF` (有数据) | 同上 |
| 8 | 833 | `refreshBackupList 阻断` | 正常不应触发，896 行数据已说明问题 |
| 9 | 861 | `refreshBackupList 0备份` | 896 行已统一覆盖 |
| 10 | 1149 | `Settings 进入设置面板` | 正常操作路径，非关键事件 |
| 11 | 1512 | `refreshAll 阻断` | 同 833 |

### 新增（JS 端，防御性日志）

| 位置 | 内容 |
|------|------|
| `loadConfig` 的 `__configPromise` 失败 | `window.__log.error('Config', '获取配置失败: ' + err)` |
| `saveConfigToBackend` catch | `window.__log.error('Config', '保存配置失败: ' + err)` |
| `syncPendingReminders` try 包裹异常 | `window.__log.error('Reminder', '同步待提醒列表异常: ' + err)` |

---

## 3. Rust 端日志调整

### 新增辅助函数：`log_info`

Rust 后端当前只有 `log_error`，无法写 INFO 级别的日志。新增一个 `log_info` 函数，与 `log_error` 同路径（同日志文件），仅标签从 `[error]` 改为 `[info]`。

```rust
fn log_info(app: &tauri::AppHandle, msg: &str) {
    // 与 log_error 相同实现，但写 [info] 标签
}
```

### 新增防御性日志

| 位置 | 内容 |
|------|------|
| `sanitize_path_component` 拒绝 | `log_error(app, &format!("SECURITY: blocked path component: {}", name))` — **注意：避免日志自身参数包含用户输入导致注入，已通过 `format!` 安全转义** |
| `resolve_timezone` 匹配失败 | `log_info(app, &format!("Unknown timezone: {}", tz_name))` |
| `load_config` 解析错误 | `log_error(app, &format!("Config parse error: {}", err))` |
| `load_config` 文件读取失败 | `log_error(app, &format!("Config read error: {}", err))` |
| `list_backups_internal` read_dir 失败 | `log_error(app, &format!("list_backups: cannot read dir {}: {}", path, err))` |

### 新增关键节点日志

| 命令 | 内容 |
|------|------|
| `create_backup` 开始 | `log_info(app, &format!("create_backup: game={}, slot={}, files={}", game_id, slot_id, file_paths.len()))` |
| `restore_backup` 开始 | `log_info(app, &format!("restore_backup: folder={}, files={}", folder_name, files_info.len()))` |
| `delete_backup` 开始 | `log_info(app, &format!("delete_backup: folder={}", folder_name))` |
| `add_screenshot_source` 开始 | `log_info(app, &format!("add_screenshot_source: name={}, path={}", name, path))` |
| `delete_screenshot` 开始 | `log_info(app, &format!("delete_screenshot: path={}", path))` |
| `set_config` 开始 | `log_info(app, &format!("set_config: auto_start={}, theme={}", config.auto_start, config.theme))` |

---

## 4. main.rs 注释改动清单（按区块）

| 区块 | 行范围 | 改动内容 | 估算行数 |
|------|--------|---------|---------|
| 文件头 | 1-2 | 加 `@Setup` 标签 | +1 |
| 时区工具 | 19-105 | 加 `@Service`/`@Utils` 标签 | +5 |
| 配置结构体 | 106-255 | 加 `@Entity` 标签 | +5 |
| 节假日判定 | 350-379 | 加 `@Service` 标签 | +1 |
| 备份信息/操作结果 | 382-416 | 加 `@Entity` 标签 | +2 |
| 截图画廊 | 428-1001 | 加 `@Entity`/`@Utils`/`@Endpoint` 标签 | +12 |
| 配置持久化 | 1002-1113 | 加 `@Repository` 标签 | +2 |
| 开机自启 | 1115-1133 | 加 `@Setup` 标签 | +1 |
| 时区转换命令 | 1137-1216 | 加 `@Endpoint` 标签 | +4 |
| 配置命令 | 1218-1251 | 加 `@Endpoint` 标签 | +2 |
| 文件选择 | 1253-1283 | 加 `@Endpoint` 标签 | +2 |
| 备份命令 | 1362-2041 | 加 `@Endpoint` 标签（约 12 个命令） | +14 |
| 哈希计算 | 1776-1869 | 加 `@Utils`/`@Endpoint` 标签 | +4 |
| 时区套件管理 | 2043-2099 | 加 `@Endpoint` 标签 | +4 |
| 通知/窗口 | 2101-2132 | 加 `@Endpoint` 标签 | +3 |
| 日志命令 | 2134-2226 | 加 `@Endpoint` 标签 | +4 |
| 提醒系统 | 2228-2287 | 加 `@Service` 标签 | +2 |
| main()/setup | 2289-2527 | 加 `@Setup` 标签 + 区块说明 | +4 |

**注释改动总计：约 +70 行**

---

## 5. 成功标准

1. `cargo check` 通过
2. JS 语法正确（无 `import` 等模块语法）
3. 移除的日志不再出现在日志面板
4. 新增的防御性日志在对应异常路径可触发
5. 所有 `#[tauri::command]` 函数都有 `@Endpoint` 标签
6. 所有数据结构体都有 `@Entity` 标签

---

## 6. 不做的

- 不重构 main.rs 的函数签名或结构
- 不改动 main.js 的注释
- 不加新的 npm 依赖或 Rust 依赖
- 不改动 CSS/HTML
