# 性能优化与本地日志系统设计

## 概述

解决 Tauri 生产构建（`cargo tauri build`）面板切换卡顿问题，并建立本地日志系统用于后续问题诊断。

## 问题分析

### 症状

- 面板切换时界面冻结数秒，但 `performance.now()` 测得的 JS 执行时间极低（<10ms）
- 启动工具时也有明显卡顿
- `cargo tauri dev` 运行流畅，仅生产构建卡顿

### 根因

JS 执行快但 UI 卡，意味着瓶颈不在 JS 代码，而在**渲染管线**的下游阶段（布局→绘制→合成）：

```
JS 执行（微秒级） → 样式重算 → 布局（秒级卡住） → 绘制 → 合成
```

导致这一现象的 3 个因素叠加：

1. **`display: none ↔ block` 切换** — 当前面板切换使用 `display:none` 隐藏非活跃面板，
   这会将其完全移出布局树。切回时浏览器需要对整个面板的 DOM 树做**全量布局计算**。

2. **`tauri://` 协议 vs HTTP dev server** — 生产环境使用 `tauri://` 协议加载前端资源，
   渲染引擎行为可能与 dev 模式的 HTTP server 有所不同（如无缓存头、跨域沙箱策略差异）。

3. **CSS transitions 集体触发** — 面板内大量元素在切回时同时触发 CSS transitions，
   造成绘制风暴（paint storm）。

## 第 1 节：渲染优化

### 前提条件

需要在样式文件中为 `.content` 添加 `position: relative`，使其成为绝对定位面板的参考容器：

```css
.content {
    flex: 1;
    padding: 20px 24px;
    overflow-y: auto;
    min-width: 0;
    position: relative;  /* 新增 */
}
```

`.body-area` 无需改动（`display: flex` 布局不变）。

### 面板切换策略变更

**当前方式（有性能问题）：**

```css
.panel { display: none; }
.panel.active { display: block; }
```

`display:none` 将元素完全排除在布局树外。切换时浏览器必须：
- 对刚隐藏的 panel B 执行完整布局→绘制→合成
- 对刚显示的 panel A 执行完整布局→绘制→合成
- 两者都不在合成层缓存中，必须从头计算

**新方式：**

```css
.panel {
    display: block;
    position: absolute;
    top: 0;
    left: 0;
    right: 0;
    bottom: 0;
    opacity: 0;
    pointer-events: none;
    visibility: hidden;
    /* 提示浏览器创建独立合成层 */
    will-change: opacity;
}
.panel.active {
    opacity: 1;
    pointer-events: auto;
    visibility: visible;
}
```

**原理：**
- 所有面板**始终保留在布局树中**，初始加载时只计算一次布局
- 切换时仅改变 `opacity` 和 `pointer-events`，**只触发合成层变化**
- `will-change: opacity` 提示浏览器创建独立合成层，由 GPU 处理变化
- `visibility: hidden` + `pointer-events: none` 确保隐藏面板不可交互且不可访问

### 启动优化

在 `DOMContentLoaded` 之后用 `requestAnimationFrame` 分步初始化，避免阻塞首帧：

```js
// 初始化顺序渲染
requestAnimationFrame(() => {
    renderTabs();
    requestAnimationFrame(() => {
        renderTimezones();
        requestAnimationFrame(() => {
            // 延迟加载非活跃面板的初始数据
            // 待办面板、备份面板的数据在首次切到时才加载
        });
    });
});
```

### 计时优化

使用双重 `requestAnimationFrame` 捕获真实渲染完成时间：

```js
function measureRender(callback) {
    const t0 = performance.now();
    // ... 执行 DOM 操作 ...
    requestAnimationFrame(() => {
        // 第一帧：布局/样式计算完成
        requestAnimationFrame(() => {
            // 第二帧：绘制完成
            const renderEnd = performance.now();
        });
    });
}
```

## 第 2 节：本地日志系统

### 整体架构

```
┌──────────────────────────┐
│   前端环形缓冲区           │
│   window.__log.buffer     │
│   容量 2000 条            │
│   O(1) 写入，无 GC 压力    │
└───────────┬──────────────┘
            │ 每 10 秒或满 100 条自动 flush
            ▼
┌──────────────────────────┐
│   Tauri IPC: log_write()  │
│   接收 string[] 批量写入   │
└───────────┬──────────────┘
            │
            ▼
┌──────────────────────────┐
│   日志文件                 │
│   %APPDATA%/com.hrbTools  │
│   .app/logs/YYYY-MM-DD.log│
│   10MB 轮转               │
└──────────────────────────┘
```

### 前端 Logger API

全部挂在 `window.__log` 上，无 `import` 语法：

```js
window.__log = {
    buffer: [],             // 环形缓冲区 [{time, level, source, message, data?}]
    maxEntries: 2000,       // 最大条数
    minLevel: 0,            // 可动态调整的日志级别阈值

    // 日志方法
    debug(source, message, data?),
    info(source, message, data?),
    perf(source, message, data?),
    warn(source, message, data?),
    error(source, message, data?),

    // 管理方法
    flush(),              // 批量写入文件
    setLevel(level),      // 动态调整级别
    getEntries(filters?), // 返回过滤后的条目（日志面板使用）
    clear(),              // 清空缓冲区
    export(),              // 导出为文本
};
```

### 日志级别

