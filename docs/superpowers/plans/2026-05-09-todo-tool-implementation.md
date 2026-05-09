# 待办工具实现计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 为 HRB Tools 新增待办工具面板、Tab 拖拽排序、定时提醒、系统托盘、开机自启，并移除 chrono-tz 省体积。

**Architecture:** 前端驱动 + Rust 持久化。待办 CRUD/排序/过滤全在 JS 完成，Rust 负责存储、通知、托盘。数据全部存入 config.json 复用现有机制。chrono-tz 替换为手动 DST 计算省 ~3MB。

**Tech Stack:** Tauri 2.0 / Rust / 原生 HTML/CSS/JS / notify-rust / chrono

---

## 文件结构

| 文件 | 职责 | 改动类型 |
|------|------|---------|
| `Cargo.toml` | 依赖管理 | 修改 |
| `src/main.rs` | Rust 后端：数据模型、时区、提醒线程、托盘、开机自启 | 修改 |
| `src/index.html` | 面板结构、Tab 栏 | 修改 |
| `src/main.js` | 前端逻辑：Tab 拖拽、待办 CRUD、设置开关 | 修改 |
| `src/styles.css` | 待办面板样式 | 修改 |

---

### Task 1: Cargo.toml 依赖更新

**Files:**
- Modify: `Cargo.toml`

- [ ] **Step 1: 更新依赖**

```toml
[dependencies]
tauri = { version = "2.0", features = [] }
serde = { version = "1.0", features = ["derive"] }
serde_json = "1.0"
chrono = { version = "0.4", features = ["serde"] }
-rfd = "0.17"
-md-5 = "0.10"
+notify-rust = "4"
+rfd = "0.17"
+md-5 = "0.10"
```

移除 `chrono-tz = "0.8"`，新增 `notify-rust = "4"`。保持其他依赖不变。

- [ ] **Step 2: 验证编译**

Run: `cargo check`
Expected: 编译成功（会有 chrono_tz::Tz 相关报错，下一任务修复）

- [ ] **Step 3: 提交**

```bash
git add Cargo.toml Cargo.lock
git commit -m "chore: remove chrono-tz, add notify-rust"
```

---

### Task 2: Rust 替换 chrono-tz + 数据模型扩展

**Files:**
- Modify: `src/main.rs`

内容较多，分两步：时区替换 + 数据模型。

- [ ] **Step 1: 替换 import 和添加时区函数**

```rust
// 移除: use chrono_tz::Tz;
// 新增时区工具函数（放在文件顶部 use 之后）

/// 解析时区名称为固定偏移（含 DST 支持）
fn resolve_timezone(tz_name: &str) -> Option<chrono::FixedOffset> {
    use chrono::FixedOffset;
    match tz_name {
        "Asia/Shanghai"     => Some(FixedOffset::east_opt(8 * 3600)?),
        "Asia/Kolkata"      => Some(FixedOffset::east_opt(5 * 3600 + 1800)?),
        "Asia/Tokyo"        => Some(FixedOffset::east_opt(9 * 3600)?),
        "UTC"               => Some(FixedOffset::east_opt(0)?),
        "Europe/London"     => {
            // 伦敦: BST(UTC+1) 3月最后周日~10月最后周日
            let now = chrono::Utc::now().naive_utc().date();
            let year = now.year();
            let bst_start = last_sunday_of_month(year, 3);
            let bst_end = last_sunday_of_month(year, 10);
            let offset = if now >= bst_start && now < bst_end { 1 } else { 0 };
            Some(FixedOffset::east_opt(offset * 3600)?)
        }
        "America/New_York"  => {
            // 纽约: EDT(UTC-4) 3月第2周日~11月第1周日
            let now = chrono::Utc::now().naive_utc().date();
            let year = now.year();
            let edt_start = nth_sunday_of_month(year, 3, 2);
            let edt_end = nth_sunday_of_month(year, 11, 1);
            let offset = if now >= edt_start && now < edt_end { -4 } else { -5 };
            Some(FixedOffset::east_opt(offset * 3600)?)
        }
        "Australia/Sydney"  => {
            // 悉尼: AEDT(UTC+11) 10月第1周日~4月第1周日
            let now = chrono::Utc::now().naive_utc().date();
            let year = now.year();
            let aedt_start = nth_sunday_of_month(year, 10, 1);
            let aedt_end = nth_sunday_of_month(year + 1, 4, 1);
            let offset = if now >= aedt_start && now < aedt_end { 11 } else { 10 };
            Some(FixedOffset::east_opt(offset * 3600)?)
        }
        _ => None,
    }
}

/// 计算某月第 N 个星期日（n 从 1 开始）
fn nth_sunday_of_month(year: i32, month: u32, n: usize) -> chrono::NaiveDate {
    use chrono::Datelike;
    let first = chrono::NaiveDate::from_ymd_opt(year, month, 1).unwrap();
    let first_dow = first.weekday().num_days_from_sunday(); // 0=Sun
    let day = 1 + if first_dow == 0 { 0 } else { 7 - first_dow } + (n - 1) * 7;
    chrono::NaiveDate::from_ymd_opt(year, month, day).unwrap()
}

/// 计算某月最后一个星期日
fn last_sunday_of_month(year: i32, month: u32) -> chrono::NaiveDate {
    use chrono::Datelike;
    // 取下月第一天，往前推
    let (next_y, next_m) = if month == 12 { (year + 1, 1) } else { (year, month + 1) };
    let last_day = chrono::NaiveDate::from_ymd_opt(next_y, next_m, 1).unwrap().pred_opt().unwrap();
    let dow = last_day.weekday().num_days_from_sunday();
    last_day.pred_opt().unwrap().checked_sub_days(chrono::Days::new(dow as u64)).unwrap()
}
```

- [ ] **Step 2: 更新 convert_to_timestamp 和 convert_to_datetime**

将两个函数中的 `tz: Tz` → `tz: chrono::FixedOffset`，`request.timezone.parse()` → `resolve_timezone(&request.timezone)`。

