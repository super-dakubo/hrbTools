# 提醒/横幅系统解耦重构 — 实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 将通知状态从待办数据中解耦，用 `pending_reminders` + `banners` 两个独立集合替代 `last_notified` 冷却补丁体系。

**Architecture:** Rust 端新增 `BannerEntry`/`PendingReminder` 结构体并加入 `AppConfig`，提醒线程从"扫描 todos"改为"消费 pending_reminders"。JS 端新增 `syncPendingReminders()` 生成待提醒条目，横幅从 `currentConfig.banners` 读取而非内存队列。

**Tech Stack:** Rust (Tauri 2), vanilla JS, serde_json

---

### Task 1: Rust — 新增 BannerEntry + PendingReminder 结构体

**Files:**
- Modify: `src/main.rs` (在 `ReminderConfig` struct 之后添加)

- [ ] **Step 1: 添加 BannerEntry 结构体**

在 `ReminderConfig` struct（约第 257 行）之后添加：

```rust
#[derive(Debug, Serialize, Deserialize, Clone)]
struct BannerEntry {
    id: String,
    todo_id: String,
    text: String,
    created_at: i64,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
struct PendingReminder {
    id: String,
    todo_id: String,
    text: String,
    fire_at: i64,
    sound: bool,
    #[serde(default)]
    repeat: Option<String>,
    #[serde(default)]
    workday_time: Option<String>,
    #[serde(default)]
    restday_time: Option<String>,
    #[serde(default)]
    day_mode: String,
}
```

- [ ] **Step 2: 添加字段到 AppConfig**

在 `AppConfig` struct（约第 180 行 `holiday_data` 之后）添加：

```rust
    #[serde(default)]
    banners: Vec<BannerEntry>,
    #[serde(default)]
    pending_reminders: Vec<PendingReminder>,
```

同时更新 `Default for AppConfig`：

```rust
impl Default for AppConfig {
    fn default() -> Self {
        AppConfig {
            // ... 现有字段不变 ...
            holiday_data: vec![],
            banners: vec![],           // 新增
            pending_reminders: vec![], // 新增
        }
    }
}
```

- [ ] **Step 3: 验证编译**

Run: `cd d:/code/hello_world && cargo check`
Expected: 编译通过，无 warning（新字段未使用但 `#[serde(default)]` 不会有警告）

- [ ] **Step 4: Commit**

```bash
git add src/main.rs
git commit -m "feat: add BannerEntry/PendingReminder structs to AppConfig"
```

---

### Task 2: Rust — 移除 TodoItem.last_notified + 清理 dead code

**Files:**
- Modify: `src/main.rs`

- [ ] **Step 1: 删除 `last_notified` 字段**

从 `TodoItem` struct 中删除第 238 行：

```rust
    #[serde(default)]
    last_notified: Option<i64>,  // ← 删除这一整行
```

- [ ] **Step 2: 删除 `use std::collections::HashMap`**

检查第 7 行：如果 `HashMap` 只被 `fired_cooldown` 使用，移除这个 import。否则保留。

- [ ] **Step 3: 删除 write_log 闭包中的 `fired_cooldown` 相关引用**

在提醒线程（约第 1615 行），删除：

```rust
    let mut fired_cooldown: HashMap<String, i64> = HashMap::new();  // ← 删除
```

以及所有引用 `fired_cooldown` 的代码（约第 1728-1734 行和 1876 行）。

- [ ] **Step 4: 验证编译**

Run: `cd d:/code/hello_world && cargo check`
Expected: 如果有编译错误是因为提醒线程还在引用已删除的字段，下一步修复。

- [ ] **Step 5: Commit**

```bash
git add src/main.rs
git commit -m "refactor: remove TodoItem.last_notified and fired_cooldown"
```

---

### Task 3: Rust — 重写提醒线程为 pending_reminders 消费模式

**Files:**
- Modify: `src/main.rs:1612-1885`

这是整个计划中最大的改动。替换整个 `std::thread::spawn` 闭包内容。

- [ ] **Step 1: 添加 `advance_daily_reminder` 辅助函数（在 `setup()` 之上）**