| 级别 | 值 | 用途 |
|------|-----|------|
| DEBUG | 0 | 变量值、渲染细节（默认不启用） |
| INFO | 1 | 用户操作：增删改待办、备份、设置变更 |
| PERF | 2 | 性能数据：面板切换耗时、IPC 耗时、渲染耗时 |
| WARN | 3 | 恢复性操作：重算哈希、配置值回退 |
| ERROR | 4 | IPC 失败、配置读写异常 |

默认 threshold = INFO（只记录 INFO 及以上级别），需要时可动态调低。

### 日志面板 UI

**位置：** 第四个 Tab（待办工具栏后面），不改变现有三个面板的代码

**功能：**

- 搜索框：按消息全文搜索
- 级别过滤器：ALL / ERROR / WARN / PERF / INFO / DEBUG
- 来源过滤器：（可选）按来源模块筛选
- 导出按钮：将当前过滤后的日志下载为文本文件（通过 Rust 命令保存到桌面）
- 日志列表：
  - 反向列表（最新在顶部）
  - 列：时间戳（HH:mm:ss.SSS）| 级别标签（带颜色）| 来源 | 消息
  - 最多显示 500 条，超过时显示"显示最近 500 条，共 N 条"
  - 行数限制：每条消息最多显示 2 行（超出可展开）
  - 级别颜色：ERROR 红、WARN 黄、PERF 蓝、INFO 白、DEBUG 灰

**性能保障：**
- 仅在切到日志面板时渲染 `#panel-log`
- 使用 `innerHTML` 一次更新（避免逐个 DOM 插入）
- 日志面板自身操作也通过 `__log` 系统记录（日志溯源）

### 文件日志

**路径：** `%APPDATA%/com.hrbTools.app/logs/YYYY-MM-DD.log`

**格式（纯文本，方便直接查看）：**
```
[2026-05-10 14:30:22.123][INFO ][Todo ] 新增待办: 买菜
[2026-05-10 14:30:25.456][PERF ][TabSwitch] 切换到 todo DOM:2.1ms render:184.3ms
[2026-05-10 14:30:28.789][ERROR][Backup] list_backups 调用失败: 连接超时
```

**文件管理：**
- 每天一个文件，文件名日期自动
- 文件达到 ~10MB 自动轮转：`.log` → `.1.log`，`.1.log` → `.2.log`，删除最旧的
- 用户可手动删除日志目录

## 第 3 节：后端命令

### 新增 Rust 命令

```rust
#[tauri::command]
fn log_write(app_handle: tauri::AppHandle, lines: Vec<String>) -> Result<(), String> {
    // 1. 获取 app_handle.path().app_log_dir() 或手动拼接 %APPDATA% 路径
    // 2. 按当天日期构造文件名
    // 3. 追加写入所有行（一次打开，写入，关闭）
    // 4. 检查文件大小，超过限制则轮转
}
```

**设计要点：**
- 每次调用只打开一次文件、写入、关闭，避免文件锁
- 写入在主线程？→ 目前 Tauri 命令默认在主线程执行，但写操作用 `std::fs::OpenOptions` 本身是同步的，
  对 10-50 行的批量写入耗时在微秒级，不会影响 UI。
  如果后续观察到写入阻塞，可改用 `tokio::spawn_blocking` 放到后台线程。
- 文件锁：同一时刻只有一个进程写入，无竞态问题
- 日志目录首次写入时自动创建

## 第 4 节：现有代码改动范围

### main.js

| 区块 | 改动内容 |
|------|----------|
| 末尾（新区块） | 追加 `// === 日志系统 ===` 区块，定义 `window.__log` |
| `switchTab` | 改为绝对定位切换逻辑 + 追加 PERF 日志 |
| 渲染相关 | 调整为分步初始化 |
| `addTodo` | 追加 INFO 日志 |
| `toggleTodoDone` | 追加 INFO 日志 |
| `deleteTodo` | 追加 INFO 日志 |
| `saveBackup` / `refreshAll` | 追加 INFO + PERF 日志 |

### index.html

| 位置 | 改动内容 |
|------|----------|
| Tab 栏 | 新增日志 Tab（放在待办后面） |
| panels | 新增 `#panel-log` 面板（跟在待办面板后面） |

### styles.css

| 位置 | 改动内容 |
|------|----------|
| `.panel` / `.panel.active` | 改为 `position:absolute` + `opacity` 方案 |
| body | 可能需加 `position:relative` 确保 `.panel` 的绝对定位正确 |
| 日志面板样式 | 新增 `.log-toolbar`、`.log-entries`、`.log-entry` 等 |

### main.rs

| 位置 | 改动内容 |
|------|----------|
| 新区块 | 新增 `// === 日志命令 ===`，定义 `log_write` 命令 |
| `main()` 的 `.invoke_handler()` | 注册 `log_write` |

### 不动的文件

- `tauri.conf.json` — 不需要配置变更
- 时间转换面板相关 JS/CSS — 仅开关 `display:block` 逻辑受影响，CSS 新方案全覆盖
- Rust 后台线程（config 心跳、提醒检查）— 不动

## 第 5 节：验证方案

1. 构建生产版本（`cargo tauri build`）
2. 测试面板切换不再卡顿
3. 检查日志面板：切换三次面板，应看到三条 PERF 级别日志
4. 检查文件日志：`%APPDATA%/com.hrbTools.app/logs/` 下应有今天的日志文件
5. 测试日志导出功能
6. 回归测试所有现有功能正常运行