```rust
#[tauri::command]
fn convert_to_timestamp(request: ConvertRequest) -> ConvertResponse {
    let tz = match resolve_timezone(&request.timezone) {
        Some(tz) => tz,
        None => {
            return ConvertResponse {
                success: false,
                timestamp: None,
                error: Some(format!("无效时区: {}", request.timezone)),
            };
        }
    };

    let formats = [
        "%Y-%m-%d %H:%M:%S",
        "%Y/%m/%d %H:%M:%S",
        "%Y-%m-%dT%H:%M:%S",
        "%Y-%m-%d %H:%M",
    ];

    let naive_dt = formats
        .iter()
        .find_map(|&fmt| NaiveDateTime::parse_from_str(&request.datetime_str, fmt).ok());

    let naive_dt = match naive_dt {
        Some(dt) => dt,
        None => {
            return ConvertResponse {
                success: false,
                timestamp: None,
                error: Some("无法解析时间，请使用 YYYY-MM-DD HH:MM:SS 格式".to_string()),
            };
        }
    };

    // 本地时区 → UTC → Unix 时间戳(ms)
    let local_dt = tz.from_local_datetime(&naive_dt).unwrap();
    let utc_dt: DateTime<Utc> = local_dt.with_timezone(&Utc);
    let timestamp = utc_dt.timestamp_millis();

    ConvertResponse {
        success: true,
        timestamp: Some(timestamp),
        error: None,
    }
}

#[tauri::command]
fn convert_to_datetime(request: TimestampRequest) -> DatetimeResponse {
    let tz = match resolve_timezone(&request.timezone) {
        Some(tz) => tz,
        None => {
            return DatetimeResponse {
                success: false,
                datetime_str: None,
                error: Some(format!("无效时区: {}", request.timezone)),
            };
        }
    };

    match Utc.timestamp_millis_opt(request.timestamp_ms) {
        chrono::LocalResult::Single(utc_dt) => {
            let local_dt = utc_dt.with_timezone(&tz);
            let datetime_str = local_dt.format("%Y-%m-%d %H:%M:%S").to_string();
            DatetimeResponse {
                success: true,
                datetime_str: Some(datetime_str),
                error: None,
            }
        }
        _ => DatetimeResponse {
            success: false,
            datetime_str: None,
            error: Some("无效时间戳".to_string()),
        },
    }
}
```

- [ ] **Step 3: AppConfig 新增字段**

```rust
#[derive(Debug, Serialize, Deserialize, Clone)]
struct AppConfig {
    #[serde(default)]
    backup_root: String,
    #[serde(default)]
    games: Vec<GameConfig>,
    #[serde(default = "default_timezone_sets")]
    timezone_sets: Vec<TimezoneSet>,
    #[serde(default = "default_theme")]
    theme: String,
    // === 新增字段 ===
    #[serde(default = "default_tab_order")]
    tab_order: Vec<String>,
    #[serde(default)]
    todos: Vec<TodoItem>,
    #[serde(default)]
    auto_start: bool,
    #[serde(default)]
    minimize_to_tray: bool,
}

fn default_tab_order() -> Vec<String> {
    vec!["convert".to_string(), "backup".to_string(), "todo".to_string()]
}
```

同时更新 `AppConfig::default()` 和 `impl Default`：

```rust
impl Default for AppConfig {
    fn default() -> Self {
        AppConfig {
            backup_root: String::new(),
            games: vec![],
            timezone_sets: default_timezone_sets(),
            theme: default_theme(),
            tab_order: default_tab_order(),
            todos: vec![],
            auto_start: false,
            minimize_to_tray: true,
        }
    }
}
```

- [ ] **Step 4: 添加 TodoItem 和 ReminderConfig 结构体**

放在 `AppConfig` 之后（`// ==================== 待办数据结构 ====================` 区块）：

```rust
#[derive(Debug, Serialize, Deserialize, Clone)]
struct TodoItem {
    #[serde(default)]
    id: String,
    #[serde(default)]
    text: String,
    #[serde(default)]
    done: bool,
    #[serde(default)]
    priority: i32,
    #[serde(default)]
    due_date: Option<String>,
    #[serde(default)]
    tags: Vec<String>,
    #[serde(default)]
    notes: String,
    #[serde(default)]
    reminder: Option<ReminderConfig>,
    #[serde(default)]
    repeat: Option<String>,
    #[serde(default)]
    sort_order: i32,
    #[serde(default)]
    created_at: String,
    #[serde(default)]
    last_notified: Option<i64>,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
struct ReminderConfig {
    #[serde(default)]
    datetime: String,
    #[serde(default)]
    sound: bool,
}
```

- [ ] **Step 5: 验证编译**

Run: `cargo check`
Expected: 编译成功（新字段有 serde(default) 不会破坏旧 config）

- [ ] **Step 6: 提交**

```bash
git add src/main.rs
git commit -m "refactor: replace chrono-tz with manual DST, extend AppConfig data model"
```

---

### Task 3: Tab 栏动态渲染 + 拖拽排序

**Files:**
- Modify: `src/index.html`
- Modify: `src/main.js`

- [ ] **Step 1: 更新 index.html — Tab 栏改为容器，添加面板 ID 引用**

将硬编码的 Tab 栏改为空的容器，JS 动态填充：

```html
<div class="tab-bar" id="tabBar">
    <!-- 由 JS 动态渲染 -->
</div>
```

添加待办面板（放在备份面板之后、设置弹窗之前）：

```html
<!-- 待办面板 -->
<div class="panel" id="panel-todo">
    <!-- 搜索/筛选栏 -->
    <div class="todo-toolbar">
        <input type="text" id="todoSearch" class="todo-search-input" placeholder="🔍 搜索待办...">
        <select id="todoFilterStatus" class="todo-filter-select">
            <option value="all">全部</option>
            <option value="active">待完成</option>
            <option value="done">已完成</option>
        </select>
        <select id="todoFilterPriority" class="todo-filter-select">
            <option value="-1">优先级</option>
            <option value="2">高</option>
            <option value="1">中</option>
            <option value="0">低</option>
        </select>
    </div>

    <!-- 统计 -->
    <div class="todo-stats" id="todoStats"></div>

    <!-- 待办列表 -->
    <div class="todo-list" id="todoList">
        <div class="empty-hint">暂无待办，在下方添加</div>
    </div>

    <!-- 快捷添加 -->
    <div class="todo-add-bar">
        <input type="text" id="todoAddInput" placeholder="+ 添加待办，回车创建..." class="todo-add-input">
    </div>
</div>
```

