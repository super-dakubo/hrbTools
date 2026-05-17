# 工作日/休息日分时提醒 + 节假日管理 实现计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 待办系统支持按工作日/休息日设不同提醒时间，配套节假日数据管理功能

**Architecture:** ReminderConfig 新增 workday_time/restday_time 替代单条 datetime；AppConfig 新增 holiday_data 存储节假日 JSON；Rust 提醒线程 + JS 前端同步计算 day_type

**Tech Stack:** Rust + Tauri 2 + 纯原生 JS/CSS

---

### Task 1: Rust 数据结构定义 + 向前兼容迁移

**Files:**
- Modify: `src/main.rs:160-249`

- [ ] **Step 1: 在 AppConfig 添加 holiday_data 字段**

在 `src/main.rs:160` 的 `AppConfig` 结构体中，`reminder_enabled` 之后添加：
```rust
    #[serde(default)]
    holiday_data: Vec<HolidayYearConfig>,
```

- [ ] **Step 2: 新增 HolidayYearConfig / HolidayPeriod 结构体**

在 `ReminderConfig` 结构体之后（约 249 行），添加：
```rust
#[derive(Debug, Serialize, Deserialize, Clone)]
struct HolidayYearConfig {
    #[serde(default)]
    year: i32,
    #[serde(default)]
    holidays: Vec<HolidayPeriod>,
    #[serde(default)]
    makeup_days: Vec<String>,   // ["MMdd"...]
}

#[derive(Debug, Serialize, Deserialize, Clone)]
struct HolidayPeriod {
    #[serde(default)]
    name: String,
    #[serde(default)]
    start: String,              // "MMdd"
    #[serde(default)]
    end: String,                // "MMdd", 包含
}
```

- [ ] **Step 3: ReminderConfig 添加 workday_time/restday_time 字段**

修改 `ReminderConfig` 结构体（约 242 行），在 `datetime` 和 `sound` 之间添加：
```rust
    #[serde(default)]
    workday_time: Option<String>,  // "HH:MM"
    #[serde(default)]
    restday_time: Option<String>,  // "HH:MM"
```

- [ ] **Step 4: 在 load_config 中添加旧配置迁移**

在 `src/main.rs` 的 `load_config` 函数中，`file_path → file_paths` 迁移块之后（约 310 行），添加：
```rust
                // 迁移旧格式: reminder.datetime → workday_time/restday_time
                for todo in config.todos.iter_mut() {
                    if let Some(ref r) = todo.reminder {
                        if r.workday_time.is_none() && r.restday_time.is_none()
                            && !r.datetime.is_empty() && r.datetime.len() >= 16
                        {
                            let time = &r.datetime[11..16];
                            // 通过 raw 检查旧数据是否设了重复类型
                            // 若无重复，视为一次性提醒，保留 datetime 原样
                            // 若有重复（daily/weekly/monthly），则迁移到 workday_time/restday_time
                            let raw_todos = raw["todos"].as_array();
                            let has_repeat = raw_todos
                                .and_then(|arr| arr.get(0))
                                .and_then(|t| t["repeat"].as_str())
                                .map(|r| !r.is_empty())
                                .unwrap_or(false);
                            // 实际按当前 todo 的 repeat 判断
                            if todo.repeat.is_some() {
                                if let Some(ref mut rem) = todo.reminder {
                                    rem.workday_time = Some(time.to_string());
                                    rem.restday_time = Some(time.to_string());
                                }
                            }
                        }
                    }
                }
```

- [ ] **Step 5: 编译验证**

Run: `cargo build`
Expected: 编译成功，无错误

- [ ] **Step 6: 提交**

```bash
git add src/main.rs
git commit -m "feat: add holiday data types and reminder workday/restday time fields"
```

---

### Task 2: Rust day_type 判定函数 + 节假日 Tauri 命令

**Files:**
- Modify: `src/main.rs`（在 ReminderConfig 之后添加函数，在 `generate_handler!` 之前添加命令）

- [ ] **Step 1: 实现 get_day_type 函数**

在 `HolidayYearConfig` 结构体之后（约 250 行处），添加工具函数：
```rust
// ==================== 节假日判定 ====================

/// 获取某天的类型: "workday" | "restday"
/// holiday_data: 当前年份的节假日配置，None 则按纯周末逻辑
fn get_day_type(date: &chrono::NaiveDate, holiday: Option<&HolidayYearConfig>) -> &'static str {
    let mmdd = format!("{:02}{:02}", date.month(), date.day());
    let weekday = date.weekday().num_days_from_monday(); // 0=周一..6=周日

    if let Some(h) = holiday {
        // 补班日（周末上班）→ 工作日
        if h.makeup_days.contains(&mmdd) {
            return "workday";
        }
        // 在假期段内 → 休息日
        if h.holidays.iter().any(|p| mmdd >= p.start && mmdd <= p.end) {
            return "restday";
        }
    }

    // 周末且非补班 → 休息日
    if weekday >= 5 { // 周六=5, 周日=6
        return "restday";
    }

    "workday"
}
```

