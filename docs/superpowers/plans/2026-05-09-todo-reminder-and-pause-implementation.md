# 待办提醒展示与暂停功能 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在待办列表中展示下次提醒时间的倒计时，并增加暂停（推迟）提醒功能

**Architecture:**
- 前端 `renderTodos()` 计算 `reminder.datetime` 与当前时间的差值，展示倒计时
- 点击倒计时文本切换 `todo.paused` 状态，暂停项不触发后端通知
- 非重复任务过期自动清除 paused，重复任务推到下一周期保持暂停

**Tech Stack:** Tauri 2.0 (Rust backend), 原生 JS 前端, CSS 变量主题

---

### Task 1: Rust — TodoItem 添加 paused 字段 + 通知线程跳过暂停项

**Files:**
- Modify: `src/main.rs`

- [ ] **Step 1: 给 TodoItem 添加 paused 字段**

在 `src/main.rs` 的 `TodoItem` 结构体（约第 196 行）中添加：

```rust
    #[serde(default)]
    paused: bool,
```

放在 `priority` 字段后、`due_date` 前，保持 `#[serde(default)]` 以保证旧配置兼容。

- [ ] **Step 2: 通知线程跳过暂停项**

在 `src/main.rs` 通知线程中（约第 1311 行），在 `if todo.done { continue; }` 后面添加：

```rust
                        if todo.paused { continue; }
```

- [ ] **Step 3: 验证编译**

```bash
cargo build
```

Expected: 编译成功，无警告。

---

### Task 2: JS — renderTodos() 添加提醒倒计时渲染

**Files:**
- Modify: `src/main.js`（仅修改 `// ==================== 待办工具 ====================` 区块）

- [ ] **Step 1: 添加计算倒计时的辅助函数**

在 `renderTodos` 函数之前（约第 1354 行附近），添加 `getReminderDisplay(todo)` 函数：

```js
function getReminderDisplay(todo) {
    if (todo.done || !todo.reminder) return '';
    var now = new Date();
    var reminderTime = new Date(todo.reminder.datetime);
    var diffMs = reminderTime - now;
    var diffMin = Math.floor(diffMs / 60000);

    // 已过期：自动清除暂停（非重复任务），返回已过期
    if (diffMs < 0) {
        if (!todo.repeat && todo.paused) {
            todo.paused = false;
            saveConfigToBackend();
        }
        return '<span class="todo-reminder overdue">⏰ 已过期</span>';
    }

    var text = '';
    if (diffMin < 1) text = '1分钟内';
    else if (diffMin < 60) text = Math.floor(diffMin) + '分钟后';
    else if (diffMin < 1440) text = Math.floor(diffMin / 60) + '小时后';
    else if (diffMin < 43200) text = Math.floor(diffMin / 1440) + '天后';
    else text = Math.floor(diffMin / 43200) + '个月后';

    var icon = todo.paused ? '⏸' : '⏰';
    var cls = todo.paused ? 'todo-reminder paused' : 'todo-reminder';
    return '<span class="' + cls + '" data-action="toggle-pause">' + icon + ' ' + text + '</span>';
}
```

- [ ] **Step 2: 在 renderTodos() 中替换 dueHtml**

在 `renderTodos()` 函数中（约第 1408 行），移除 `dueHtml` 行，添加 `reminderHtml`：

```js
        const reminderHtml = getReminderDisplay(t);
```

然后模板字符串中将 `dueHtml` 替换为 `reminderHtml`，所在行（约第 1415 行）：

```js
            + reminderHtml
```

- [ ] **Step 3: 在 bindTodoEvents() 中添加暂停切换事件**

在 `bindTodoEvents()` 函数中（约第 1453 行 return 前），添加：