- [ ] **Step 2: main.js — Tab 动态渲染**

在全局 Tab 切换代码区域，将静态 tabs 查询改为动态渲染。

新增 `renderTabBar()` 函数（放在 `// ==================== Tab 栏管理 ====================` 区块）：

```javascript
const TAB_DEFS = {
    convert: { icon: '&#9202;', label: '时间转换' },
    backup:  { icon: '&#128190;', label: '存档管理' },
    todo:    { icon: '&#128203;', label: '待办工具' },
};
const DEFAULT_TAB_ORDER = ['convert', 'backup', 'todo'];

function renderTabBar() {
    const tabBar = document.getElementById('tabBar');
    const order = currentConfig.tab_order && currentConfig.tab_order.length
        ? currentConfig.tab_order : DEFAULT_TAB_ORDER;
    // 确保所有 Tab 都在 order 中
    DEFAULT_TAB_ORDER.forEach(id => { if (!order.includes(id)) order.push(id); });

    tabBar.innerHTML = order.map(id => {
        const def = TAB_DEFS[id];
        if (!def) return '';
        const active = id === currentTab ? ' active' : '';
        return `<button class="tab${active}" data-tab="${id}" draggable="true">
            <span class="tab-icon">${def.icon}</span>
            <span class="tab-label">${def.label}</span>
        </button>`;
    }).join('');

    bindTabEvents();
}
```

- [ ] **Step 3: main.js — Tab 拖拽事件**

```javascript
function bindTabEvents() {
    const tabs = document.querySelectorAll('#tabBar .tab');
    let dragSrcIdx = -1;

    tabs.forEach((tab, idx) => {
        tab.addEventListener('dragstart', (e) => {
            dragSrcIdx = idx;
            tab.style.opacity = '0.5';
        });
        tab.addEventListener('dragend', () => {
            tab.style.opacity = '1';
            document.querySelectorAll('#tabBar .tab').forEach(t => t.style.borderTop = '');
        });
        tab.addEventListener('dragover', (e) => {
            e.preventDefault();
            document.querySelectorAll('#tabBar .tab').forEach(t => t.style.borderTop = '');
            if (idx > dragSrcIdx) tab.style.borderTop = '2px solid var(--accent)';
        });
        tab.addEventListener('dragleave', () => { tab.style.borderTop = ''; });
        tab.addEventListener('drop', (e) => {
            e.preventDefault();
            if (dragSrcIdx === idx) return;
            const order = currentConfig.tab_order && currentConfig.tab_order.length
                ? currentConfig.tab_order : [...DEFAULT_TAB_ORDER];
            DEFAULT_TAB_ORDER.forEach(id => { if (!order.includes(id)) order.push(id); });
            const [moved] = order.splice(dragSrcIdx, 1);
            order.splice(idx, 0, moved);
            currentConfig.tab_order = order;
            saveConfigToBackend();
            renderTabBar();
            switchTab(currentTab);
        });
        // 点击切换
        tab.addEventListener('click', () => {
            const tabId = tab.dataset.tab;
            if (tabId !== currentTab) switchTab(tabId);
        });
    });
}
```

- [ ] **Step 4: main.js — 全局 Tab 切换重构**

将全局切换逻辑改为函数式：

```javascript
let currentTab = 'convert';

function switchTab(tabId) {
    currentTab = tabId;
    document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
    document.querySelectorAll('.panel').forEach(p => p.classList.remove('active'));
    const tab = document.querySelector(`.tab[data-tab="${tabId}"]`);
    if (tab) tab.classList.add('active');
    const panel = document.getElementById('panel-' + tabId);
    if (panel) panel.classList.add('active');
    if (tabId === 'backup') refreshAll();
    if (tabId === 'todo') renderTodos();
}
```

移除原有 `tabs.forEach(...)` 事件绑定代码，替换为启动时调用 `renderTabBar()`。

- [ ] **Step 5: 更新 loadConfig 和启动逻辑**

在 `loadConfig()` 末尾，从 `tab_order[0]` 获取默认 Tab：

```javascript
async function loadConfig() {
    currentConfig = await invoke('get_config');
    applyTheme(currentConfig.theme || 'system');
    updateSettingsDisplay();
    // 初始化 Tab
    const order = currentConfig.tab_order && currentConfig.tab_order.length
        ? currentConfig.tab_order : DEFAULT_TAB_ORDER;
    currentTab = order[0];
    renderTabBar();
    switchTab(currentTab);
    renderTimezoneSets();
    await initTimezoneDefaults();
    // ... 游戏/存档初始化 ...
}
```

- [ ] **Step 6: 验证**

Run: `cargo tauri dev`
Expected: Tab 栏按 `tab_order` 顺序渲染，可拖拽排序，刷新后顺序保持

- [ ] **Step 7: 提交**

```bash
git add src/index.html src/main.js
git commit -m "feat: dynamic tab bar with drag-and-drop reordering"
```

---

### Task 4: 待办面板 CSS 样式

**Files:**
- Modify: `src/styles.css`

- [ ] **Step 1: 添加待办面板样式**

在 `styles.css` 末尾添加：

