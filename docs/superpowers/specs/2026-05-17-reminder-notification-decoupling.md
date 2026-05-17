# 提醒/横幅系统解耦重构

## 问题

当前提醒系统将**通知状态**和**待办数据**混在同一个 `TodoItem` 中管理，导致：

1. JS 和 Rust 两方争写 `config.json`，互相覆盖 `last_notified`
2. 为了防重复触发，堆了 60s 冷却 + 5min 内存冷却 + `fired_cooldown` HashMap 三层补丁
3. 启动时 JS 扫描所有待办生成横幅，Rust 线程也扫描所有待办触发通知，扫描逻辑重复
4. 任何 JS 端 `saveConfigToBackend()` 都可能擦除 Rust 线程刚刚写入的 `last_notified`

## 方案

通知状态和待办数据彻底解耦。新增两个独立集合替代冷却补丁：

```
待办修改 → 计算下次到期 → 写入 pending_reminders
                              ↓
Rust 线程消费 pending_reminders → 触发通知+声音
                              → 写入 banners（持久化横幅）
                              → 删除已消费的 pending_reminder
                              → 周期任务推期后重新入队
                              ↓
JS 读 banners 渲染横幅
用户关闭 → 从 banners 删除并持久化
```

## 数据结构

### BannerEntry（新增）

```rust
struct BannerEntry {
    id: String,        // UUID
    todo_id: String,   // 关联待办 ID
    text: String,      // 展示文本
    created_at: i64,   // 创建时间戳 ms
}
```

### PendingReminder（新增）

```rust
struct PendingReminder {
    id: String,                    // UUID，每条 pending_reminder 唯一
    todo_id: String,               // 关联待办 ID
    text: String,                  // 待办文本（展示用）
    fire_at: i64,                  // 到期时间戳 ms
    sound: bool,                   // 是否播放声音
    repeat: Option<String>,        // null/"daily"/"weekly"/"monthly"
    workday_time: Option<String>,  // daily 专用: "HH:MM"
    restday_time: Option<String>,  // daily 专用: "HH:MM"
    day_mode: String,              // monthly 专用: "fixed"/"last"
}
```

### AppConfig 变更

```rust
struct AppConfig {
    // ... 现有字段不变 ...
    banners: Vec<BannerEntry>,           // 新增
    pending_reminders: Vec<PendingReminder>,  // 新增
    // 删除: TodoItem.last_notified
}
```

## 流程

### 创建/修改待办

1. 用户设置提醒 → JS 计算首次 `fire_at`
2. 删除该待办已有的 `pending_reminder`（如有）
3. 创建新的 `PendingReminder`，写入 `currentConfig`
4. `saveConfigToBackend()`

### Rust 提醒线程（改造后）

```
loop {
    sleep(5s);
    config = load_config();
    if !config.reminder_enabled { continue; }

    for each pending_reminder in config.pending_reminders {
        if pending_reminder.fire_at > now { continue; }

        // 跳过过于陈旧的（>5min），防止长时间关机后开机批量触发
        if now - pending_reminder.fire_at > 300_000 { continue; }

        // 触发通知
        notify_rust::show(pending_reminder.text);

        // 声音
        if sound { beep() }

        // 写入横幅
        config.banners.push(BannerEntry { ... });

        // 周期任务推期
        if repeat {
            next_fire_at = calculate_next(pending_reminder);
            config.pending_reminders.push(PendingReminder { fire_at: next_fire_at, ... });
        }

        // 一次性任务标记完成
        if !repeat {
            find todo by todo_id, mark done;
        }

        // 标记本条 pending_reminder 已消费（删除）
        remove from pending_reminders;
        reminder_fired = true;
    }

    if reminder_fired {
        save_config();
        // 先保存再 eval，确保文件是最新状态
        eval("window.__onReminderFired()");
    }
}
```

### 横幅展示

1. JS 从 `currentConfig.banners` 读取横幅列表
2. 渲染到横幅区域
3. 用户点击关闭 → 从 `currentConfig.banners` 删除 → `saveConfigToBackend()`

### 启动流程

1. `loadConfig()` → `currentConfig` 包含 `banners`（如果有未关闭的横幅）
2. `renderBanners()` — 直接读 `currentConfig.banners`，不扫待办
3. `syncPendingReminders()` — 为有提醒的待办补充缺失的 `pending_reminder`

## 关键设计决策

### 有则不建（防重入）

`syncPendingReminders()` 检查每个待办是否已有对应 `pending_reminder`，存在则跳过。只有缺失时才创建。这防止了 JS 重复创建已被 Rust 消费的条目。

### Rust 先存盘再 eval

Rust 线程修改配置后，先 `save_config()` 再 `eval()` JS。确保 JS 通过 `invoke('get_config')` 读取时文件已是最新状态。

### 5 分钟陈旧跳过

长时间关机后开机，`pending_reminder` 可能指向过去的某个时间。Rust 线程跳过 `now - fire_at > 5min` 的条目，避免开机时批量触发过期提醒。对于周期任务，`syncPendingReminders()` 启动时重新计算当日时间。

## 删除的代码

| 模块 | 行数 | 说明 |
|------|------|------|
| `TodoItem.last_notified` + `#[serde(default)]` | ~5 | 防重复补丁 |
| Rust `fired_cooldown` HashMap | ~10 | 5 分钟内存冷却 |
| 60s `last_notified` 冷却检查 | ~5 | 文件级冷却 |
| JS `advanceExpiredReminders()` | ~40 | 两方分别推期 |
| JS 启动横幅扫描（扫 todos 生成横幅） | ~40 | 改为读 banners |
| `__onReminderFired` 内联更新逻辑 | ~15 | 改为重新拉取 config |
| 合计删除 | ~115 | |

## 验证标准

1. 创建 09:00 每日提醒 → 到时触发一次，不重复
2. 重启应用 → 未关闭的横幅保留，不重新触发通知
3. 修改待办提醒时间 → 旧时间不触发，新时间生效
4. 关机 5 小时后开机 → 不会批量触发过期提醒
5. 一次性提醒到期 → 触发一次，待办自动标记完成，不再触发

## 后续优化（本次不改）

- PowerShell beep → Win32 `Beep()` API（需加 `windows` crate）
- `BackupInfo.created_at` 死字段清理