```js
    todoList.querySelectorAll('[data-action="toggle-pause"]').forEach(function(el) {
        el.addEventListener('click', function(e) {
            e.stopPropagation();
            var id = this.closest('.todo-item').dataset.id;
            var todo = currentConfig.todos.find(function(t) { return t.id === id; });
            if (!todo || !todo.reminder) return;
            // 已过期状态不可切换
            var now = new Date();
            var reminderTime = new Date(todo.reminder.datetime);
            if (reminderTime <= now) return;
            todo.paused = !todo.paused;
            saveConfigToBackend();
            renderTodos();
        });
    });
```

- [ ] **Step 4: 检查是否改动了非待办区代码**

```bash
git diff src/main.js
```

确认只有 `// ==================== 待办工具 ====================` 区块（约 L1354~）内的代码被修改。

---

### Task 3: CSS — 添加提醒相关样式

**Files:**
- Modify: `src/styles.css`

- [ ] **Step 1: 添加 .todo-reminder 样式**

在 `.todo-due` 样式块附近（约第 1147 行），将 `.todo-due` 替换为 `.todo-reminder`（保留 `.todo-due` 以防其他地方引用，添加新样式不删旧样式）：

```css
.todo-reminder {
    font-size: var(--font-xs);
    color: var(--accent);
    flex-shrink: 0;
    cursor: pointer;
    user-select: none;
}

.todo-reminder:hover {
    opacity: 0.8;
}

.todo-reminder.overdue {
    color: var(--danger-text);
    cursor: default;
}

.todo-reminder.paused {
    color: var(--text-muted);
}
```

---

### Task 4: 设置中添加"启用提醒"开关

**Files:**
- Modify: `src/main.rs` — AppConfig 加 `reminder_enabled: bool`，通知线程检查该开关
- Modify: `src/index.html` — 设置弹窗添加一行开关
- Modify: `src/main.js` — 添加 DOM 引用、事件绑定、更新显示

- [ ] **Step 1: Rust — AppConfig 添加 reminder_enabled 字段**

在 `src/main.rs` 的 `AppConfig` 结构体（约第 155 行），`minimize_to_tray` 后添加：

```rust
    #[serde(default = "default_true")]
    reminder_enabled: bool,
```

添加默认值函数（在 `default_tab_order` 后）：

```rust
fn default_true() -> bool { true }
```

更新 `impl Default for AppConfig`（约第 178 行），在 `minimize_to_tray: true,` 后添加：

```rust
            reminder_enabled: true,
```

在通知线程中（约第 1309 行），`let mut changed = false;` 后添加：

```rust
                    if !config.reminder_enabled { continue; }
```

- [ ] **Step 2: HTML — 设置弹窗添加开关行**

在 `src/index.html` 约第 135 行（`最小化到托盘` 行后），添加：

```html
                    <div class="row" style="justify-content:space-between;margin-top:8px;">
                        <label style="margin:0;">启用提醒</label>
                        <button class="btn-small" id="reminderToggle" style="width:auto;">开启</button>
                    </div>
```

- [ ] **Step 3: JS — DOM 引用、事件、显示更新**

在 `src/main.js` 约第 44 行（`trayToggle` 后），添加：

```js
const reminderToggle = document.getElementById('reminderToggle');
```

在 `updateSettingsDisplay()` 函数约第 1285 行（`trayToggle` 块后），添加：

```js
    if (reminderToggle) {
        reminderToggle.textContent = currentConfig.reminder_enabled !== false ? '开启' : '关闭';
    }
```

在 `trayToggle` 事件后（约第 1241 行），添加：

```js
// 启用提醒开关
reminderToggle.addEventListener('click', async function() {
    currentConfig.reminder_enabled = currentConfig.reminder_enabled !== false ? false : true;
    await saveConfigToBackend();
    updateSettingsDisplay();
});
```

- [ ] **Step 4: 验证编译**

```bash
cargo build
```

Expected: 编译成功。

---

### Task 5: 验证构建

- [ ] **Step 1: 最终编译验证**

```bash
cargo build
```

Expected: 编译成功。

- [ ] **Step 2: 提交**

```bash
git add src/main.rs src/main.js src/styles.css
git commit -m "feat: add reminder countdown display and pause function for todo items"

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>
```