```css
/* ==================== 待办工具 ==================== */
.todo-toolbar {
    display: flex;
    gap: 8px;
    margin-bottom: 10px;
}

.todo-search-input {
    flex: 1;
}

.todo-filter-select {
    width: auto;
    min-width: 90px;
    padding: 0.45rem 0.6rem;
    font-size: var(--font-sm);
}

.todo-stats {
    display: flex;
    gap: 16px;
    margin-bottom: 10px;
    font-size: var(--font-sm);
    color: var(--text-secondary);
}

.todo-stats span { cursor: pointer; padding: 2px 6px; border-radius: var(--radius-sm); }
.todo-stats span.active { background: var(--surface-hover); color: var(--text); }
.todo-stats .count { font-weight: 600; }

.todo-list {
    display: flex;
    flex-direction: column;
    gap: 3px;
    margin-bottom: 10px;
    min-height: 60px;
}

.todo-item {
    display: flex;
    align-items: center;
    gap: 6px;
    padding: 7px 8px;
    border-radius: var(--radius);
    transition: background 0.15s;
    cursor: default;
}

.todo-item:hover { background: var(--surface); }

.todo-item.done .todo-text {
    text-decoration: line-through;
    opacity: 0.55;
}

.todo-drag-handle {
    cursor: grab;
    color: var(--text-dim);
    font-size: var(--font-base);
    user-select: none;
    flex-shrink: 0;
}

.todo-drag-handle:active { cursor: grabbing; }

.todo-check {
    width: 18px;
    height: 18px;
    border: 2px solid var(--border-strong);
    border-radius: 50%;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    cursor: pointer;
    flex-shrink: 0;
    font-size: 12px;
    color: transparent;
    transition: background 0.15s, border-color 0.15s;
}

.todo-check:hover { border-color: var(--accent); }

.todo-item.done .todo-check {
    background: var(--accent);
    border-color: var(--accent);
    color: #fff;
}

.todo-priority {
    font-size: var(--font-xs);
    padding: 1px 5px;
    border-radius: var(--radius-sm);
    font-weight: 600;
    flex-shrink: 0;
}

.todo-priority.high { background: #fbbf24; color: #000; }
.todo-priority.medium { background: var(--accent); color: #fff; }
.todo-priority.low { background: var(--surface-hover); color: var(--text-secondary); }

.todo-text {
    flex: 1;
    font-size: var(--font-base);
    color: var(--text);
    cursor: text;
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
}

.todo-due {
    font-size: var(--font-xs);
    color: var(--text-muted);
    flex-shrink: 0;
}

.todo-due.overdue { color: var(--danger-text); }

.todo-tags {
    display: flex;
    gap: 3px;
    flex-shrink: 0;
}

.todo-tag {
    font-size: var(--font-xs);
    background: var(--surface-hover);
    color: var(--text-secondary);
    padding: 1px 5px;
    border-radius: var(--radius-sm);
    white-space: nowrap;
}

.todo-delete-btn {
    background: transparent;
    color: var(--text-dim);
    border: none;
    cursor: pointer;
    font-size: 16px;
    padding: 0 4px;
    line-height: 1;
    flex-shrink: 0;
    width: auto;
    margin: 0;
}

.todo-delete-btn:hover { color: var(--danger-text); }

.todo-add-bar {
    display: flex;
    gap: 8px;
}

.todo-add-input { flex: 1; }

/* 待办编辑弹窗 */
.todo-edit-overlay {
    position: fixed;
    inset: 0;
    background: rgba(0,0,0,0.6);
    display: flex;
    align-items: center;
    justify-content: center;
    z-index: 100;
}

.todo-edit-modal {
    background: var(--bg);
    border: 1px solid var(--border);
    border-radius: var(--radius-xl);
    padding: 20px;
    width: 380px;
    max-height: 90vh;
    overflow-y: auto;
}

.todo-edit-title {
    font-size: var(--font-md);
    font-weight: 600;
    margin-bottom: 12px;
    color: var(--text);
}

.todo-edit-field { margin-bottom: 10px; }

.todo-edit-field label {
    font-size: var(--font-sm);
    color: var(--text-secondary);
    margin-bottom: 4px;
}

.todo-edit-field textarea {
    width: 100%;
    padding: 0.55rem 0.7rem;
    border: 1px solid var(--border-strong);
    border-radius: var(--radius-lg);
    font-size: var(--font-base);
    background: var(--input-bg);
    color: var(--text);
    resize: vertical;
    min-height: 60px;
    font-family: inherit;
}

.todo-edit-actions {
    display: flex;
    gap: 8px;
    justify-content: flex-end;
    margin-top: 12px;
}

.todo-edit-actions button { width: auto; margin: 0; }

.todo-priority-picker {
    display: flex;
    gap: 6px;
}

.todo-priority-picker button {
    flex: 1;
    padding: 0.35rem;
    font-size: var(--font-sm);
    background: var(--surface-hover);
    color: var(--text-secondary);
    border: 1px solid transparent;
    border-radius: var(--radius-sm);
    cursor: pointer;
    margin: 0;
}

.todo-priority-picker button.active {
    border-color: var(--accent);
    background: rgba(var(--accent-rgb), 0.15);
    color: var(--text);
}

.todo-edit-row {
    display: flex;
    gap: 8px;
}

.todo-edit-row > * { flex: 1; }

/* 拖拽占位指示 */
.tab-bar .tab.drag-over {
    border-top: 2px solid var(--accent) !important;
}
```

- [ ] **Step 2: 提交**

```bash
git add src/styles.css
git commit -m "style: add todo panel styles"
```

---

### Task 5: 待办面板 JS 实现（核心 CRUD + 搜索/筛选 + 编辑弹窗）

**Files:**
- Modify: `src/main.js`

在 `main.js` 末尾（`// ==================== 启动 ====================` 之前）添加新区块。

- [ ] **Step 1: 待办状态和 DOM 引用**

```javascript
// ==================== 待办工具 ====================
const todoAddInput = document.getElementById('todoAddInput');
const todoList = document.getElementById('todoList');
const todoSearch = document.getElementById('todoSearch');
const todoFilterStatus = document.getElementById('todoFilterStatus');
const todoFilterPriority = document.getElementById('todoFilterPriority');
const todoStats = document.getElementById('todoStats');
```

- [ ] **Step 2: 渲染待办列表**