- [ ] **Step 2: 添加获取 holiday_data 的 Tauri 命令**

在 `set_config` 命令之后（约 449 行），添加：
```rust
#[tauri::command]
fn get_holiday_data(app: tauri::AppHandle) -> Vec<HolidayYearConfig> {
    load_config(&app).holiday_data
}

#[tauri::command]
fn save_holiday_data(app: tauri::AppHandle, data: Vec<HolidayYearConfig>) -> OpResult {
    let mut config = load_config(&app);
    config.holiday_data = data;
    save_config(&app, &config);
    OpResult {
        success: true,
        message: "节假日数据已保存".to_string(),
    }
}
```

- [ ] **Step 3: 注册新命令**

在 `main()` 函数的 `.invoke_handler(tauri::generate_handler![...])` 中，添加 `get_holiday_data`、`save_holiday_data`。

- [ ] **Step 4: 编译验证**

Run: `cargo build`
Expected: 编译成功

- [ ] **Step 5: 提交**

```bash
git add src/main.rs
git commit -m "feat: add day_type detection and holiday data Tauri commands"
```

---

### Task 3: Rust 提醒线程改造 — 使用 workday_time/restday_time

**Files:**
- Modify: `src/main.rs:1461-1570`（提醒线程的检查/推进逻辑）

- [ ] **Step 1: 修改提醒线程的当前时间获取逻辑**

在 `src/main.rs` 的提醒线程 `for todo in config.todos.iter_mut()` 循环中（约 1461 行），当前是：
```rust
let reminder = match &todo.reminder {
    Some(r) => r,
    None => { ... continue; }
};
```

替换为：
```rust
let reminder = match &todo.reminder {
    Some(r) => r,
    None => {
        write_log(&app_handle, &format!("待办 '{}' 无提醒设置", todo.text));
        continue;
    }
};

// 根据 day_type 获取当日提醒时间
let now_local = chrono::Local::now();
let today = now_local.date_naive();
let holiday_year = config.holiday_data.iter().find(|h| h.year == today.year());
let day_type = get_day_type(&today, holiday_year);

let target_time = if day_type == "workday" {
    reminder.workday_time.as_deref()
} else {
    reminder.restday_time.as_deref()
};

let target_time = match target_time {
    Some(t) => t,
    None => {
        write_log(&app_handle, &format!("待办 '{}' 今日({})无对应提醒时间", todo.text, day_type));
        continue;
    }
};

// 构建今天的完整提醒时间
let target_dt_str = format!("{}T{}", today.format("%Y-%m-%d"), target_time);
write_log(&app_handle, &format!("检查: '{}' day_type={} target={}", todo.text, day_type, target_dt_str));

let reminder_dt = match chrono::NaiveDateTime::parse_from_str(&target_dt_str, "%Y-%m-%dT%H:%M") {
    Ok(dt) => dt,
    Err(e) => {
        write_log(&app_handle, &format!("解析提醒时间失败 '{}' : {:?}", target_dt_str, e));
        continue;
    }
};
```

注意：修改后保留 `reminder_dt` 变量名，后续代码（check + fire + advance）不变。
删除旧的 `reminder.datetime` 解析代码（原来第 1468-1477 行的 `parse_from_str(&reminder.datetime, ...)` 及其相关日志）。

- [ ] **Step 2: 修改重复任务的推进逻辑**

在 `repeat.as_str()` 匹配块中（约 1536 行），`daily` 分支的推进从：
```rust
"daily" => next_dt += chrono::Duration::days(1),
```
改为：
```rust
"daily" => {
    // 推进到下一天，按当天的 day_type 取对应时间
    let mut next_day = next_dt.date() + chrono::Days::new(1);
    let next_holiday = config.holiday_data.iter().find(|h| h.year == next_day.year());
    loop {
        let next_type = get_day_type(&next_day, next_holiday);
        let next_time = if next_type == "workday" { &reminder.workday_time } else { &reminder.restday_time };
        if let Some(t) = next_time {
            let parts: Vec<&str> = t.split(':').collect();
            if parts.len() == 2 {
                if let (Ok(h), Ok(m)) = (parts[0].parse::<u32>(), parts[1].parse::<u32>()) {
                    next_dt = chrono::NaiveDateTime::new(next_day, chrono::NaiveTime::from_hms_opt(h, m, 0).unwrap());
                    break;
                }
            }
        }
        next_day += chrono::Days::new(1); // 继续找下一天
    }
}
```

注意：`next_dt` 在 repeat 块外会被用于设置 `todo.reminder.datetime`，所以这个修改能正确推进。

