# 周期提醒 UI 改造 — 实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 根据重复类型展示不同的提醒时间输入控件（每天→仅时间、每周→星期+时间、每月→日号+时间），支持月末特殊选项

**Architecture:** Rust 后端仅 `ReminderConfig` 加 `day_mode` 字段 + monthly push 逻辑分支；JS 前端动 `openTodoEditModal` 的模板和保存逻辑，新增 `calculateNextReminder` 函数族

**Tech Stack:** Tauri 2.0, Rust (chrono), 原生 JS

---

## 文件改动一览

| 文件 | 改动类型 | 说明 |
|------|---------|------|
| `src/main.rs` | 修改 | `ReminderConfig` 加 `day_mode` 字段、新增 `last_day_of_month()` 函数、修改 monthly push 逻辑 |
| `src/main.js` | 修改 | `openTodoEditModal` 模板 + 保存逻辑、新增 `calculateNextReminder()` 函数族 |
| `src/styles.css` | 可能微调 | 若下拉框+time 输入并排显示需要间距调整 |

---

### Task 1: Rust — 添加 day_mode 字段和 last_day_of_month 辅助函数

**Files:**
- Modify: `src/main.rs:236-241` (ReminderConfig)

- [ ] **Step 1: 给 ReminderConfig 加 day_mode 字段**

```rust
#[derive(Debug, Serialize, Deserialize, Clone)]
struct ReminderConfig {
    #[serde(default)]
    datetime: String,
    #[serde(default)]
    sound: bool,
    #[serde(default)]
    day_mode: String,   // "fixed" | "last" | "second_last" | "third_last"，仅 monthly 有效
}
```

`#[serde(default)]` 保证旧数据无此字段时默认 `""`，等价于 `"fixed"`。

- [ ] **Step 2: 新增 last_day_of_month 函数**

放在 `last_sunday_of_month` 函数（line 60-65）附近：

```rust
/// 计算某月的最后一天
fn last_day_of_month(year: i32, month: u32) -> chrono::NaiveDate {
    let (next_y, next_m) = if month == 12 { (year + 1, 1) } else { (year, month + 1) };
    chrono::NaiveDate::from_ymd_opt(next_y, next_m, 1).unwrap().pred_opt().unwrap()
}
```

- [ ] **Step 3: 修改 monthly push 逻辑**

替换 `src/main.rs:1448-1453` 处的 `match repeat.as_str()`：

```rust
match repeat.as_str() {
    "daily" => next_dt += chrono::Duration::days(1),
    "weekly" => next_dt += chrono::Duration::days(7),
    "monthly" => {
        let day_mode = reminder.day_mode.as_str();
        match day_mode {
            "last" => {
                let last = last_day_of_month(next_dt.year(), next_dt.month());
                next_dt = chrono::NaiveDateTime::new(last, next_dt.time());
            }
            "second_last" => {
                let last = last_day_of_month(next_dt.year(), next_dt.month());
                next_dt = chrono::NaiveDateTime::new(last - chrono::Days::new(1), next_dt.time());
            }
            "third_last" => {
                let last = last_day_of_month(next_dt.year(), next_dt.month());
                next_dt = chrono::NaiveDateTime::new(last - chrono::Days::new(2), next_dt.time());
            }
            _ => { // "fixed" 或空字符串 = 向后兼容
                next_dt = next_dt.checked_add_months(chrono::Months::new(1)).unwrap_or(next_dt);
            }
        }
    }
    _ => {}
}
```

同样更新 `adv_due` 闭包内的 monthly 分支（line 1441），保持 `due_date` 不变：
```rust
"monthly" => due_d + chrono::Months::new(1),
```
due_date 始终沿用 chrono `Months::new(1)`，不受 day_mode 影响。

注意：`reminder` 在 line 1411 已 `match` 解构，`reminder.day_mode` 可直接访问。如果 `reminder` 已被 `match` 消耗，改成引用或用 `let day_mode = reminder.day_mode.clone();` 提取。

- [ ] **Step 4: cargo check 验证**