```rust
/// 计算每日提醒的下一次触发时间戳（从明天开始扫描）
fn advance_daily_reminder(
    workday_time: &Option<String>,
    restday_time: &Option<String>,
    holiday_data: &[HolidayYearConfig],
) -> Option<i64> {
    let beijing = chrono::FixedOffset::east_opt(8 * 3600).unwrap();
    let today = chrono::Local::now().date_naive();
    let mut next_day = today + chrono::Days::new(1);
    let next_holiday = holiday_data.iter().find(|h| h.year == next_day.year());
    let mut max_days = 366i32;
    loop {
        let day_type = get_day_type(&next_day, next_holiday);
        let time_str = if day_type == "workday" { workday_time } else { restday_time };
        if let Some(t) = time_str {
            if let Some((h_str, m_str)) = t.split_once(':') {
                if let (Ok(h), Ok(m)) = (h_str.parse::<u32>(), m_str.parse::<u32>()) {
                    if let Some(time) = chrono::NaiveTime::from_hms_opt(h, m, 0) {
                        let dt = chrono::NaiveDateTime::new(next_day, time);
                        return Some(beijing.from_local_datetime(&dt).unwrap().timestamp_millis());
                    }
                }
            }
        }
        next_day = next_day + chrono::Days::new(1);
        max_days -= 1;
        if max_days <= 0 { return None; }
    }
}
```

- [ ] **Step 2: 添加 `advance_monthly_reminder` 辅助函数**

```rust
fn advance_monthly_reminder(current_fire_at: i64, day_mode: &str) -> Option<i64> {
    let beijing = chrono::FixedOffset::east_opt(8 * 3600).unwrap();
    let utc_dt = chrono::DateTime::from_timestamp_millis(current_fire_at)?;
    let local_dt = utc_dt.naive_utc(); // FixedOffset 下 naive_local == naive_utc
    match day_mode {
        "last" => {
            let next = local_dt.checked_add_months(chrono::Months::new(1))?;
            let last = last_day_of_month(next.year(), next.month());
            let dt = chrono::NaiveDateTime::new(last, local_dt.time());
            Some(beijing.from_local_datetime(&dt).unwrap().timestamp_millis())
        }
        "second_last" => {
            let next = local_dt.checked_add_months(chrono::Months::new(1))?;
            let last = last_day_of_month(next.year(), next.month());
            let dt = chrono::NaiveDateTime::new(last - chrono::Days::new(1), local_dt.time());
            Some(beijing.from_local_datetime(&dt).unwrap().timestamp_millis())
        }
        "third_last" => {
            let next = local_dt.checked_add_months(chrono::Months::new(1))?;
            let last = last_day_of_month(next.year(), next.month());
            let dt = chrono::NaiveDateTime::new(last - chrono::Days::new(2), local_dt.time());
            Some(beijing.from_local_datetime(&dt).unwrap().timestamp_millis())
        }
        _ => { // "fixed"
            let next = local_dt.checked_add_months(chrono::Months::new(1))?;
            let dt = chrono::NaiveDateTime::new(next.date(), local_dt.time());
            Some(beijing.from_local_datetime(&dt).unwrap().timestamp_millis())
        }
    }
}
```

- [ ] **Step 3: 重写提醒线程核心逻辑**

将线程闭包内容（`std::thread::spawn(move || { ... })` 的内部）整体替换为：