对于 `adv_due` 闭包（约 1523 行），`daily` 分支同样改为推进到下一个有对应时间的日期：
```rust
"daily" => {
    let mut next = due_d + chrono::Days::new(1);
    let next_holiday = config.holiday_data.iter().find(|h| h.year == next.year());
    loop {
        let nt = get_day_type(&next, next_holiday);
        let nt_time = if nt == "workday" { &reminder.workday_time } else { &reminder.restday_time };
        if nt_time.is_some() {
            *d = Some(next.format("%Y-%m-%d").to_string());
            break;
        }
        next += chrono::Days::new(1);
    }
}
```

需要将 `reminder` 变量暴露到闭包可访问的作用域（当前 `reminder` 在闭包外已定义，可直接捕获）。

- [ ] **Step 3: 编译验证**

Run: `cargo build`
Expected: 编译成功

- [ ] **Step 4: 提交**

```bash
git add src/main.rs
git commit -m "feat: update reminder thread to use workday_time/restday_time with day_type"
```

---

### Task 4: JS 节假日管理 UI（设置弹窗）

**Files:**
- Modify: `src/index.html:144-171`（设置弹窗 body 内添加节假日区块）
- Modify: `src/main.js`（在「设置弹窗」区块添加节假日管理逻辑）
- Modify: `src/styles.css`（节假日预览表格等样式，见 Task 7）

- [ ] **Step 1: index.html — 在设置弹窗 body 末尾添加节假日区块**

在 `src/index.html:171` 的 `div class="row"`（提醒开关）之后，`div class="settings-hint"` 之前添加：
```html
                <div class="input-group">
                    <label>节假日配置</label>
                    <div id="holidayYearsList"></div>
                    <div class="row" style="margin-top:8px;">
                        <select id="holidayYearSelect" class="holiday-year-select">
                            <option value="2026">2026年</option>
                            <option value="2027">2027年</option>
                        </select>
                        <button id="holidayAddBtn" class="btn-small">添加</button>
                    </div>
                    <div id="holidayEditor" style="display:none;margin-top:8px;"></div>
                </div>
```

- [ ] **Step 2: main.js — 在「设置弹窗」区块末尾添加节假日数据加载和渲染**

在 `updateSettingsDisplay()` 函数末尾（约 1384 行），调用一个渲染函数：
```js
    renderHolidayYears();
```

- [ ] **Step 3: 实现 renderHolidayYears 函数**

在 `updateSettingsDisplay()` 函数之后（约 1385 行），添加：
```js
let _editingHolidayYear = null;

function renderHolidayYears() {
    var list = document.getElementById('holidayYearsList');
    var years = currentConfig.holiday_data || [];
    if (years.length === 0) {
        list.innerHTML = '<span class="settings-hint">暂未配置</span>';
        return;
    }
    list.innerHTML = years.map(function(h) {
        return '<div class="holiday-year-row">'
            + '<span>' + h.year + '年</span>'
            + '<button class="btn-small holiday-edit-btn" data-year="' + h.year + '">编辑</button>'
            + '<button class="btn-small holiday-del-btn" data-year="' + h.year + '">删除</button>'
            + '</div>';
    }).join('');

    // 委托事件
    list.querySelectorAll('.holiday-edit-btn').forEach(function(btn) {
        btn.addEventListener('click', function() {
            var year = parseInt(this.dataset.year, 10);
            openHolidayEditor(year);
        });
    });
    list.querySelectorAll('.holiday-del-btn').forEach(function(btn) {
        btn.addEventListener('click', async function() {
            var year = parseInt(this.dataset.year, 10);
            currentConfig.holiday_data = (currentConfig.holiday_data || []).filter(function(h) { return h.year !== year; });
            await saveConfigToBackend();
            renderHolidayYears();
            document.getElementById('holidayEditor').style.display = 'none';
        });
    });
}
```

- [ ] **Step 4: 实现 holidayAddBtn 逻辑 和 openHolidayEditor**