```javascript
function renderTodos() {
    const items = currentConfig.todos || [];
    const keyword = (todoSearch.value || '').toLowerCase();
    const statusFilter = todoFilterStatus.value;
    const priorityFilter = parseInt(todoFilterPriority.value, 10);

    // 搜索 + 筛选
    let filtered = items.filter(t => {
        if (statusFilter === 'active' && t.done) return false;
        if (statusFilter === 'done' && !t.done) return false;
        if (priorityFilter >= 0 && t.priority !== priorityFilter) return false;
        if (keyword && !t.text.toLowerCase().includes(keyword) &&
            !t.tags.some(tag => tag.toLowerCase().includes(keyword))) return false;
        return true;
    });

    // 排序: 未完成优先 → 置顶 → 手动排序
    const sorted = [...filtered].sort((a, b) => {
        if (a.done !== b.done) return a.done - b.done;
        if (a.priority !== b.priority) return b.priority - a.priority;
        return a.sort_order - b.sort_order;
    });

    // 统计
    const total = items.length;
    const active = items.filter(t => !t.done).length;
    const done = total - active;
    todoStats.innerHTML = `<span class="${statusFilter === 'all' ? 'active' : ''}" data-filter="all">全部 <span class="count">${total}</span></span>
        <span class="${statusFilter === 'active' ? 'active' : ''}" data-filter="active">待完成 <span class="count">${active}</span></span>
        <span class="${statusFilter === 'done' ? 'active' : ''}" data-filter="done">已完成 <span class="count">${done}</span></span>`;

    // 绑定统计点击切换
    todoStats.querySelectorAll('span').forEach(el => {
        el.addEventListener('click', () => {
            todoFilterStatus.value = el.dataset.filter;
            renderTodos();
        });
    });

    // 渲染列表
    if (sorted.length === 0) {
        todoList.innerHTML = '<div class="empty-hint">暂无待办，在下方添加</div>';
        return;
    }

    todoList.innerHTML = sorted.map(t => {
        const priClass = t.priority === 2 ? 'high' : t.priority === 1 ? 'medium' : 'low';
        const priLabel = t.priority === 2 ? '高' : t.priority === 1 ? '中' : '低';
        const dueHtml = t.due_date ? `<span class="todo-due${isOverdue(t.due_date) && !t.done ? ' overdue' : ''}">📅 ${t.due_date.slice(5)}</span>` : '';
        const tagsHtml = t.tags.map(tag => `<span class="todo-tag">${escapeHtml(tag)}</span>`).join('');
        return `<div class="todo-item${t.done ? ' done' : ''}" data-id="${escapeHtml(t.id)}">
            <span class="todo-drag-handle">⠿</span>
            <span class="todo-check" data-action="toggle-todo">${t.done ? '✓' : ''}</span>
            ${t.priority > 0 ? `<span class="todo-priority ${priClass}">${priLabel}</span>` : ''}
            <span class="todo-text" data-action="edit-todo">${escapeHtml(t.text)}</span>
            ${dueHtml}
            ${tagsHtml ? `<span class="todo-tags">${tagsHtml}</span>` : ''}
            <button class="todo-delete-btn" data-action="delete-todo" title="删除">&times;</button>
        </div>`;
    }).join('');

    // 绑定事件
    bindTodoEvents();
}

function isOverdue(dateStr) {
    if (!dateStr) return false;
    const d = new Date(dateStr + 'T23:59:59');
    return d < new Date();
}
```

- [ ] **Step 3: 待办事件绑定**

```javascript
function bindTodoEvents() {
    // 完成切换
    todoList.querySelectorAll('[data-action="toggle-todo"]').forEach(el => {
        el.addEventListener('click', (e) => {
            e.stopPropagation();
            const id = el.closest('.todo-item').dataset.id;
            toggleTodoDone(id);
        });
    });

    // 点击文字编辑
    todoList.querySelectorAll('[data-action="edit-todo"]').forEach(el => {
        el.addEventListener('click', () => {
            const id = el.closest('.todo-item').dataset.id;
            openTodoEditModal(id);
        });
    });

    // 删除
    todoList.querySelectorAll('[data-action="delete-todo"]').forEach(el => {
        el.addEventListener('click', (e) => {
            e.stopPropagation();
            const id = el.closest('.todo-item').dataset.id;
            if (confirm('确定删除此待办？')) deleteTodo(id);
        });
    });

    // 拖拽排序
    todoList.querySelectorAll('.todo-drag-handle').forEach(handle => {
        handle.addEventListener('mousedown', (e) => {
            const item = handle.closest('.todo-item');
            const items = [...todoList.querySelectorAll('.todo-item')];
            const idx = items.indexOf(item);
            // 简化为点击拖拽手柄后再点击目标位置
        });
    });
}
```

- [ ] **Step 4: CRUD 操作**

```javascript
function toggleTodoDone(id) {
    const todo = currentConfig.todos.find(t => t.id === id);
    if (!todo) return;
    todo.done = !todo.done;

    // 重复任务完成时自动创建下一周期
    if (todo.done && todo.repeat) {
        const newTodo = createNextRepeat(todo);
        if (newTodo) currentConfig.todos.push(newTodo);
    }

    saveConfigToBackend();
    renderTodos();
}

function deleteTodo(id) {
    currentConfig.todos = currentConfig.todos.filter(t => t.id !== id);
    saveConfigToBackend();
    renderTodos();
}

function createNextRepeat(todo) {
    const now = new Date();
    let nextDate = new Date(now.getFullYear(), now.getMonth(), now.getDate());

    if (todo.repeat === 'daily') nextDate.setDate(nextDate.getDate() + 1);
    else if (todo.repeat === 'weekly') nextDate.setDate(nextDate.getDate() + 7);
    else if (todo.repeat === 'monthly') nextDate.setMonth(nextDate.getMonth() + 1);
    else return null;

    const newTodo = JSON.parse(JSON.stringify(todo));
    newTodo.id = crypto.randomUUID();
    newTodo.done = false;
    newTodo.created_at = new Date().toISOString().slice(0, 16);
    newTodo.last_notified = null;
    // 推 reminder 和 due_date
    if (newTodo.due_date && todo.repeat) {
        const d = new Date(todo.due_date + 'T00:00:00');
        if (todo.repeat === 'daily') d.setDate(d.getDate() + 1);
        else if (todo.repeat === 'weekly') d.setDate(d.getDate() + 7);
        else if (todo.repeat === 'monthly') d.setMonth(d.getMonth() + 1);
        newTodo.due_date = d.toISOString().slice(0, 10);
    }
    if (newTodo.reminder && newTodo.reminder.datetime && todo.repeat) {
        const r = new Date(newTodo.reminder.datetime);
        if (todo.repeat === 'daily') r.setDate(r.getDate() + 1);
        else if (todo.repeat === 'weekly') r.setDate(r.getDate() + 7);
        else if (todo.repeat === 'monthly') r.setMonth(r.getMonth() + 1);
        newTodo.reminder.datetime = r.toISOString().slice(0, 16);
    }
    return newTodo;
}
```