```rust
std::thread::spawn(move || {
    let mut last_reminder_log_sec = 0i64;
    loop {
        std::thread::sleep(std::time::Duration::from_secs(5));
        let config_path = match app_handle.path().app_data_dir() {
            Ok(p) => p.join("config.json"),
            Err(_) => continue,
        };
        let json = match std::fs::read_to_string(&config_path) {
            Ok(s) => s,
            Err(_) => continue,
        };
        let mut config: AppConfig = match serde_json::from_str(&json) {
            Ok(c) => c,
            Err(_) => continue,
        };
        let now = chrono::Utc::now().timestamp_millis();
        if !config.reminder_enabled {
            let sec = now / 1000;
            if sec - last_reminder_log_sec >= 60 {
                write_log(&app_handle, "reminder_enabled = false，跳过");
                last_reminder_log_sec = sec;
            }
            continue;
        }

        let mut reminder_fired = false;
        let mut to_remove: Vec<String> = Vec::new();
        let mut to_add: Vec<PendingReminder> = Vec::new();
        let mut to_done: Vec<String> = Vec::new();

        for reminder in &config.pending_reminders {
            if reminder.fire_at > now { continue; }
            // 跳过过于陈旧的（>5min），防止长时间关机后开机批量触发
            if now - reminder.fire_at > 300_000 {
                to_remove.push(reminder.id.clone());
                continue;
            }

            // 触发通知
            let _ = notify_rust::Notification::new()
                .summary("HRB Tools")
                .body(&reminder.text)
                .show();

            // 声音
            if reminder.sound {
                let _ = std::process::Command::new("powershell")
                    .arg("-c")
                    .arg("[console]::beep(880,200)")
                    .output();
            }

            // 写入横幅
            config.banners.push(BannerEntry {
                id: reminder.id.clone(),
                todo_id: reminder.todo_id.clone(),
                text: format!("⏰ {}", reminder.text),
                created_at: now,
            });

            // 周期任务推期
            if let Some(ref repeat) = reminder.repeat {
                let today = chrono::Local::now().date_naive();
                let holiday_year = config.holiday_data.iter().find(|h| h.year == today.year());
                let today_day_type = get_day_type(&today, holiday_year);
                let next_fire = match repeat.as_str() {
                    "daily" => advance_daily_reminder(
                        &reminder.workday_time, &reminder.restday_time, &config.holiday_data),
                    "weekly" => Some(reminder.fire_at + 7 * 24 * 60 * 60 * 1000),
                    "monthly" => advance_monthly_reminder(reminder.fire_at, &reminder.day_mode),
                    _ => None,
                };
                if let Some(next_ms) = next_fire {
                    to_add.push(PendingReminder {
                        id: format!("{}_{}", reminder.todo_id, next_ms),
                        todo_id: reminder.todo_id.clone(),
                        text: reminder.text.clone(),
                        fire_at: next_ms,
                        sound: reminder.sound,
                        repeat: reminder.repeat.clone(),
                        workday_time: reminder.workday_time.clone(),
                        restday_time: reminder.restday_time.clone(),
                        day_mode: reminder.day_mode.clone(),
                    });
                }
            } else {
                // 一次性：标记待办完成
                to_done.push(reminder.todo_id.clone());
            }

            to_remove.push(reminder.id.clone());
            reminder_fired = true;

            // 显示窗口
            if let Some(w) = app_handle.get_webview_window("main") {
                let _ = w.show();
                let _ = w.unminimize();
                let _ = w.set_always_on_top(true);
                let _ = w.set_focus();
                let _ = w.set_always_on_top(false);
            }
        }

        // 批量应用变更
        config.pending_reminders.retain(|r| !to_remove.contains(&r.id));
        config.pending_reminders.extend(to_add);

        for todo_id in to_done {
            if let Some(todo) = config.todos.iter_mut().find(|t| t.id == todo_id) {
                todo.done = true;
                todo.completed_at = Some(
                    chrono::Utc::now().format("%Y-%m-%dT%H:%M:%S%.3fZ").to_string()
                );
            }
        }

        if reminder_fired {
            save_config(&app_handle, &config);
            if let Some(w) = app_handle.get_webview_window("main") {
                let _ = w.eval("try{window.__onReminderFired()}catch(e){}");
            }
        }
    }
});
```

注意：`HashMap` import 如果不再使用，删除 `use std::collections::HashMap;`（第 7 行）。

- [ ] **Step 4: 验证编译**

Run: `cd d:/code/hello_world && cargo check`
Expected: 编译通过

- [ ] **Step 5: Commit**

```bash
git add src/main.rs
git commit -m "feat: rewrite reminder thread to consume pending_reminders"
```

---

### Task 4: JS — 新增 syncPendingReminders() + calculateFireAt()

**Files:**
- Modify: `src/main.js` (在"待办工具"区块中)

- [ ] **Step 1: 添加 calculateFireAt() 辅助函数**