在 `renderHolidayYears` 之后添加：
```js
document.getElementById('holidayAddBtn').addEventListener('click', function() {
    var year = parseInt(document.getElementById('holidayYearSelect').value, 10);
    // 检查是否已存在
    var exists = (currentConfig.holiday_data || []).some(function(h) { return h.year === year; });
    if (exists) {
        alert('该年份已配置，请编辑');
        return;
    }
    openHolidayEditor(year);
});

function getTemplateJSON(year) {
    return JSON.stringify({
        year: year,
        holidays: [
            { name: '元旦', start: '0101', end: '0103' }
        ],
        makeup_days: ['0114']
    }, null, 2);
}

function openHolidayEditor(year) {
    _editingHolidayYear = year;
    var editor = document.getElementById('holidayEditor');
    var existing = (currentConfig.holiday_data || []).find(function(h) { return h.year === year; });
    var defaultText = existing ? JSON.stringify(existing, null, 2) : '';

    editor.style.display = 'block';
    editor.innerHTML = ''
        + '<div class="holiday-editor-panel">'
        + '<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px;">'
        + '<strong>' + year + '年 节假日配置</strong>'
        + '<button class="btn-small" id="holidayCopyTemplate">复制模板</button>'
        + '</div>'
        + '<textarea id="holidayJsonInput" class="holiday-json-input" placeholder="粘贴 JSON（粘贴后自动解析）">'
        + escapeHtml(defaultText) + '</textarea>'
        + '<div id="holidayPreview" style="margin-top:8px;"></div>'
        + '<div style="margin-top:8px;display:flex;gap:8px;">'
        + '<button class="btn-small" id="holidaySaveBtn" style="display:none;">确认保存</button>'
        + '<button class="btn-small" id="holidayCancelBtn">取消</button>'
        + '</div>'
        + '</div>';

    document.getElementById('holidayCopyTemplate').addEventListener('click', function() {
        navigator.clipboard.writeText(getTemplateJSON(year)).catch(function() {
            alert('复制失败，请手动复制');
        });
    });

    document.getElementById('holidayJsonInput').addEventListener('input', function() {
        parseAndPreviewHolidayJSON(this.value, year);
    });

    document.getElementById('holidayCancelBtn').addEventListener('click', function() {
        editor.style.display = 'none';
    });

    // 如果有默认数据，自动解析
    if (defaultText) {
        parseAndPreviewHolidayJSON(defaultText, year);
    }
}
```

- [ ] **Step 5: 实现 parseAndPreviewHolidayJSON 校验+预览**

在 `openHolidayEditor` 之后添加：
```js
function parseAndPreviewHolidayJSON(text, year) {
    var preview = document.getElementById('holidayPreview');
    if (!text.trim()) {
        preview.innerHTML = '';
        document.getElementById('holidaySaveBtn').style.display = 'none';
        return;
    }

    var data;
    try {
        data = JSON.parse(text);
    } catch (e) {
        preview.innerHTML = '<div class="holiday-error">⛔ JSON 格式错误: ' + escapeHtml(e.message) + '</div>';
        document.getElementById('holidaySaveBtn').style.display = 'none';
        return;
    }

    // 校验
    var errors = [];
    if (!data.year || data.year < 2000 || data.year > 2099) errors.push('年份无效，需在 2000-2099 之间');
    if (data.year !== year) errors.push('年份不匹配，期望 ' + year + ' 但 JSON 中是 ' + data.year);

    if (!Array.isArray(data.holidays)) errors.push('holidays 必须是数组');
    if (!Array.isArray(data.makeup_days)) errors.push('makeup_days 必须是数组');

    // 校验日期格式
    var mmddRe = /^(0[1-9]|1[0-2])(0[1-9]|[12]\d|3[01])$/;
    var holidayNames = [];
    var holidayRanges = [];
    if (Array.isArray(data.holidays)) {
        data.holidays.forEach(function(h, i) {
            if (!h.name) errors.push('第 ' + (i+1) + ' 个假期缺少 name');
            else if (holidayNames.indexOf(h.name) !== -1) errors.push('假期名重复: ' + h.name);
            else holidayNames.push(h.name);

            if (!mmddRe.test(h.start)) errors.push('假期 "' + (h.name || i) + '" 开始日期格式错误: ' + h.start);
            if (!mmddRe.test(h.end)) errors.push('假期 "' + (h.name || i) + '" 结束日期格式错误: ' + h.end);
            if (mmddRe.test(h.start) && mmddRe.test(h.end) && h.start > h.end) {
                errors.push('假期 "' + h.name + '" 结束日期早于开始日期');
            }
            if (mmddRe.test(h.start) && mmddRe.test(h.end)) {
                holidayRanges.push({ name: h.name, start: h.start, end: h.end });
            }
        });
    }

    // 检查假期重叠
    for (var i = 0; i < holidayRanges.length; i++) {
        for (var j = i + 1; j < holidayRanges.length; j++) {
            if (holidayRanges[i].start <= holidayRanges[j].end && holidayRanges[j].start <= holidayRanges[i].end) {
                errors.push('假期重叠: "' + holidayRanges[i].name + '" 与 "' + holidayRanges[j].name + '"');
            }
        }
    }

    // 校验补班日
    var makeupSet = {};
    if (Array.isArray(data.makeup_days)) {
        data.makeup_days.forEach(function(d, i) {
            if (!mmddRe.test(d)) errors.push('补班日格式错误: ' + d);
            if (makeupSet[d]) errors.push('补班日重复: ' + d);
            else makeupSet[d] = true;
        });
    }

    if (errors.length > 0) {
        preview.innerHTML = '<div class="holiday-error">⛔ ' + errors.map(function(e) { return escapeHtml(e); }).join('<br>') + '</div>';
        document.getElementById('holidaySaveBtn').style.display = 'none';
        return;
    }

    // 展示预览
    var holidayRows = data.holidays.map(function(h) {
        return '<tr><td>' + escapeHtml(h.name) + '</td><td>' + h.start.slice(0,2) + '/' + h.start.slice(2) + '</td><td>' + h.end.slice(0,2) + '/' + h.end.slice(2) + '</td></tr>';
    }).join('');
    var makeupChips = data.makeup_days.map(function(d) {
        return '<span class="makeup-chip">' + d.slice(0,2) + '/' + d.slice(2) + '</span>';
    }).join('');

    preview.innerHTML = '<div class="holiday-preview">'
        + '<div class="holiday-preview-title">' + data.year + ' 年节假日配置</div>'
        + (holidayRows ? '<table class="holiday-table"><tr><th>节日</th><th>开始</th><th>结束</th></tr>' + holidayRows + '</table>' : '')
        + (makeupChips ? '<div class="holiday-makeup-section"><div class="holiday-preview-subtitle">补班日</div><div class="makeup-chips">' + makeupChips + '</div></div>' : '')
        + '</div>';

    // 显示保存按钮
    var saveBtn = document.getElementById('holidaySaveBtn');
    saveBtn.style.display = '';
    saveBtn.onclick = null;
    saveBtn.addEventListener('click', async function() {
        var list = currentConfig.holiday_data || [];
        // 替换或追加
        var idx = list.findIndex(function(h) { return h.year === data.year; });
        if (idx !== -1) list[idx] = data;
        else list.push(data);
        currentConfig.holiday_data = list;
        await saveConfigToBackend();
        renderHolidayYears();
        document.getElementById('holidayEditor').style.display = 'none';
        window.__log.info('Holiday', data.year + '年节假日配置已保存');
    });
}
```

