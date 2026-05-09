# 待办工具 — 设计文档

## 概述

为 HRB Tools 新增第三个功能面板「待办工具」，并支持左侧 Tab 栏拖拽排序、定时提醒、开机自启、最小化到系统托盘等功能。

## 1. Tab 栏排序

### 1.1 字段

`AppConfig` 新增 `tab_order: Vec<String>`，默认值 `["convert", "backup", "todo"]`。

Tab ID 映射：

| ID | 面板 | 说明 |
|----|------|------|
| `convert` | 时间转换 | 现有 |
| `backup` | 存档管理 | 现有 |
| `todo` | 待办工具 | 新增 |

### 1.2 渲染规则

- Tab 栏按 `tab_order` 顺序渲染按钮
- `tab_order[0]` 对应的面板默认激活
- 若 `tab_order` 缺失或内容不完整，用默认值补全
- Tab 切换逻辑不变：`data-tab` → `#panel-{id}`

### 1.3 拖拽交互

- 使用 HTML5 Drag & Drop API
- `dragstart` 记录拖动源索引
- `dragover` 显示插入位置指示线
- `drop` 更新 DOM 顺序 + 保存新 `tab_order` 到 config
- 拖拽手柄为 Tab 按钮本身（全区域可拖）

### 1.4 兼容

- `index.html` 中 Tab 栏改为动态渲染，不再硬编码
- 旧 config 无 `tab_order` 时自动初始化默认值

## 2. 数据模型

### 2.1 AppConfig 新增字段

```rust
pub struct AppConfig {
    // 现有字段...
    pub tab_order: Vec<String>,
    pub todos: Vec<TodoItem>,
    pub auto_start: bool,
    pub minimize_to_tray: bool,
}
```

### 2.2 TodoItem

```rust
pub struct TodoItem {
    pub id: String,                    // UUID，不可变
    pub text: String,                  // 待办内容
    pub done: bool,                    // 完成状态
    pub priority: i32,                 // 0=低 1=中 2=高
    pub due_date: Option<String>,      // 到期日 "YYYY-MM-DD"
    pub tags: Vec<String>,             // 自由标签
    pub notes: String,                 // 备注
    pub reminder: Option<ReminderConfig>,  // 可选提醒
    pub repeat: Option<String>,        // null/"daily"/"weekly"/"monthly"
    pub sort_order: i32,               // 手动排序序号
    pub created_at: String,            // "YYYY-MM-DDTHH:mm"
    pub last_notified: Option<i64>,    // 上次通知时间戳(ms)，防重复
}

pub struct ReminderConfig {
    pub datetime: String,  // "YYYY-MM-DDTHH:mm"
    pub sound: bool,
}
```

### 2.3 存储

- 所有数据存入 `config.json`（与现有配置同一文件）
- 前端读取 `currentConfig.todos` 操作
- 每次变更后调用 `set_config` 保存

## 3. 待办前端面板

### 3.1 HTML

新增 `#panel-todo`，与现有面板同级。结构：

```
┌─ 搜索/筛选栏 ─────────────────────────────┐
│  [🔍 搜索...] [全部 ▼] [优先级 ▼]           │
├─ 统计栏 ──────────────────────────────────┤
│  全部 12    待完成 8    已完成 4             │
├─ 待办列表 ─────────────────────────────────┤
│  ⠿ ○ 高 买牛奶          📅05-15 [购物][家] │
│  ⠿ ✓ ~~提交报告~~       📅05-08 [工作]    │
│  ...                                       │
├─ 快捷添加 ─────────────────────────────────┤
│  [+ 添加待办，回车创建...]                   │
└────────────────────────────────────────────┘
```

### 3.2 功能

| 功能 | 实现 |
|------|------|
| 添加 | 底部输入框回车创建，自动获得焦点 |
| 编辑 | 点击文字 inline 编辑；弹窗编辑完整字段 |
| 完成切换 | 点击圆圈切换 done |
| 删除 | 行末 ✕ 删除（带确认） |
| 拖拽排序 | 拖拽手柄（⠿） |
| 搜索 | 实时过滤匹配文字/标签 |
| 筛选 | 状态（全部/待完成/已完成）+ 优先级下拉 |