```js
function calculateFireAt(todo) {
    if (todo.repeat === 'daily') {
        var next = calculateNextReminderDate('daily',
            todo.reminder.workday_time,
            todo.reminder.restday_time);
        return next ? new Date(next).getTime() : null;
    }
    // weekly/monthly: 已有 reminder.datetime
    if (todo.reminder && todo.reminder.datetime) {
        return new Date(todo.reminder.datetime).getTime();
    }
    return null;
}
```

- [ ] **Step 2: 添加 syncPendingReminders() 函数**

```js
function syncPendingReminders() {
    currentConfig.pending_reminders = currentConfig.pending_reminders || [];
    var changed = false;
    (currentConfig.todos || []).forEach(function(t) {
        // 已完成/已暂停/无提醒 → 删除对应的 pending_reminder
        if (t.done || t.paused || !t.reminder) {
            var had = currentConfig.pending_reminders.some(function(r) { return r.todo_id === t.id; });
            if (had) {
                currentConfig.pending_reminders = currentConfig.pending_reminders.filter(function(r) { return r.todo_id !== t.id; });
                changed = true;
            }
            return;
        }
        // 已有未消费的 pending_reminder → 不动（"有则不建"）
        if (currentConfig.pending_reminders.some(function(r) { return r.todo_id === t.id; })) return;

        var fireAt = calculateFireAt(t);
        if (!fireAt) return;

        currentConfig.pending_reminders.push({
            id: crypto.randomUUID(),
            todo_id: t.id,
            text: t.text,
            fire_at: fireAt,
            sound: t.reminder.sound || false,
            repeat: t.repeat || null,
            workday_time: t.reminder.workday_time || null,
            restday_time: t.reminder.restday_time || null,
            day_mode: t.reminder.day_mode || '',
        });
        changed = true;
    });
    if (changed) saveConfigToBackend();
}
```

- [ ] **Step 3: 在 todo 保存流程中调用 syncPendingReminders()**

在待办编辑弹窗的 `autoSave()` 中，保存待办后调用 `syncPendingReminders()`。找到保存后的回调位置（大约在 `autoSave()` 函数最后），添加：

```js
// 在 saveConfigToBackend() 之后
syncPendingReminders();
```

- [ ] **Step 4: Commit**

```bash
git add src/main.js
git commit -m "feat: add syncPendingReminders() to manage pending reminders"
```

---

### Task 5: JS — 重写横幅系统（从 config 读取）

**Files:**
- Modify: `src/main.js`

- [ ] **Step 1: 重写 `renderBanners()` 为从 currentConfig.banners 读取**

将原有的 `__renderBanners`（约第 2318 行）替换为：

```js
function renderBanners() {
    var area = document.getElementById('bannerArea');
    if (!area) return;
    var banners = currentConfig.banners || [];
    var maxShow = 2;
    var visible = banners.slice(0, maxShow);
    var hiddenCount = banners.length - maxShow;
    area.innerHTML = '';
    if (banners.length === 0) {
        area.classList.remove('has-banners');
        return;
    }
    area.classList.add('has-banners');
    visible.forEach(function(item) {
        var row = document.createElement('div');
        row.className = 'banner-item';
        var span = document.createElement('span');
        span.textContent = item.text || '';
        row.appendChild(span);
        var btn = document.createElement('button');
        btn.className = 'banner-item-close';
        btn.innerHTML = '&times;';
        btn.addEventListener('click', function() {
            currentConfig.banners = currentConfig.banners.filter(function(b) { return b.id !== item.id; });
            saveConfigToBackend();
            renderBanners();
        });
        row.appendChild(btn);
        area.appendChild(row);
    });
    if (hiddenCount > 0) {
        var more = document.createElement('div');
        more.style.cssText = 'text-align:center;padding:4px;font-size:0.75rem;color:var(--text-secondary);';
        more.textContent = '还有 ' + hiddenCount + ' 条提醒';
        area.appendChild(more);
    }
}
```

- [ ] **Step 2: 删除旧的 `__renderBanners`、`__bannerQueue`、`__bannerIdSeq`**

找到第 2316-2358 行的初始化代码，整体删除：

```js
// 删除以下代码块：
window.__bannerQueue = [];
window.__bannerIdSeq = 0;
window.__renderBanners = function() { ... };
```

- [ ] **Step 3: Commit**