- [ ] **Step 6: 更新年份下拉范围**

在页面加载时的初始化部分（约 2070 行），添加年份下拉填充逻辑：
```js
// 填充年份下拉（在 DOMContentLoaded 中）
(function populateHolidayYears() {
    var select = document.getElementById('holidayYearSelect');
    var currentYear = new Date().getFullYear();
    for (var y = 2026; y <= currentYear + 1; y++) {
        var opt = document.createElement('option');
        opt.value = String(y);
        opt.textContent = y + '年';
        select.appendChild(opt);
    }
})();
```

- [ ] **Step 7: 提交**

```bash
git add src/index.html src/main.js
git commit -m "feat: add holiday data management UI in settings"
```

---

### Task 5: JS 提醒输入 UI 改造 — workday/restday 双时间

**Files:**
- Modify: `src/main.js`（todo 编辑弹窗中的提醒输入区域）

- [ ] **Step 1: 修改 openTodoEditModal 中的提醒时间 HTML**

在 `src/main.js` 约 1873-1907 行的提醒时间 div 中，将现有的 `daily` 输入从单 time 改为双 time：

替换约 1878-1879 行：
```js
                // 每天
                + '<input type="time" id="editReminderDaily" class="ri ri-daily" value="' + (todo.reminder && todo.repeat === 'daily' ? todo.reminder.datetime.slice(11, 16) : '') + '" style="display:none">'
```

改为：
```js
                // 每天
                + '<span class="ri ri-daily" style="display:none">'
                    + '<details class="reminder-details">'
                    + '<summary class="reminder-summary">⏰ <span id="reminderSummaryText">' + getReminderSummary(todo) + '</span></summary>'
                    + '<div class="reminder-detail-fields">'
                    + '<label class="reminder-time-label">工作日 <input type="time" id="editWorkdayTime" value="' + (todo.reminder && todo.repeat === 'daily' && todo.reminder.workday_time ? todo.reminder.workday_time : '') + '"></label>'
                    + '<label class="reminder-time-label">休息日 <input type="time" id="editRestdayTime" value="' + (todo.reminder && todo.repeat === 'daily' && todo.reminder.restday_time ? todo.reminder.restday_time : '') + '"></label>'
                    + '<label class="reminder-off-label"><input type="checkbox" id="editRestdayOff"' + (todo.reminder && todo.repeat === 'daily' && !todo.reminder.restday_time && todo.reminder.workday_time ? ' checked' : '') + '> 休息日不提醒</label>'
                    + '</div>'
                    + '</details>'
                + '</span>'
```

