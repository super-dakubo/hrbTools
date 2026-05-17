# 提醒线程可靠性修复 — 实现计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 消除提醒线程导致窗口频繁置顶、通知反复出现、待办弹框卡顿的三个 Bug

**架构:** 三层防护 — Rust 线程内存 HashMap 冷却（不依赖配置文件）→ 前端 save 加 await/catch 保证持久化可靠 → 窗口激活仅在窗口非焦点/非可见时执行

**Tech Stack:** Rust (Tauri 2), 原生 JS (无框架)

**涉及文件:**
- `src/main.rs` — 提醒线程 (lines ~1506-1750), 新增 import
- `src/main.js` — `__onReminderFired` (line ~2249), 横幅 X 按钮 (line ~2222)

---

### Task 1: Rust — 新增 HashMap 导入和冷却变量

**Files:**
- Modify: `src/main.rs:6` (新增 import)
- Modify: `src/main.rs:1506` (线程入口, 新增冷却 HashMap)

- [ ] **Step 1: 添加 `HashMap` 导入**

在 `src/main.rs` line 7 (`use std::fs;`) 之前或之后，添加：
```rust
use std::collections::HashMap;
```

- [ ] **Step 2: 在线程 loop 外部初始化冷却 HashMap**

找到 `std::thread::spawn(move || {` 之后、`loop {` 之前的区域（当前 line 1506-1508）：
```rust
std::thread::spawn(move || {
    let mut last_reminder_log_sec = 0i64;
    let mut fired_cooldown: HashMap<String, i64> = HashMap::new();  // ← 新增
    loop {
```

- [ ] **Step 3: 编译验证**

Run: `cargo check 2>&1`
Expected: 编译通过，无警告

---

### Task 2: Rust — 内存冷却检查 + 写入

**Files:**
- Modify: `src/main.rs:1613-1617` (60 秒防重之后加冷却检查)
- Modify: 触发后附近（line ~1624 之后）加 HashMap 写入

- [ ] **Step 1: 在 60 秒防重之后加内存冷却检查**

当前代码（line 1613-1617）：
```rust
let last = todo.last_notified.unwrap_or(0);
if now - last < 60000 {
    write_log(&app_handle, &format!("60秒防重复，跳过 '{}'", todo.text));
    continue;
}
```

之后新增（现有 60 秒防重保持不变，在后面追加）：
```rust
// 内存冷却检查：防止前端 save 失败时重复触发
const COOLDOWN_MS: i64 = 300_000;
let last_fired = fired_cooldown.get(&todo.id).copied().unwrap_or(0);
if now - last_fired < COOLDOWN_MS {
    write_log(&app_handle, &format!("内存冷却中(5min)，跳过 '{}'", todo.text));
    continue;
}
```

- [ ] **Step 2: 触发提醒后将 todo.id 写入冷却 HashMap**

在窗口 eval 完成之后（line ~1744 `write_log(&app_handle, "eval 完成");` 之后），添加：
```rust
fired_cooldown.insert(todo.id.clone(), now);
```

注意：`COOLDOWN_MS` 常量只需定义一次。放到 line 1613 附近，在 `if reminder_ts <= now {` 块之前。

- [ ] **Step 3: 编译验证**

Run: `cargo check 2>&1`
Expected: 编译通过

---

### Task 3: Rust — 窗口激活条件优化

**Files:**
- Modify: `src/main.rs:1735-1738` (窗口处理区域)

- [ ] **Step 1: 将无条件窗口操作改为条件执行**

当前代码（line 1735-1738）：
```rust
let _ = w.show();
let _ = w.unminimize();
let _ = w.set_focus();
let _ = w.request_user_attention(Some(tauri::UserAttentionType::Informational));
```

替换为：
```rust
let is_visible = w.is_visible().unwrap_or(false);
let is_focused = w.is_focused().unwrap_or(false);

if !is_visible {
    let _ = w.show();
    let _ = w.unminimize();
}
if !is_focused {
    let _ = w.set_focus();
    let _ = w.request_user_attention(Some(tauri::UserAttentionType::Informational));
}
```

- [ ] **Step 2: 编译验证**

Run: `cargo check 2>&1`
Expected: 编译通过

---

### Task 4: 前端 — `__onReminderFired` save 加 await/catch