### 3.3 编辑弹窗

模态弹窗，包含：
- 内容文本（必填）
- 优先级：三选一按钮（低/中/高）
- 到期日：日期选择
- 标签：逗号分隔输入
- 备注：多行文本框
- 提醒：日期时间选择 + 声音开关
- 重复：下拉选择（不重复/每天/每周/每月）

### 3.4 main.js 隔离

新增的待办面板代码放在 `// ==================== 待办工具 ====================` 区块中，与时间转换、存档管理互不干扰。

## 4. 定时提醒

### 4.1 依赖

新增 `notify-rust = "4"` crate。

### 4.2 后台线程

在 `main.rs` 的 `setup()` 中启动 `std::thread::spawn` 循环：

```
每秒 tick:
  读取 config.json
  遍历 todos:
    条件: reminder ≠ null && done = false && reminder.datetime ≤ now && not notified
    动作:
      发 notify-rust Toast 通知（标题 = 应用名，正文 = todo.text）
      更新 last_notified = now
      若 repeat ≠ null:
        daily → +1 天
        weekly → +7 天
        monthly → +1 月
        更新 reminder.datetime 和 due_date
  写回 config.json
```

### 4.3 重复任务

提醒触发时才自动推至下一周期（更新 `reminder.datetime` 和 `due_date`）。手动完成待办不触发重复创建，此功能后续实现。

### 4.4 防重复

- `last_notified` 标记已通知时间
- 同一提醒在同一分钟不会重复通知
- 应用重启后只检查将来时间，不补发

### 4.4 Rust 命令

新增 `send_notification` 命令供前端手动触发测试。

## 5. 开机自启

### 5.1 方案

- `AppConfig.auto_start: bool`，默认 `false`
- 通过 Windows 注册表实现：`HKEY_CURRENT_USER\Software\Microsoft\Windows\CurrentVersion\Run`
- 零额外 Rust 依赖（直接用 `std::process::Command` 调用 `reg` 或直接写注册表）
- 设置弹窗加开关

### 5.2 逻辑

| 事件 | 操作 |
|------|------|
| 应用启动 | 读取 `auto_start`，若 true 则写入注册表（确保路径正确） |
| 用户在设置中开启 | 写入注册表 + 更新 config |
| 用户在设置中关闭 | 删除注册表项 + 更新 config |

## 6. 最小化到系统托盘

### 6.1 方案

- 使用 Tauri 2.0 内置 `TrayIconBuilder`
- `AppConfig.minimize_to_tray: bool`，默认 `true`

### 6.2 交互

| 操作 | 行为 |
|------|------|
| 点击 ✕（关闭） | `app.exit()` 完全退出，结束所有进程 |
| 点击 ─（最小化） | `window.hide()` + 显示托盘图标 |
| 点击托盘图标 | `window.show()` + 隐藏托盘图标 |
| 右键托盘菜单 | 弹出 [显示, 退出] |

### 6.3 实现

- `window_close` 命令改为 `app.exit()`
- `window_minimize` 命令改为 `window.hide()` + 创建托盘
- `main.rs` 中创建 `TrayIconBuilder`，设置图标和菜单

## 7. 修改文件清单

| 文件 | 改动 |
|------|------|
| `Cargo.toml` | 新增 `notify-rust = "4"` |
| `src/main.rs` | AppConfig 加字段、TodoItem 结构体、提醒后台线程、托盘、开机自启、send_notification 命令 |
| `src/index.html` | 新增 `#panel-todo`、Tab 栏改为动态渲染 |
| `src/main.js` | 新增待办面板区块、Tab 动态渲染、拖拽排序 |
| `src/styles.css` | 新增待办相关样式 |

## 8. 未实现（后续考虑）

- 体积优化（UPX、profile 调优等）
- 重复任务完成时自动创建下一周期
- 标签管理视图（按标签聚合）