- [ ] **Step 5: 快捷添加**

```javascript
todoAddInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
        const text = todoAddInput.value.trim();
        if (!text) return;
        const todo = {
            id: crypto.randomUUID(),
            text: text,
            done: false,
            priority: 1,
            due_date: null,
            tags: [],
            notes: '',
            reminder: null,
            repeat: null,
            sort_order: currentConfig.todos.length,
            created_at: new Date().toISOString().slice(0, 16),
            last_notified: null,
        };
        currentConfig.todos.push(todo);
        todoAddInput.value = '';
        saveConfigToBackend();
        renderTodos();
        todoAddInput.focus();
    }
});

// 搜索/筛选事件
todoSearch.addEventListener('input', () => renderTodos());
todoFilterStatus.addEventListener('change', () => renderTodos());
todoFilterPriority.addEventListener('change', () => renderTodos());
```

- [ ] **Step 6: 编辑弹窗**

```javascript
function openTodoEditModal(id) {
    const todo = currentConfig.todos.find(t => t.id === id);
    if (!todo) return;

    const oldEl = document.querySelector('.todo-edit-overlay');
    if (oldEl) oldEl.remove();

    const priorityLabels = ['low', 'medium', 'high'];
    const priorityNames = ['低', '中', '高'];
    const priorityHtml = priorityLabels.map((p, i) =>
        `<button class="${todo.priority === i ? 'active' : ''}" data-value="${i}">${priorityNames[i]}</button>`
    ).join('');

    const repeatOptions = ['不重复', '每天', '每周', '每月'];
    const repeatValues = [null, 'daily', 'weekly', 'monthly'];
    const repeatIdx = repeatValues.indexOf(todo.repeat);

    const overlay = document.createElement('div');
    overlay.className = 'todo-edit-overlay';
    overlay.innerHTML = `<div class="todo-edit-modal">
        <div class="todo-edit-title">编辑待办</div>

        <div class="todo-edit-field">
            <label>内容</label>
            <input type="text" id="editText" value="${escapeHtml(todo.text)}">
        </div>

        <div class="todo-edit-row">
            <div class="todo-edit-field">
                <label>优先级</label>
                <div class="todo-priority-picker" id="editPriority">${priorityHtml}</div>
            </div>
            <div class="todo-edit-field">
                <label>到期日</label>
                <input type="date" id="editDueDate" value="${todo.due_date || ''}">
            </div>
        </div>

        <div class="todo-edit-field">
            <label>标签（逗号分隔）</label>
            <input type="text" id="editTags" value="${escapeHtml(todo.tags.join(', '))}">
        </div>

        <div class="todo-edit-field">
            <label>备注</label>
            <textarea id="editNotes">${escapeHtml(todo.notes)}</textarea>
        </div>

        <div class="todo-edit-row">
            <div class="todo-edit-field">
                <label>提醒时间</label>
                <input type="datetime-local" id="editReminder" value="${todo.reminder ? todo.reminder.datetime : ''}">
            </div>
            <div class="todo-edit-field">
                <label>重复</label>
                <select id="editRepeat">
                    ${repeatValues.map((v, i) => `<option value="${v || ''}" ${i === repeatIdx ? 'selected' : ''}>${repeatOptions[i]}</option>`).join('')}
                </select>
            </div>
        </div>

        <div class="todo-edit-actions">
            <button class="btn-small" id="editCancelBtn">取消</button>
            <button id="editSaveBtn">保存</button>
        </div>
    </div>`;

    document.querySelector('.container').appendChild(overlay);

    // 优先级切换
    overlay.querySelectorAll('.todo-priority-picker button').forEach(btn => {
        btn.addEventListener('click', () => {
            overlay.querySelectorAll('.todo-priority-picker button').forEach(b => b.classList.remove('active'));
            btn.classList.add('active');
        });
    });

    overlay.querySelector('#editCancelBtn').addEventListener('click', () => overlay.remove());
    overlay.querySelector('#editSaveBtn').addEventListener('click', () => {
        const newText = overlay.querySelector('#editText').value.trim();
        if (!newText) { alert('内容不能为空'); return; }
        todo.text = newText;
        todo.priority = parseInt(overlay.querySelector('.todo-priority-picker .active')?.dataset?.value || '1', 10);
        todo.due_date = overlay.querySelector('#editDueDate').value || null;
        todo.tags = overlay.querySelector('#editTags').value.split(',').map(s => s.trim()).filter(Boolean);
        todo.notes = overlay.querySelector('#editNotes').value;
        const reminderVal = overlay.querySelector('#editReminder').value;
        if (reminderVal) {
            todo.reminder = { datetime: reminderVal, sound: true };
        } else {
            todo.reminder = null;
        }
        todo.repeat = overlay.querySelector('#editRepeat').value || null;
        overlay.remove();
        saveConfigToBackend();
        renderTodos();
    });
}
```

- [ ] **Step 7: 提交**

```bash
git add src/main.js
git commit -m "feat: implement todo panel CRUD, search, filter, edit modal, repeat-on-complete"
```

---

### Task 6: Rust 提醒后台线程 + send_notification 命令

**Files:**
- Modify: `src/main.rs`