Run: `cargo check`
Expected: 编译通过

---

### Task 2: JS — 新增 calculateNextReminder 辅助函数

**Files:**
- Modify: `src/main.js`（放在 `openTodoEditModal` 之前，约 line 1700 处）

- [ ] **Step 1: 在 openTodoEditModal 前新增 formatISOLocal 和 calculateNextReminder**

```javascript
function formatISOLocal(d) {
    var y = d.getFullYear();
    var m = String(d.getMonth() + 1).padStart(2, '0');
    var day = String(d.getDate()).padStart(2, '0');
    var h = String(d.getHours()).padStart(2, '0');
    var min = String(d.getMinutes()).padStart(2, '0');
    return y + '-' + m + '-' + day + 'T' + h + ':' + min;
}

function calculateNextReminder(repeat, options) {
    var now = new Date();
    var hours = options.hours, minutes = options.minutes;

    if (repeat === 'daily') {
        var target = new Date(now.getFullYear(), now.getMonth(), now.getDate(), hours, minutes, 0, 0);
        if (target <= now) target.setDate(target.getDate() + 1);
        return formatISOLocal(target);
    }

    if (repeat === 'weekly') {
        // options.weekday: 1=周一 ... 7=周日
        var jsTarget = options.weekday === 7 ? 0 : options.weekday;
        var target = new Date(now.getFullYear(), now.getMonth(), now.getDate(), hours, minutes, 0, 0);
        var daysUntil = (jsTarget - now.getDay() + 7) % 7;
        if (daysUntil === 0 && target <= now) daysUntil = 7;
        target.setDate(target.getDate() + daysUntil);
        return formatISOLocal(target);
    }

    if (repeat === 'monthly') {
        if (options.dayMode === 'last') {
            var target = new Date(now.getFullYear(), now.getMonth() + 1, 0, hours, minutes, 0, 0);
            if (target <= now) {
                target = new Date(now.getFullYear(), now.getMonth() + 2, 0, hours, minutes, 0, 0);
            }
            return formatISOLocal(target);
        }
        if (options.dayMode === 'second_last') {
            var last = new Date(now.getFullYear(), now.getMonth() + 1, 0);
            var target = new Date(last.getFullYear(), last.getMonth(), last.getDate() - 1, hours, minutes, 0, 0);
            if (target <= now) {
                last = new Date(now.getFullYear(), now.getMonth() + 2, 0);
                target = new Date(last.getFullYear(), last.getMonth(), last.getDate() - 1, hours, minutes, 0, 0);
            }
            return formatISOLocal(target);
        }
        if (options.dayMode === 'third_last') {
            var last = new Date(now.getFullYear(), now.getMonth() + 1, 0);
            var target = new Date(last.getFullYear(), last.getMonth(), last.getDate() - 2, hours, minutes, 0, 0);
            if (target <= now) {
                last = new Date(now.getFullYear(), now.getMonth() + 2, 0);
                target = new Date(last.getFullYear(), last.getMonth(), last.getDate() - 2, hours, minutes, 0, 0);
            }
            return formatISOLocal(target);
        }
        // fixed
        var daysInMonth = new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate();
        var clampedDay = Math.min(options.day, daysInMonth);
        var target = new Date(now.getFullYear(), now.getMonth(), clampedDay, hours, minutes, 0, 0);
        if (target <= now) {
            var nextMonth = now.getMonth() + 1;
            var nextYear = now.getFullYear();
            if (nextMonth > 11) { nextMonth = 0; nextYear++; }
            var daysInNext = new Date(nextYear, nextMonth + 1, 0).getDate();
            target = new Date(nextYear, nextMonth, Math.min(options.day, daysInNext), hours, minutes, 0, 0);
        }
        return formatISOLocal(target);
    }

    return '';
}
```

---

### Task 3: JS — 修改 openTodoEditModal 模板

**Files:**
- Modify: `src/main.js:1703-1785`（openTodoEditModal 函数内的模板字符串）

- [ ] **Step 1: 替换提醒时间的模板**

