# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

> **修改代码前必须先读 [LESSONS.md](C:\Users\PC_WIN10.claude\docs\LESSONS.md)** — 本项目反复踩过的坑。
> **集成外部 API 前必须读 LESSONS.md「外部 API 集成」章节** — 先写 Spike 验证可行性，不猜 API 行为。
> **UI/样式修改前必须阅读 [docs/design-system.md](./docs/design-system.md)** — 颜色令牌、排版、组件标准、主题规则。
> **处理特定功能时先查 [docs/ARCHITECTURE.md](./docs/ARCHITECTURE.md) 对应章节** — 数据结构、命令列表、持久化、DST、备份、窗口等详细参考。
>
> **项目 skill 位于 `.claude/skills/`** — 通过 `/skill-name` 或 Skill 工具调用：
>
> - `panel-isolation` — 修改 JS 面板时遵守面板隔离
> - `backup-operations` — 备份系统操作规范
> - `tauri-command-pattern` — 添加新 Tauri 命令
> - `id-based-entities` — 添加可改名实体时用 ID 关联
>
> **多子代理审查系统**位于 `.claude/workflows/review-entry` — 用 Workflow 工具执行。增量审查：直接运行。全量审计：传 `{"mode": "audit"}` 参数。
>
> **自动记忆系统**位于 `C:\Users\PC_WIN10\.claude\projects\d--code-hello-world\memory\` — 跨会话持久化。

## 常用命令

- `cargo tauri dev` – 启动 Tauri 开发
- `cargo tauri build` – 生产构建
- `cargo check` – 快速检查 Rust 编译错误
- `cargo build` – 仅编译 Rust 后端
- `cargo test` – 运行 40+ 单元测试（覆盖时区/节假日/哈希/路径校验/图片检测）
- `gh release create v0.1.0 target/release/bundle/nsis/*.exe target/release/bundle/msi/*.msi` – 发布新版本
- `taskkill /im tauri_dev.exe /f` – 强制终止 dev 进程（开发时常用）
- Workflow `scriptPath=".claude/workflows/review-entry"` – 运行多子代理增量审查
- Workflow `scriptPath=".claude/workflows/review-entry"` + `args={"mode":"audit"}` – 全量审计

## 架构概述

Tauri 2.0 桌面应用（**仅 Windows**），无 npm/打包器，纯原生 HTML/CSS/JS + Rust 后端。

**无边框窗口**（`decorations: false`），自定义标题栏，左侧 Tab 栏（支持鼠标拖拽排序）。面板切换必须用 `position: absolute` + `opacity` 合成层，禁止 `display: none/block`。

**根字号：** `html { font-size: 18px }`（默认 16px），所有 `rem` 值以此基准缩放。

### 源文件一览

| 文件                                   | 说明                                                                                             |
| -------------------------------------- | ------------------------------------------------------------------------------------------------ |
| [src/index.html](src/index.html)       | HTML 骨架，6 面板 DOM + 10 个有序 `<script>` 加载                                                |
| [src/css/](src/css/)                   | CSS 变量主题 + 布局 + 组件 + 面板样式（4 文件）                                                  |
| [src/core.js](src/core.js)             | 前端基础设施：状态、DOM 引用、Tab 栏、配置管理、工具函数                                         |
| [src/init.js](src/init.js)             | `DOMContentLoaded` 分步启动                                                                      |
| [src/js/](src/js/)                     | 面板 JS（8 文件）：convert/backup/todo/notifications/screenshot/log/settings + event-delegation  |
| [src/main.rs](src/main.rs)             | Rust 入口：main()、setup、提醒线程、窗口命令、时区命令                                           |
| [src/app_config.rs](src/app_config.rs) | 全部 `AppConfig` 数据结构 + 默认值                                                               |
| [src/cmd/](src/cmd/)                   | Tauri 命令模块（7 文件）：backup、hash、screenshot、time_convert、file_dialog、notification、log |
| [src/svc/](src/svc/)                   | 业务逻辑模块（3 文件）：tz（时区/DST）、config_io（持久化）、holiday（节假日判定）               |
| [icons/](icons/)                       | App/托盘图标。重构时运行 `python tools/gen_icon.py`                                              |
| [tools/gen_icon.py](tools/gen_icon.py) | 纯 Python 图标生成脚本（stdlib 无依赖）                                                          |

### AppConfig 持久化

读写配置必须用 `load_config(&app)`/`save_config(&app, &config)`，禁止直接操作文件。前端内存副本 `currentConfig` 修改后必须调 `saveConfigToBackend()` 持久化。

**`saveConfigToBackend()` 防重叠锁：** `_saveInProgress` + `_pendingSave` 双重锁。正在保存时后续调用标记待刷新，当前保存完成后再 flush。修改此逻辑时保持此保护。

**`set_auto_start` 条件执行：** `set_config` 中**仅当 `auto_start` 值实际变化时才 spawn `reg.exe`**。reg.exe 约 3.3s，不要在任何读路径或保存路径中无条件调用。

**配置备份：** `save_config` 在写入 config.json 前自动复制 `config.json → config.json.bak`（写入前备份）。备份失败仅 `log_error`，不阻塞写入。

### 前端架构

**事件委托模式：** 所有子元素事件绑定在 `event-delegation.js` 的 `setupEventDelegation()` 中一站式完成，用 `e.target.closest('[data-action]')` 匹配。禁止在渲染函数中绑定事件或加单独的 `addEventListener`。

**日志流水线：** `window.__log`（环形缓冲区 2000 条）→ IPC `log_write` → `%APPDATA%/com.hrbTools.app/logs/YYYY-MM-DD.log`（10MB 自动轮转）。写全部级别到文件，每 10 秒或满 100 条自动 flush；INFO 及以上输出控制台。

### 后端模块分层

```text
main.rs ← 入口 + setup + 提醒线程 + 窗口/时区命令
  ├── svc/ (业务逻辑)
  │   ├── tz.rs        — 时区解析、DST 日期计算
  │   ├── config_io.rs — config.json 读写、日志写入、开机自启
  │   └── holiday.rs   — 节假日判定（补班优先→假期段→周末）
  └── cmd/ (Tauri 命令)
      ├── backup.rs      — 备份 CRUD + 路径安全校验
      ├── hash.rs        — MD5 文件/目录哈希
      ├── screenshot.rs  — 截图扫描 + LRU 缓存 + VDF 解析
      ├── time_convert.rs— 时间↔时间戳双向转换
      ├── file_dialog.rs — 文件/文件夹选择器
      ├── notification.rs— 系统通知
      └── log.rs         — 日志写入/读取/目录打开
```

- `tauri::command` 参数名必须用 **camelCase**，结构体字段必须用 **snake_case**
- 写操作返回 `OpResult { success, message }`
- 新增命令：在 `cmd/` 下创建文件 → 注册 `cmd/mod.rs` → 加入 `generate_handler!`
- `sanitize_path_component()` — 所有用 `game_id`/`slot_id`/`folder_name` 构建路径的命令必须先调用
- 架构标签（`@Endpoint`/`@Service`/`@Entity`/`@Setup`/`@Repository`/`@Utils`）用于 Grep 快速定位

### 约束

- **禁止 `import` / `<script type="module">`** — 用 `window.__TAURI_INTERNALS__.invoke(cmd, args)` 代替
- **实体用 ID 关联** — 可改名实体用 UUID，目录路径/引用一律用 ID
- **无 `devUrl`** — 配了会导致 `cargo tauri dev` 卡住
- **无 `console.log` 调试** — 用 `window.__log.info/perf/warn/error()`
- **`load_*`/`get_*` 禁止有副作用** — 不能在里面执行写操作或系统命令
- **JS 文件顺序** — `core.js` → 各 `js/panel-*.js` → `js/event-delegation.js` → `init.js`，依赖全局作用域，不可变顺序

### 性能约束（Tab 切换）

1. **`switchTab` 必须有执行锁** — `_switchLock` 在双重 rAF 后才释放，5 秒超时兜底
2. **`will-change: opacity` 只能加在 `.panel.active`** — 禁止常驻 GPU 合成层
3. **`escapeHtml` 必须用纯字符串替换** — 禁止 DOM 版，避免 GC 暂停
4. **Tab click handler 必须有 300ms 防抖**

### 备份目录结构

```text
{backup_root}/{game_id}/{slot_id}/{timestamp_folder_name}/
├── meta.json    ← files 映射、hash、display_name
├── save.dat     ← 源文件（1 到 N 个）
└── ...
```

### 节假日系统

JS `getDayType()` 与 Rust `get_day_type()` **各自独立实现**（补班优先 → 假期段 → 周末），修改必须同步两端。提醒架构：JS 产 `pending_reminders` → Rust 线程每 5s 消费 → 推 `BannerEntry` 到 config → JS 渲染横幅。详情见 ARCHITECTURE.md。

### 主题

暗色值写 `:root`，亮色覆盖写 `body.light`。主题切换用 `applyTheme()`。**禁止硬编码色值**。`--holiday-accent`（139, 92, 246）用于节假日相关元素。

### 依赖

`tauri = "2"`（tray-icon）、`serde`（derive）、`serde_json`、`chrono`（serde）、`rfd = "0.17"`、`md-5 = "0.10"`、`notify-rust = "4"`、`base64 = "0.22"`。**Rust edition `= "2024"`**。

### 窗口

960×720 不可缩放，无边框，默认隐藏。启动检查 `--minimized`：有则保持隐藏（开机自启），无则 `window.show()`。最小化到托盘，关闭完全退出。