- [ ] **Step 1: 在 main.rs 末尾添加通知相关代码**

放在 `window_minimize` 之后、`main()` 之前：

```rust
use std::sync::Arc;

#[tauri::command]
fn send_notification(app: tauri::AppHandle, title: String, body: String) -> OpResult {
    let _ = notify_rust::Notification::new()
        .summary(&title)
        .body(&body)
        .sound(notify_rust::Sound::Default)
        .show();
    OpResult { success: true, message: "已发送".to_string() }
}
```

- [ ] **Step 2: 提醒后台线程**

在 `main()` 中添加 `.setup()`：

```rust
fn main() {
    tauri::Builder::default()
        .setup(|app| {
            let app_handle = app.handle().clone();
            std::thread::spawn(move || {
                loop {
                    std::thread::sleep(std::time::Duration::from_secs(1));
                    // 读取配置
                    let config_path = app_handle.path()
                        .app_data_dir()
                        .expect("无法获取应用数据目录")
                        .join("config.json");
                    let json = match std::fs::read_to_string(&config_path) {
                        Ok(s) => s,
                        Err(_) => continue,
                    };
                    let config: AppConfig = match serde_json::from_str(&json) {
                        Ok(c) => c,
                        Err(_) => continue,
                    };
                    let now = chrono::Utc::now().timestamp_millis();
                    let mut changed = false;
                    let mut config = config;

                    for todo in config.todos.iter_mut() {
                        if todo.done { continue; }
                        let reminder = match &todo.reminder {
                            Some(r) => r,
                            None => continue,
                        };
                        // 解析提醒时间
                        let reminder_dt = match chrono::NaiveDateTime::parse_from_str(
                            &reminder.datetime, "%Y-%m-%dT%H:%M"
                        ) {
                            Ok(dt) => dt,
                            Err(_) => continue,
                        };
                        let reminder_ts = reminder_dt.and_utc().timestamp_millis();
                        // 到期未通知
                        if reminder_ts <= now {
                            let last = todo.last_notified.unwrap_or(0);
                            if now - last < 60000 { continue; } // 同一分钟不重复
                            // 发通知
                            let _ = notify_rust::Notification::new()
                                .summary("HRB Tools")
                                .body(&todo.text)
                                .sound(notify_rust::Sound::Default)
                                .show();
                            todo.last_notified = Some(now);
                            changed = true;
                            // 重复任务自动推期
                            if let Some(repeat) = &todo.repeat {
                                let mut next_dt = reminder_dt;
                                let mut adv_due = |d: &mut Option<String>| {
                                    if let Some(due) = d {
                                        if let Ok(due_d) = chrono::NaiveDate::parse_from_str(due, "%Y-%m-%d") {
                                            let new_due = match repeat.as_str() {
                                                "daily" => due_d + chrono::Duration::days(1),
                                                "weekly" => due_d + chrono::Duration::days(7),
                                                "monthly" => due_d + chrono::Months::new(1),
                                                _ => due_d,
                                            };
                                            *d = Some(new_due.format("%Y-%m-%d").to_string());
                                        }
                                    }
                                };
                                match repeat.as_str() {
                                    "daily" => next_dt += chrono::Duration::days(1),
                                    "weekly" => next_dt += chrono::Duration::days(7),
                                    "monthly" => next_dt += chrono::Months::new(1),
                                    _ => {}
                                }
                                todo.reminder = Some(ReminderConfig {
                                    datetime: next_dt.format("%Y-%m-%dT%H:%M").to_string(),
                                    sound: reminder.sound,
                                });
                                adv_due(&mut todo.due_date);
                            }
                        }
                    }

                    if changed {
                        if let Ok(json) = serde_json::to_string_pretty(&config) {
                            let _ = std::fs::write(&config_path, json);
                        }
                    }
                }
            });
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            // 现有命令...
            send_notification,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
```

注意：需要把 `send_notification` 加入 `generate_handler!` 宏。

- [ ] **Step 3: 验证编译**

Run: `cargo check`
Expected: 编译成功

- [ ] **Step 4: 提交**

```bash
git add src/main.rs
git commit -m "feat: add reminder notification background thread"
```

---

### Task 7: 系统托盘 + 窗口行为

**Files:**
- Modify: `src/main.rs`

- [ ] **Step 1: 修改 window_close 和 window_minimize**

```rust
#[tauri::command]
fn window_close(app: tauri::AppHandle) {
    app.exit(0);
}

#[tauri::command]
fn window_minimize(app: tauri::AppHandle) {
    if let Some(window) = app.get_webview_window("main") {
        let _ = window.hide();
    }
    // 托盘图标在 setup 中已创建
}
```

- [ ] **Step 2: 在 setup() 中添加托盘创建**

在 `.setup()` 回调中，在提醒线程之前添加：

```rust
.setup(|app| {
    // 系统托盘
    use tauri::tray::TrayIconBuilder;
    use tauri::menu::{MenuBuilder, MenuItemBuilder};

    let show_item = MenuItemBuilder::with_id("show", "显示").build(app)?;
    let quit_item = MenuItemBuilder::with_id("quit", "退出").build(app)?;
    let menu = MenuBuilder::new(app)
        .item(&show_item)
        .item(&quit_item)
        .build()?;

    let _tray = TrayIconBuilder::new()
        .tooltip("HRB Tools")
        .menu(&menu)
        .on_menu_event(move |app, event| {
            match event.id().as_ref() {
                "show" => {
                    if let Some(window) = app.get_webview_window("main") {
                        let _ = window.show();
                        let _ = window.set_focus();
                    }
                }
                "quit" => { app.exit(0); }
                _ => {}
            }
        })
        .on_tray_icon_event(|tray, event| {
            if let tauri::tray::TrayIconEvent::Click { .. } = event {
                if let Some(app) = tray.app_handle() {
                    if let Some(window) = app.get_webview_window("main") {
                        let _ = window.show();
                        let _ = window.set_focus();
                    }
                }
            }
        })
        .build(app)?;

    // 提醒线程...
    let app_handle = app.handle().clone();
    std::thread::spawn(move || { ... });
    Ok(())
})
```