旧代码（line 1771-1774）：
```javascript
+ '<div class="todo-edit-field">'
    + '<label>⏰ 提醒时间</label>'
    + '<input type="datetime-local" id="editReminder" value="' + (todo.reminder ? todo.reminder.datetime : '') + '">'
+ '</div>'
```

新代码：
```javascript
+ '<div class="todo-edit-field">'
    + '<label>⏰ 提醒时间</label>'
    + '<div class="reminder-input-group">'
        // 不重复
        + '<input type="datetime-local" id="editReminderOnce" class="ri ri-once" value="' + (todo.reminder && !todo.repeat ? todo.reminder.datetime : '') + '">'
        // 每天
        + '<input type="time" id="editReminderDaily" class="ri ri-daily" value="' + (todo.reminder && todo.repeat === 'daily' ? todo.reminder.datetime.slice(11, 16) : '') + '" style="display:none">'
        // 每周
        + '<span class="ri ri-weekly" style="display:none">'
            + '<select id="editReminderWeekday">'
                + '<option value="1">周一</option>'
                + '<option value="2">周二</option>'
                + '<option value="3">周三</option>'
                + '<option value="4">周四</option>'
                + '<option value="5">周五</option>'
                + '<option value="6">周六</option>'
                + '<option value="7">周日</option>'
            + '</select>'
            + '<input type="time" id="editReminderWeeklyTime">'
        + '</span>'
        // 每月
        + '<span class="ri ri-monthly" style="display:none">'
            + '<select id="editReminderMonthDay">'
                + (function() {
                    var opts = '';
                    for (var i = 1; i <= 31; i++) opts += '<option value="' + i + '">' + i + '日</option>';
                    opts += '<option value="last">最后一天</option>';
                    opts += '<option value="second_last">倒数第二天</option>';
                    opts += '<option value="third_last">倒数第三天</option>';
                    return opts;
                })()
            + '</select>'
            + '<input type="time" id="editReminderMonthlyTime">'
        + '</span>'
    + '</div>'
+ '</div>'
```

- [ ] **Step 2: 加载已有值时设置正确选项**

在弹出后设置 weekday/monthly day 的初始值（加在 overlay.appendChild 之后）：

```javascript
// 编辑已有待办：恢复每周/每月的选择值
if (todo.reminder && todo.repeat === 'weekly') {
    var d = new Date(todo.reminder.datetime);
    var weekday = d.getDay() === 0 ? 7 : d.getDay(); // JS周日=0 → 我们的周日=7
    overlay.querySelector('#editReminderWeekday').value = String(weekday);
    overlay.querySelector('#editReminderWeeklyTime').value = todo.reminder.datetime.slice(11, 16);
}
if (todo.reminder && todo.repeat === 'monthly') {
    var dayMode = todo.reminder.day_mode || 'fixed';
    var timeVal = todo.reminder.datetime.slice(11, 16);
    if (dayMode === 'last' || dayMode === 'second_last' || dayMode === 'third_last') {
        overlay.querySelector('#editReminderMonthDay').value = dayMode;
    } else {
        var dayNum = new Date(todo.reminder.datetime).getDate();
        overlay.querySelector('#editReminderMonthDay').value = String(dayNum);
    }
    overlay.querySelector('#editReminderMonthlyTime').value = timeVal;
}
```

- [ ] **Step 3: 添加重复类型切换的事件监听**

加在优先级切换监听器（line 1795）之后：

```javascript
// 重复类型切换 → 切换提醒输入
function switchReminderInput(repeatVal) {
    overlay.querySelectorAll('.ri').forEach(function(el) { el.style.display = 'none'; });
    if (repeatVal === null || repeatVal === '') {
        overlay.querySelector('.ri-once').style.display = '';
    } else if (repeatVal === 'daily') {
        overlay.querySelector('.ri-daily').style.display = '';
    } else if (repeatVal === 'weekly') {
        overlay.querySelector('.ri-weekly').style.display = '';
    } else if (repeatVal === 'monthly') {
        overlay.querySelector('.ri-monthly').style.display = '';
    }
}
var repeatSelect = overlay.querySelector('#editRepeat');
repeatSelect.addEventListener('change', function() {
    switchReminderInput(this.value || null);
});
switchReminderInput(repeatSelect.value || null); // 初始化状态
```