**Files:**
- Modify: `src/main.js:2264-2286` (`__onReminderFired` 内的 `invoke('get_config').then(...)`）

- [ ] **Step 1: 将 saveConfigToBackend() 改为 await + try/catch**

当前代码（line 2265-2286）：
```javascript
invoke('get_config').then(function(fresh) {
    var todos = fresh.todos || [];
    var todo = todos.find(function(t) { return t.id === todoId; });
    if (!todo) return;
    todo.last_notified = Date.now();
    if (payload.oneTime) {
        todo.done = true;
        todo.completed_at = new Date().toISOString();
    } else {
        if (payload.nextReminderDatetime && todo.reminder) {
            todo.reminder.datetime = payload.nextReminderDatetime;
        }
        if (payload.nextDueDate) {
            todo.due_date = payload.nextDueDate;
        }
    }
    currentConfig.todos = todos;
    saveConfigToBackend();
    renderTodos();
}).catch(function() {});
```

替换为：
```javascript
invoke('get_config').then(async function(fresh) {
    var todos = fresh.todos || [];
    var todo = todos.find(function(t) { return t.id === todoId; });
    if (!todo) return;
    todo.last_notified = Date.now();
    if (payload.oneTime) {
        todo.done = true;
        todo.completed_at = new Date().toISOString();
    } else {
        if (payload.nextReminderDatetime && todo.reminder) {
            todo.reminder.datetime = payload.nextReminderDatetime;
        }
        if (payload.nextDueDate) {
            todo.due_date = payload.nextDueDate;
        }
    }
    currentConfig.todos = todos;
    try {
        await saveConfigToBackend();
    } catch (e) {
        window.__log.error('提醒持久化失败(将重试): ' + e);
        try { await saveConfigToBackend(); } catch (e2) {
            window.__log.error('提醒持久化重试也失败: ' + e2);
        }
    }
    renderTodos();
}).catch(function(e) {
    window.__log.error('get_config 失败: ' + e);
});
```

- [ ] **Step 2: 检查语法**

Run: `node --check src/main.js` 或在编辑器中检查
Expected: 无语法错误

---

### Task 5: 前端 — 横幅 X 按钮 save 加 await/catch

**Files:**
- Modify: `src/main.js:2222-2234` (横幅关闭按钮事件监听)

- [ ] **Step 1: 将 X 按钮回调改为 async + try/catch**

当前代码（line 2222-2234）：
```javascript
btn.addEventListener('click', function() {
    var idx = window.__bannerQueue.indexOf(item);
    if (idx !== -1) window.__bannerQueue.splice(idx, 1);
    window.__renderBanners();
    if (item.todoId) {
        var todo = (currentConfig.todos || []).find(function(t) { return t.id === item.todoId; });
        if (todo && todo.reminder) {
            todo.last_notified = Date.now();
            saveConfigToBackend();
        }
    }
});
```

替换为：
```javascript
btn.addEventListener('click', async function() {
    var idx = window.__bannerQueue.indexOf(item);
    if (idx !== -1) window.__bannerQueue.splice(idx, 1);
    window.__renderBanners();
    if (item.todoId) {
        var todo = (currentConfig.todos || []).find(function(t) { return t.id === item.todoId; });
        if (todo && todo.reminder) {
            todo.last_notified = Date.now();
            try {
                await saveConfigToBackend();
            } catch (e) {
                window.__log.error('横幅关闭持久化失败: ' + e);
            }
        }
    }
});
```

- [ ] **Step 2: 检查语法**

Expected: 无语法错误

---

### Task 6: 编译 + 前端语法验证

- [ ] **Step 1: 最终编译验证**

Run: `cargo check 2>&1`
Expected: 编译通过，无警告

- [ ] **Step 2: 前端语法快速检查**

用肉眼检查 main.js 修改区域的语法：确认所有 `function` 前后的括号匹配、async/await 使用正确。

- [ ] **Step 3: 提交 commit**

```bash
git add src/main.rs src/main.js docs/superpowers/specs/2026-05-16-reminder-thread-reliability-design.md docs/superpowers/plans/2026-05-16-reminder-thread-reliability.md
git commit -m "fix: 三层防护修复提醒线程可靠性

- Rust 内存 HashMap 冷却(5分钟)，配置文件破损也不重复触发
- 前端 saveConfigToBackend 加 await/catch/重试，消除静默失败
- 窗口激活仅在窗口隐藏/无焦点时执行

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>"
```

---

## Spec 覆盖自查

| Spec 章节 | 对应 Task | 状态 |
|-----------|-----------|------|
| Layer 1: Rust 内存冷却 HashMap | Task 1 + Task 2 | ✓ |
| Layer 2: 前端 save await/catch | Task 4 + Task 5 | ✓ |
| Layer 3: 窗口激活条件优化 | Task 3 | ✓ |
| 成功标准 1: 不自动置顶 | Task 2(冷却) + Task 3(条件窗口) | ✓ |
| 成功标准 2: 横幅关闭后不重现 | Task 4 + Task 5(持久化可靠) | ✓ |
| 成功标准 3: 一次性提醒自动完成 | 上一轮已实现(Task 4 保持) | ✓ |
| 成功标准 4: 待办弹框不卡顿 | Task 4(消除高频 set_config) | ✓ |