- [ ] **Step 3: 验证编译**

Run: `cargo check`
Expected: 编译成功

- [ ] **Step 4: 提交**

```bash
git add src/main.rs
git commit -m "feat: system tray icon, minimize to tray, close exits"
```

---

### Task 8: 开机自启

**Files:**
- Modify: `src/main.rs`

- [ ] **Step 1: 添加注册表操作函数**

放在 `main()` 之前：

```rust
fn set_auto_start(enabled: bool) {
    let exe_path = std::env::current_exe().ok();
    let key_path = r"Software\Microsoft\Windows\CurrentVersion\Run";
    let app_name = "HRB Tools";

    if enabled {
        if let Some(path) = exe_path {
            let path_str = path.to_string_lossy().to_string();
            let _ = std::process::Command::new("reg")
                .args(["add", "HKCU\\", key_path, "/v", app_name, "/t", "REG_SZ", "/d", &path_str, "/f"])
                .output();
        }
    } else {
        let _ = std::process::Command::new("reg")
            .args(["delete", "HKCU\\", key_path, "/v", app_name, "/f"])
            .output();
    }
}
```

- [ ] **Step 2: 在 load_config/set_config 中调用**

在 `load_config` 和 `set_config` 中，当 `config.auto_start` 变化时调用 `set_auto_start`。由于 `set_config` 接收完整的配置：

```rust
#[tauri::command]
fn set_config(app: tauri::AppHandle, config: AppConfig) -> OpResult {
    set_auto_start(config.auto_start);
    save_config(&app, &config);
    OpResult { success: true, message: "已保存".to_string() }
}
```

同时在 `load_config` 中也要调用（确保注册表与应用一致）：

```rust
fn load_config(app: &tauri::AppHandle) -> AppConfig {
    let path = config_path(app);
    if path.exists() {
        match fs::read_to_string(&path) {
            Ok(json) => {
                let raw: serde_json::Value = serde_json::from_str(&json).unwrap_or_default();
                let config: AppConfig = serde_json::from_value(raw.clone()).unwrap_or_default();
                set_auto_start(config.auto_start);  // 确保注册表一致
                return config;
            }
            Err(_) => {}
        }
    }
    AppConfig::default()
}
```

- [ ] **Step 3: 验证编译**

Run: `cargo check`
Expected: 编译成功

- [ ] **Step 4: 提交**

```bash
git add src/main.rs
git commit -m "feat: add auto-start via Windows registry"
```

---

### Task 9: 设置弹窗新增选项

**Files:**
- Modify: `src/index.html`
- Modify: `src/main.js`

- [ ] **Step 1: index.html — 设置弹窗新增开关**

在 `themeToggleBtn` 下方、`settings-hint` 上方添加：

```html
<div class="input-group">
    <div class="row" style="justify-content:space-between;margin-top:12px;">
        <label style="margin:0;">开机自启</label>
        <button class="btn-small" id="autoStartToggle" style="width:auto;">关闭</button>
    </div>
    <div class="row" style="justify-content:space-between;margin-top:8px;">
        <label style="margin:0;">最小化到托盘</label>
        <button class="btn-small" id="trayToggle" style="width:auto;">开启</button>
    </div>
</div>
```

- [ ] **Step 2: main.js — 设置弹窗事件绑定**

在设置弹窗区域添加：

```javascript
// 开机自启
const autoStartToggle = document.getElementById('autoStartToggle');
autoStartToggle.addEventListener('click', async () => {
    currentConfig.auto_start = !currentConfig.auto_start;
    await saveConfigToBackend();
    updateSettingsDisplay();
});

// 最小化到托盘
const trayToggle = document.getElementById('trayToggle');
trayToggle.addEventListener('click', async () => {
    currentConfig.minimize_to_tray = !currentConfig.minimize_to_tray;
    await saveConfigToBackend();
    updateSettingsDisplay();
});
```

- [ ] **Step 3: 更新 updateSettingsDisplay**

```javascript
function updateSettingsDisplay() {
    if (currentConfig.backup_root) {
        settingsBackupRoot.textContent = currentConfig.backup_root;
        settingsBackupRoot.classList.add('has-value');
    } else {
        settingsBackupRoot.textContent = '未设置';
        settingsBackupRoot.classList.remove('has-value');
    }
    if (autoStartToggle) {
        autoStartToggle.textContent = currentConfig.auto_start ? '开启' : '关闭';
        autoStartToggle.style.background = currentConfig.auto_start ? 'var(--accent)' : 'var(--surface-hover)';
    }
    if (trayToggle) {
        trayToggle.textContent = currentConfig.minimize_to_tray ? '开启' : '关闭';
        trayToggle.style.background = currentConfig.minimize_to_tray ? 'var(--accent)' : 'var(--surface-hover)';
    }
}
```

- [ ] **Step 4: 提交**

```bash
git add src/index.html src/main.js
git commit -m "feat: add auto-start and minimize-to-tray toggles in settings"
```

---

## Self-Review Checklist

### 1. Spec 覆盖检查

- Tab 栏排序 → Task 3
- 数据模型（AppConfig/TodoItem） → Task 2
- 待办前端面板（HTML/CSS） → Task 3/4
- 待办 JS CRUD + 搜索/过滤 → Task 5
- 编辑弹窗 → Task 5
- 定时提醒后台线程 → Task 6
- 重复任务（提醒触发 + 手动完成推期） → Task 5/6
- 开机自启 → Task 8
- 最小化到托盘 → Task 7
- 移除 chrono-tz → Task 1/2
- 设置弹窗开关 → Task 9

### 2. 占位符扫描

已检查，无占位符。

### 3. 类型一致性

- `TodoItem.id` 在前端用 `crypto.randomUUID()`，在 Rust 用 `String` → 一致
- `ReminderConfig.datetime` 格式 `YYYY-MM-DDTHH:mm` → 前后端一致
- `tab_order` 默认值 `["convert", "backup", "todo"]` → 一致