同时需要在 openTodoEditModal 开头附近（约 1798 行），获取 todo 后添加 `getReminderSummary` 函数：
```js
function getReminderSummary(todo) {
    if (!todo.reminder) return '未设置';
    var wd = todo.reminder.workday_time;
    var rd = todo.reminder.restday_time;
    if (wd && rd) {
        if (wd === rd) return '每天 ' + wd;
        return '工作日 ' + wd + ' / 休息日 ' + rd;
    }
    if (wd) return '工作日 ' + wd;
    if (rd) return '休息日 ' + rd;
    return '未设置';
}
```

注意：`getReminderSummary` 需要在 `openTodoEditModal` 之前定义。

- [ ] **Step 2: 修改 switchReminderInput 以显示新控件**

`switchReminderInput` 函数（约 1933 行）中 `daily` 分支的显示由 `overlay.querySelector('.ri-daily').style.display = '';` 改为显示新结构（保持不变，因为 class 名未变）。

但需要额外处理：恢复编辑已有待办的 daily 时间时，设置 workday_time / restday_time 的值。

在约 1913-1930 行（"编辑已有待办"恢复逻辑）之后，添加：
```js
    // 编辑已有待办：恢复 daily 的工作日/休息日时间
    if (todo.reminder && todo.repeat === 'daily') {
        if (todo.reminder.workday_time) {
            overlay.querySelector('#editWorkdayTime').value = todo.reminder.workday_time;
        }
        if (todo.reminder.restday_time) {
            overlay.querySelector('#editRestdayTime').value = todo.reminder.restday_time;
        }
        if (!todo.reminder.restday_time && todo.reminder.workday_time) {
            overlay.querySelector('#editRestdayOff').checked = true;
        }
        updateReminderSummary(todo);
    }
```

添加 `updateReminderSummary` 函数：
```js
function updateReminderSummary(todo) {
    var el = document.getElementById('reminderSummaryText');
    if (!el) return;
    var wd = document.getElementById('editWorkdayTime');
    var rd = document.getElementById('editRestdayTime');
    var off = document.getElementById('editRestdayOff');
    if (!wd || !rd) return;
    var wdv = wd.value, rdv = off && off.checked ? null : (rd ? rd.value : null);
    if (wdv && rdv) {
        if (wdv === rdv) el.textContent = '每天 ' + wdv;
        else el.textContent = '工作日 ' + wdv + ' / 休息日 ' + rdv;
    } else if (wdv) {
        el.textContent = '工作日 ' + wdv;
    } else if (rdv) {
        el.textContent = '休息日 ' + rdv;
    } else {
        el.textContent = '未设置';
    }
}
```

- [ ] **Step 3: 修改 collectFields 中的提醒收集逻辑**

在 `collectFields` 函数（约 1968 行）的 `daily` 分支中，替换：
```js
        } else if (repeatType === 'daily') {
            var timeVal = overlay.querySelector('#editReminderDaily').value;
            if (timeVal) {
                var parts = timeVal.split(':');
                reminderVal = calculateNextReminder('daily', { hours: parseInt(parts[0], 10), minutes: parseInt(parts[1], 10) });
            }
```
改为：
```js
        } else if (repeatType === 'daily') {
            var wdVal = overlay.querySelector('#editWorkdayTime').value;
            var rdVal = overlay.querySelector('#editRestdayTime').value;
            var rdOff = overlay.querySelector('#editRestdayOff').checked;
            if (wdVal || rdVal) {
                var nextDate = calculateNextReminderDate('daily', wdVal, rdOff ? null : rdVal);
                if (nextDate) {
                    reminderVal = nextDate;
                }
            }
        }
```

- [ ] **Step 4: 实现 calculateNextReminderDate**

在 `calculateNextReminder` 函数之前（约 1733 行），添加新的计算函数：
```js
function calculateNextReminderDate(repeat, workdayTime, restdayTime) {
    var now = new Date();
    var today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    var holidayData = currentConfig.holiday_data || [];

    for (var d = 0; d < 60; d++) {
        var checkDate = new Date(today.getFullYear(), today.getMonth(), today.getDate() + d);
        var dayType = getDayType(checkDate, holidayData);
        var targetTime = dayType === 'workday' ? workdayTime : restdayTime;
        if (!targetTime) continue;

        var parts = targetTime.split(':');
        var target = new Date(checkDate.getFullYear(), checkDate.getMonth(), checkDate.getDate(),
            parseInt(parts[0], 10), parseInt(parts[1], 10), 0, 0);
        // 如果是今天且时间未过，返回今天
        if (d === 0 && target > now) return formatISOLocal(target);
        // 如果是今天但时间已过，继续找下一天
        if (d === 0) continue;
        // 未来日期，直接返回
        return formatISOLocal(target);
    }
    return '';
}
```

- [ ] **Step 5: 实现 getDayType（JS 版）**

