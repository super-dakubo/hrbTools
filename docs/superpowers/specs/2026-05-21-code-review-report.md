# 全量代码检查报告

> 日期：2026-05-21
> 覆盖：Rust 后端 1892 行 + JS 前端 2801 行 + CSS 1947 行 + HTML 210 行
> 视角：技术（Rust / JS / CSS） + 产品经理 + 设计师

---

## 严重 Bug（需优先修复）

### B1: 恢复弹窗字段名错误

- **位置：** Rust `FileInfo` 结构体（`main.rs:364-367`）→ JS `showRestoreFileModal`（`main.js:974`）
- **问题：** `FileInfo` 有 `original_path` 字段，但 JS 恢复弹窗引用 `f.path`（不存在属性），实际值为 `undefined`
- **影响：** 多文件恢复弹窗中每个文件的路径显示为「undefined」，用户无法辨识文件来源
- **修复：** `f.path` → `f.original_path`

### B2: `open_log_folder` Linux 分支用错命令

- **位置：** `main.rs:1572-1578`
- **问题：** `#[cfg(not(target_os = "windows"))]` 分支硬编码 `"open"`（macOS 命令），Linux 应使用 `xdg-open`
- **影响：** Linux 上「打开日志目录」按钮调用失败（当前 Windows-only，未来跨平台时必现）
- **修复：** 参照 `open_folder` 方式区分 `cfg(target_os = "macos")` 和 `cfg(target_os = "linux")`

### B3: 备份失败后恢复流程继续执行

- **位置：** `main.js:916-922`
- **问题：** `handleRestore` 中 `create_backup` 失败后仅弹 alert，不 return，继续执行 `doRestoreWithFileSelect`
- **影响：** 用户收到「备份失败」后紧接着「恢复成功/失败」，流程矛盾
- **修复：** 备份失败后 `return` 阻止继续恢复

### B4: `bindTabEvents` 事件监听器堆积

- **位置：** `main.js:61-78` → `bindTabEvents()` 调用 `tabBar.addEventListener`；每次 `renderTabBar()` 都会调用 `bindTabEvents()`
- **问题：** `tabBar.addEventListener('mousedown', ...)` 和 `tabBar.addEventListener('click', ...)` 在每次 Tab 栏渲染时重复绑定。虽然 `click` 内用 `tabWasDragged` 过滤了拖拽导致的误触发，但监听器数量随渲染次数线性增长
- **影响：** 反复切换 Tab + 修改配置会累积数十个重复监听器。每个监听器执行 `e.target.closest` 判断，累积影响 mousedown/click 性能
- **修复：** 将 Tab 栏事件绑定移至 `setupEventDelegation` 一次性绑定，或使用 `{once: true}` 方案

---

## 代码脆弱性（需关注）

### W1: `_saveInProgress` 无超时兜底

- **位置：** `main.js:2240-2246`
- **问题：** `autoSave` 中 `_saveInProgress = true` 后等待 `saveConfigToBackend()` 完成，若 Promise 永远不 settle，所有后续自动保存静默跳过
- **影响：** 极端情况下用户修改待办无法保存
- **建议：** 加 5s 超时强制重置 `_saveInProgress`

### W2: 孤儿 `pending_reminder` 不清理

- **位置：** `main.js:1914-1945`
- **问题：** `syncPendingReminders` 仅在待办 done/paused/no-reminder 时移除对应 `pending_reminder`。待办被 `deleteTodo` 直接删除后，其 `pending_reminder` 留在 `config.json` 中成为孤儿
- **影响：** Rust 线程消费孤儿 reminder 时 `to_done` 操作找不到对应 todo，无副作用但浪费（每次循环读/写 config，触发 IPC eval）
- **建议：** `syncPendingReminders` 也清理待办 ID 在 `currentConfig.todos` 中已不存在的 `pending_reminder`

### W3: 时间转换面板操作无防连击

- **位置：** `main.js:367-440`
- **问题：** `reset-tz`、`to-ts`、`to-dt`、`delete-tz` 等操作直接 `await`，无 loading/disabled 状态
- **影响：** 快速重复点击可能并发 IPC
- **建议：** 对异步操作加上 `setButtonLoading` 或临时禁用

### W4: `refreshBackupList` 无执行锁

- **位置：** `main.js:831`
- **问题：** `refreshAll` 有 `_refreshLock`，但 `refreshBackupList` 本身无锁。切换游戏/存档位时可能并行两次 `list_backups`
- **建议：** `refreshBackupList` 内部加锁

---

## 设计优化

### D1: 删除备份无回收站

- **产品视角：** `remove_dir_all` 永久删除，用户点错确认后无法恢复
- **建议：** 在备份根目录下建 `.trash` 隐藏目录，删除时移入而非直接删除，保留 30 天自动清理

### D2: config.json 无自动备份

- **产品视角：** `config.json` 是唯一持久化来源，被意外删除/损坏则所有配置丢失
- **建议：** `save_config` 写入前将旧 config 备份为 `config.json.bak`；启动时检测到 `config.json` 损坏自动尝试 `.bak` 恢复

### D3: Emoji 与 SVG 图标混用

- **设计视角：** Tab 栏用 SVG 线条图标（专业），时间转换面板用 emoji（📌📋→），设置面板也用 emoji（🌓🌙☀️）
- **影响：** Win10 vs Win11 emoji 渲染差异大，视觉风格不统一
- **建议：** 统一使用内联 SVG

### D4: 节假日背景色硬编码

- **位置：** `styles.css:376-377`（暗色 `.settings-group.holiday` 用 `rgba(139, 92, 246, 0.04)`，亮色覆盖用 `0.03`）
- **建议：** 定义为 CSS 变量 `--holiday-accent` 等，新增主题时只需修变量

### D5: 加载遮罩的 `backdrop-filter` 无效

- **位置：** `styles.css:1802-1803`
- **问题：** `.loading-overlay` 在 z-index 9999 层，背景是纯色 `var(--bg)`，`backdrop-filter: blur(4px)` 无视觉效果
- **建议：** 移除这行属性

### D6: `--radius-glass` 重复定义

- **位置：** `styles.css:38` 和 `:root` 中第 54 行（间距区）
- **建议：** 删除其中一处

---

## 汇总

| ID | 类型 | 优先级 | 涉及文件 |
|----|------|--------|----------|
| B1 | Bug | **高** | main.rs:364, main.js:974 |
| B2 | Bug | **中** | main.rs:1572 |
| B3 | Bug | **高** | main.js:916 |
| B4 | Bug | **高** | main.js:61-78 |
| W1 | 脆弱 | 中 | main.js:2240 |
| W2 | 脆弱 | 低 | main.js:1914 |
| W3 | 脆弱 | 低 | main.js:367 |
| W4 | 脆弱 | 低 | main.js:831 |
| D1 | 优化 | 低 | main.rs (备份) |
| D2 | 优化 | 低 | main.rs (配置) |
| D3 | 设计 | 低 | main.js, styles.css |
| D4 | 设计 | 低 | styles.css:376 |
| D5 | 冗余 | 低 | styles.css:1802 |
| D6 | 冗余 | 低 | styles.css:38,54 |