```bash
git add src/main.js
git commit -m "refactor: read banners from config instead of in-memory queue"
```

---

### Task 6: JS — 重写启动流程 + __onReminderFired + 清理旧代码

**Files:**
- Modify: `src/main.js`

- [ ] **Step 1: 重写 `__onReminderFired` 为重新拉取 config**

```js
window.__onReminderFired = function() {
    // Rust 已保存最新 config（含新 banners + 消费后的 pending_reminders）
    invoke('get_config').then(function(fresh) {
        currentConfig = fresh;
        renderBanners();
        if (currentTab === 'todo') renderTodos();
    }).catch(function(e) {
        window.__log.error('重新拉取配置失败: ' + e);
    });
};
```

- [ ] **Step 2: 替换启动流程**

将原有启动代码（约第 2377-2423 行）：

```js
// 启动前先推周期任务
advanceExpiredReminders();

// 启动时扫描过期提醒
(function() {
    var now = new Date();
    // ... ~40 行扫描代码 ...
})();
```

替换为：

```js
// 同步待提醒列表（为有提醒的待办创建 pending_reminders）
syncPendingReminders();
// 展示横幅（从 config.banners 读取）
renderBanners();
```

- [ ] **Step 3: 删除 `advanceExpiredReminders()` 函数**

删除整个函数（约第 1585-1623 行）。

- [ ] **Step 4: 删除所有 `last_notified` 引用**

在 `main.js` 中搜索 `last_notified`，删除所有相关代码行（通常在 `__onReminderFired` 旧代码和启动扫描中，已在前面步骤覆盖）。

- [ ] **Step 5: 删除旧 `window.__onReminderFired` 的内联 todo 更新逻辑**

原来的 `window.__onReminderFired`（约第 2360-2376 行）包含 `todo.done = true`、`todo.last_notified = Date.now()` 等逻辑。新版本已被 Step 1 替换，确保没有残留。

- [ ] **Step 6: Commit**

```bash
git add src/main.js
git commit -m "refactor: rewrite startup flow and __onReminderFired"
```

---

### Task 7: 全量验证

**Files:**
- N/A（验证阶段）

- [ ] **Step 1: Rust 编译检查**

Run: `cd d:/code/hello_world && cargo check`
Expected: 编译通过，无 warning

- [ ] **Step 2: 检查 JS 语法**

Run: `cd d:/code/hello_world && node -e "require('fs').readFileSync('src/main.js','utf8').split('\n').forEach((l,i)=>{try{new Function(l)}catch(e){console.log('Line '+(i+1)+': '+e.message)}})"`
或者用更简单的语法检查：在 Tauri dev 模式下加载，查看控制台有无 JS 错误。

- [ ] **Step 3: 测试提醒触发（一次性）**
   1. 创建一个待办，设置 2 分钟后的一次性提醒
   2. 等待 2 分钟
   3. 验证：通知弹出，横幅显示一条，待办自动标记完成
   4. 验证：关闭横幅后重启应用，横幅不出现，不触发新通知

- [ ] **Step 4: 测试提醒触发（每日周期）**
   1. 创建一个待办，设置每日 09:00 提醒
   2. 手动把系统时间调到 09:01（或者等两分钟）
   3. 验证：通知弹出，横幅显示
   4. 验证：下一个 poll 周期（5s 后）不重复触发

- [ ] **Step 5: 测试横幅关闭持久化**
   1. 触发一个提醒产生横幅
   2. 关闭横幅
   3. 关闭应用重启
   4. 验证：横幅不出现

- [ ] **Step 6: 测试修改待办后 pending_reminder 重建**
   1. 创建一个有提醒的待办
   2. 修改待办提醒时间
   3. 验证：旧时间不触发，新时间生效

- [ ] **Step 7: 测试长时间关机后开机**
   1. 创建一个每日提醒，设置时间在过去（已过期）
   2. 关闭应用 1 小时以上
   3. 重新打开应用
   4. 验证：不会批量弹出过期提醒通知

- [ ] **Step 8: 最终提交 + git diff 检查**

```bash
git diff src/main.rs src/main.js
```
逐行确认每处改动对应需求。确认无误后：

```bash
git add -A
git commit -m "feat: decouple notification state from todo data"
```