在 `calculateNextReminderDate` 之前添加：
```js
function getDayType(date, holidayData) {
    var mmdd = String(date.getMonth() + 1).padStart(2, '0') + String(date.getDate()).padStart(2, '0');
    var year = date.getFullYear();
    var holiday = null;
    for (var i = 0; i < holidayData.length; i++) {
        if (holidayData[i].year === year) { holiday = holidayData[i]; break; }
    }

    if (holiday) {
        if (holiday.makeup_days.indexOf(mmdd) !== -1) return 'workday';
        for (var j = 0; j < holiday.holidays.length; j++) {
            var h = holiday.holidays[j];
            if (mmdd >= h.start && mmdd <= h.end) return 'restday';
        }
    }

    var day = date.getDay(); // 0=Sun, 6=Sat
    if (day === 0 || day === 6) return 'restday';
    return 'workday';
}
```

- [ ] **Step 6: 修改 autoSave 中的 reminder 保存逻辑**

在 `autoSave` 函数中（约 2033 行），当前是：
```js
todo.reminder = fields.reminder;
```
改为保留 workday_time/restday_time：
```js
if (fields.reminder) {
    if (!todo.reminder) {
        todo.reminder = { datetime: fields.reminder, sound: true, day_mode: 'fixed', workday_time: null, restday_time: null };
    } else {
        todo.reminder.datetime = fields.reminder;
    }
    // 如果是 daily，保存 workday_time / restday_time
    if (fields.repeat === 'daily') {
        todo.reminder.workday_time = document.getElementById('editWorkdayTime').value || null;
        todo.reminder.restday_time = document.getElementById('editRestdayOff').checked ? null : (document.getElementById('editRestdayTime').value || null);
    }
} else {
    todo.reminder = null;
}
```

同时需要删除 `todo.reminder = fields.reminder;` 这一行。

- [ ] **Step 7: 为 daily 时间变化添加 autoSave 事件**

在 openTodoEditModal 末尾（约 2051 行），添加：
```js
    overlay.querySelector('#editWorkdayTime').addEventListener('change', function() {
        updateReminderSummary();
        autoSave();
    });
    overlay.querySelector('#editRestdayTime').addEventListener('change', function() {
        updateReminderSummary();
        autoSave();
    });
    overlay.querySelector('#editRestdayOff').addEventListener('change', function() {
        updateReminderSummary();
        autoSave();
    });
```

- [ ] **Step 8: 修改 createNextRepeat / recalculateNextDue**

`createNextRepeat` 函数（约 1658 行）中，确保新创建的待办继承 `workday_time` 和 `restday_time`（由于 `JSON.parse(JSON.stringify(todo))` 会深拷贝所有字段，包括新字段，所以继承是自动的——只需要确保 datetime 按 day_type 重新计算）。

修改约 1681-1686 行：
```js
    if (newTodo.reminder && newTodo.reminder.datetime && todo.repeat) {
        var r = new Date(newTodo.reminder.datetime);
        if (todo.repeat === 'daily') {
            // 用 workday_time/restday_time 计算下一次
            var next = calculateNextReminderDate('daily',
                newTodo.reminder.workday_time,
                newTodo.reminder.restday_time);
            if (next) newTodo.reminder.datetime = next;
        } else if (todo.repeat === 'weekly') r.setDate(r.getDate() + 7);
        else if (todo.repeat === 'monthly') r.setMonth(r.getMonth() + 1);
    }
```

同样的逻辑适用于 `recalculateNextDue` 中的 reminder 推进（约 1703-1709 行）。

- [ ] **Step 9: 提交**

```bash
git add src/main.js
git commit -m "feat: update todo edit modal with workday/restday reminder times"
```

---

### Task 6: JS 前端的向前兼容处理

**Files:**
- Modify: `src/main.js`（在 loadConfig 回调中添加迁移）

- [ ] **Step 1: 在 loadConfig 中添加旧 reminder 迁移**

在约 480 行（`loadConfig` 回调中 `currentConfig = config;` 之后），添加：
```js
    // 迁移旧 reminder.datetime → workday_time/restday_time
    (currentConfig.todos || []).forEach(function(t) {
        if (t.reminder && !t.reminder.workday_time && !t.reminder.restday_time && t.reminder.datetime) {
            var time = t.reminder.datetime.slice(11, 16);
            if (t.repeat) {
                t.reminder.workday_time = time;
                t.reminder.restday_time = time;
            }
        }
    });
```

- [ ] **Step 2: 提交**

```bash
git add src/main.js
git commit -m "fix: add forward compatibility for old reminder.datetime format"
```

---

### Task 7: CSS 样式

**Files:**
- Modify: `src/styles.css`

- [ ] **Step 1: 节假日管理 UI 样式**