---

### Task 4: JS — 修改保存逻辑

**Files:**
- Modify: `src/main.js:1828-1833`（保存按钮内的 reminder 读取逻辑）

- [ ] **Step 1: 替换保存时的 reminder 读取代码**

旧代码（line 1828-1833）：
```javascript
var reminderVal = overlay.querySelector('#editReminder').value;
if (reminderVal) {
    todo.reminder = { datetime: reminderVal, sound: true };
} else {
    todo.reminder = null;
}
```

新代码：
```javascript
var repeatType = overlay.querySelector('#editRepeat').value;
var reminderVal = null;
var dayMode = 'fixed';

if (repeatType === '' || repeatType === null) {
    // 不重复
    reminderVal = overlay.querySelector('#editReminderOnce').value;
} else if (repeatType === 'daily') {
    var timeVal = overlay.querySelector('#editReminderDaily').value;
    if (timeVal) {
        var parts = timeVal.split(':');
        reminderVal = calculateNextReminder('daily', { hours: parseInt(parts[0], 10), minutes: parseInt(parts[1], 10) });
    }
} else if (repeatType === 'weekly') {
    var weekday = parseInt(overlay.querySelector('#editReminderWeekday').value, 10);
    var timeVal = overlay.querySelector('#editReminderWeeklyTime').value;
    if (timeVal) {
        var parts = timeVal.split(':');
        reminderVal = calculateNextReminder('weekly', { weekday: weekday, hours: parseInt(parts[0], 10), minutes: parseInt(parts[1], 10) });
    }
} else if (repeatType === 'monthly') {
    var daySelect = overlay.querySelector('#editReminderMonthDay');
    var dayVal = daySelect.value;
    var timeVal = overlay.querySelector('#editReminderMonthlyTime').value;
    if (timeVal) {
        var parts = timeVal.split(':');
        var specialDays = ['last', 'second_last', 'third_last'];
        if (specialDays.indexOf(dayVal) !== -1) {
            dayMode = dayVal;
            reminderVal = calculateNextReminder('monthly', { dayMode: dayVal, hours: parseInt(parts[0], 10), minutes: parseInt(parts[1], 10) });
        } else {
            reminderVal = calculateNextReminder('monthly', { dayMode: 'fixed', day: parseInt(dayVal, 10), hours: parseInt(parts[0], 10), minutes: parseInt(parts[1], 10) });
        }
    }
}

if (reminderVal) {
    todo.reminder = { datetime: reminderVal, sound: true, day_mode: dayMode };
} else {
    todo.reminder = null;
}
```

- [ ] **Step 2: 将 not 新待办的 `reminder` 默认值从 `null` 改为包含 day_mode**

line 1717 处 `reminder: null` 和 line 1812 处 `reminder: null` 无需改动，因为新建时还没设置提醒。

---

### Task 5: 验证

- [ ] **Step 1: cargo check**

Run: `cargo check`
Expected: 编译通过

- [ ] **Step 2: git diff 审查**

Run: `git diff src/`
确认：
- 没有意外修改其他功能
- Rust 端只改了 ReminderConfig + push 逻辑
- JS 端只改了 openTodoEditModal 模板和保存逻辑（+ 新增 calculateNextReminder）

- [ ] **Step 3: 边缘情况自查**

| 场景 | 验证方式 |
|------|---------|
| 旧数据无 day_mode | 反序列化后 `""`，Rust match 走 `_` 分支 = fixed |
| 不重复提醒编辑后保存 | datetime-local 正常读写 |
| 旧 daily 任务迁移 | 弹窗显示 time 输入，时间部分正确填入 |
| 旧 monthly 任务迁移 | 弹窗显示日号下拉，从 datetime 提取 day 填入 |