在 CSS 文件末尾添加：
```css
/* ==================== 节假日管理 ==================== */
.holiday-year-row {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 4px 0;
}
.holiday-year-row span {
    flex: 1;
}
.holiday-year-select {
    flex: 1;
    padding: 4px 8px;
    border: 1px solid var(--border);
    border-radius: 4px;
    background: var(--input-bg);
    color: var(--text);
}
.holiday-editor-panel {
    border: 1px solid var(--border);
    border-radius: 6px;
    padding: 12px;
    background: var(--surface);
}
.holiday-json-input {
    width: 100%;
    min-height: 120px;
    font-family: 'Cascadia Code', 'Consolas', monospace;
    font-size: 13px;
    padding: 8px;
    border: 1px solid var(--border);
    border-radius: 4px;
    background: var(--input-bg);
    color: var(--text);
    resize: vertical;
    box-sizing: border-box;
}
.holiday-error {
    color: #e74c3c;
    font-size: 13px;
    padding: 8px 12px;
    background: rgba(231, 76, 60, 0.1);
    border-radius: 4px;
    line-height: 1.6;
}
.holiday-preview {
    border: 1px solid var(--border);
    border-radius: 6px;
    padding: 12px;
    background: var(--bg);
}
.holiday-preview-title {
    font-weight: 600;
    margin-bottom: 8px;
    color: var(--text);
}
.holiday-preview-subtitle {
    font-weight: 500;
    margin: 8px 0 4px;
    color: var(--text);
}
.holiday-table {
    width: 100%;
    border-collapse: collapse;
    font-size: 13px;
}
.holiday-table th, .holiday-table td {
    border: 1px solid var(--border);
    padding: 4px 8px;
    text-align: left;
}
.holiday-table th {
    background: var(--surface);
    font-weight: 500;
}
.makeup-chips {
    display: flex;
    flex-wrap: wrap;
    gap: 6px;
}
.makeup-chip {
    display: inline-block;
    padding: 2px 10px;
    background: rgba(75, 139, 244, 0.15);
    border-radius: 12px;
    font-size: 12px;
    color: var(--accent);
}
```

- [ ] **Step 2: 提醒区域 details/summary 样式**

在 CSS 末尾继续添加：
```css
/* ==================== 提醒时间 details ==================== */
.reminder-details {
    font-size: 13px;
}
.reminder-details summary {
    cursor: pointer;
    padding: 4px 0;
    user-select: none;
}
.reminder-details summary:focus {
    outline: none;
}
.reminder-detail-fields {
    display: flex;
    flex-direction: column;
    gap: 6px;
    padding: 8px;
    margin-top: 4px;
    border: 1px solid var(--border);
    border-radius: 4px;
    background: var(--surface);
}
.reminder-time-label {
    display: flex;
    align-items: center;
    gap: 8px;
    font-size: 13px;
}
.reminder-time-label input[type="time"] {
    flex: 1;
    padding: 4px 8px;
    border: 1px solid var(--border);
    border-radius: 4px;
    background: var(--input-bg);
    color: var(--text);
}
.reminder-off-label {
    display: flex;
    align-items: center;
    gap: 6px;
    font-size: 13px;
    color: var(--text-secondary);
    cursor: pointer;
}
```

- [ ] **Step 3: 提交**

```bash
git add src/styles.css
git commit -m "style: add holiday management and reminder details styles"
```

---

### Task 8: 端到端验证

- [ ] **Step 1: 编译并启动**

Run: `cargo tauri dev`
Expected: 应用正常启动，无控制台错误

- [ ] **Step 2: 验证节假日管理**

1. 点击设置 → 看到「节假日配置」区块
2. 选择年份 → 点击「添加」→ 看到编辑面板 + 复制模板按钮
3. 点击「复制模板」→ 粘贴到文本编辑器确认 JSON 格式正确
4. 在文本框中粘贴 2026 年节假日 JSON → 自动解析显示预览表格
5. 点击「确认保存」→ 年份列表显示「2026年」条目
6. 关闭设置 → 重新打开 → 确认数据持久化

- [ ] **Step 3: 验证待办提醒 UI**

1. 新建待办 → 在编辑弹窗中
2. 选择重复类型「每天」
3. 看到提醒时间区域：默认折叠，显示「⏰ 未设置」
4. 展开后看到「工作日」「休息日」两个时间输入 + 「休息日不提醒」复选框
5. 设工作日 20:00、休息日 14:00 → 总结栏更新为「工作日 20:00 / 休息日 14:00」
6. 保存 → 关闭 → 重新编辑 → 确认数据回显

- [ ] **Step 4: 验证旧配置兼容**

1. 修改 config.json 中的一条待办，只保留 `reminder.datetime` 不含 workday_time/restday_time
2. 重启应用
3. 编辑该待办 → 确认自动迁移为 workday_time=restday_time=旧时间值

- [ ] **Step 5: 提交最终验证**

```bash
git add -A
git commit -m "chore: complete workday/restday reminder feature"
```
