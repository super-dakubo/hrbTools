# 横幅通知系统重新设计 — 实现计划

> **给代理工人的说明：** 必须使用 superpowers:subagent-driven-development（推荐）或 superpowers:executing-plans 来逐步执行此计划。步骤使用复选框（`- [ ]`）语法跟踪进度。

**目标：** 将横幅从待办提醒专用改造为通用通知系统，右上角 Toast 浮层 + 通知中心下拉面板

**架构：** Rust 端修改 `BannerEntry` 结构体 + 添加 `push_notification()` 函数；JS 端重写 `renderBanners()` 为 Toast 堆叠；CSS 新增浮动玻璃拟态样式。旧格式在 `loadConfig()` 中迁移。

**涉及文件：**
- `src/main.rs` — BannerEntry 结构体、push_notification、提醒线程
- `src/main.js` — renderBanners、loadConfig、setupEventDelegation
- `src/styles.css` — 删除旧 banner 样式，新增 Toast 和通知中心样式
- `src/index.html` — 标题栏添加铃铛按钮

---

### 任务 1：Rust 端修改 `BannerEntry` 并添加 `push_notification()`

**文件：** `src/main.rs`

- [ ] **步骤 1：替换 BannerEntry 结构体**

将旧的 `BannerEntry`（`id, todo_id, text, created_at`）替换为新结构体。添加 `NotificationLevel` 枚举。用 `#[serde(default)]` 保证旧 JSON 能反序列化（unknown fields 会被 serde 忽略，新字段有默认值）。

```rust
#[derive(Debug, Serialize, Deserialize, Clone)]
enum NotificationLevel {
    #[serde(rename = "Info")]
    Info,
    #[serde(rename = "Success")]
    Success,
    #[serde(rename = "Warning")]
    Warning,
    #[serde(rename = "Error")]
    Error,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
struct BannerEntry {
    #[serde(default)]
    id: String,
    #[serde(default)]
    level: NotificationLevel,
    #[serde(default)]
    source: String,
    #[serde(default)]
    title: String,
    #[serde(default)]
    message: String,
    #[serde(default)]
    created_at: i64,
    #[serde(default = "default_auto_dismiss")]
    auto_dismiss: bool,
    #[serde(default)]
    read: bool,
}

fn default_auto_dismiss() -> bool { true }
```

在 `BannerEntry` 定义之前添加 `NotificationLevel`。

- [ ] **步骤 2：添加 `push_notification()` 函数**

在 `BannerEntry` 定义之后（或放在 `// ==================== 操作结果 ====================` 附近），添加全局函数：

```rust
// @Service 通用通知推送：任意模块调用，写入 config.banners
fn push_notification(
    app: &tauri::AppHandle,
    level: NotificationLevel,
    source: &str,
    title: &str,
    message: &str,
) {
    let mut config = load_config(app);
    let auto_dismiss = matches!(level, NotificationLevel::Info | NotificationLevel::Success | NotificationLevel::Warning);
    config.banners.push(BannerEntry {
        id: uuid::Uuid::new_v4().to_string(),
        level,
        source: source.to_string(),
        title: title.to_string(),
        message: message.to_string(),
        created_at: chrono::Utc::now().timestamp_millis(),
        auto_dismiss,
        read: false,
    });
    save_config(app, &config);
}
```

注意：项目没有 uuid crate。检查 `Cargo.toml` 确认是否有 uuid。如果没有，用时间戳 + 随机后缀替代：

```rust
use std::time::{SystemTime, UNIX_EPOCH};
let id = format!("notif_{}", SystemTime::now().duration_since(UNIX_EPOCH).unwrap().as_nanos());
```

- [ ] **步骤 3：编译验证**

运行：`cargo check`
预期：编译通过

- [ ] **步骤 4：提交**

```bash
git add src/main.rs
git commit -m "refactor(rust): 更新 BannerEntry 结构体，添加通用通知推送函数

- 添加 NotificationLevel 枚举
- BannerEntry 新增 level/source/title/message/auto_dismiss/read 字段
- 移除 todo_id 字段
- 添加 push_notification() 全局函数
- #[serde(default)] 保证旧 JSON 兼容"
```

### 任务 2：Rust 端适配提醒线程

**文件：** `src/main.rs`

- [ ] **步骤 1：替换提醒线程中横幅创建代码**

在 `reminder_thread()` 函数中找到 `config.banners.push(BannerEntry { ... })` 处（约第 2504 行），替换为调用 `push_notification()`：

```rust
// 替换这段：
// config.banners.push(BannerEntry {
//     id: reminder.id.clone(),
//     todo_id: reminder.todo_id.clone(),
//     text: format!("⏰ {}", reminder.text),
//     created_at: now,
// });

// 改为：
push_notification(&app_handle, NotificationLevel::Info, "提醒",
    &format!("⏰ {}", reminder.text), "");
```

注意：`reminder_thread` 的参数是 `app_handle: tauri::AppHandle`（不是 `&tauri::AppHandle`），但闭包内使用的是 `&app_handle`。`push_notification` 需要 `&tauri::AppHandle`，传入 `&app_handle` 即可。

- [ ] **步骤 2：编译验证**

运行：`cargo check`
预期：编译通过

- [ ] **步骤 3：提交**

```bash
git add src/main.rs
git commit -m "refactor(rust): 提醒线程使用 push_notification() 替代手动构造 BannerEntry"
```

### 任务 3：JS 端 loadConfig() 添加旧格式迁移

**文件：** `src/main.js`

- [ ] **步骤 1：在 loadConfig() 中添加横幅数据格式迁移**

在 `loadConfig()` 函数中，`currentConfig = config;` 之后、现有 reminder 迁移代码之前，添加横幅迁移：

```js
    currentConfig = config;
    // 迁移旧横幅格式（移除 todo_id，拆 text 为 title）
    if (currentConfig.banners) {
        currentConfig.banners = currentConfig.banners.map(function(b) {
            if (b.todo_id !== undefined && b.level === undefined) {
                return {
                    id: b.id,
                    level: 'Info',
                    source: '提醒',
                    title: b.text || '',
                    message: '',
                    created_at: b.created_at || Date.now(),
                    auto_dismiss: true,
                    read: false,
                };
            }
            return b;
        });
    }
```

位置在 `currentConfig = config;`（第 482 行）之后、现有 reminder 迁移（第 483 行）之前。

- [ ] **步骤 2：添加 `pushNotification()` JS 函数**

在 `renderBanners()` 函数之前（或替换它），添加通用 JS 推送接口：

```js
// ==================== 横幅通知系统 ====================

var _notificationTimers = {}; // bannerId -> setTimeout ID

function pushNotification(level, source, title, message) {
    var banner = {
        id: 'notif_' + Date.now() + '_' + Math.random().toString(36).slice(2, 8),
        level: level,
        source: source,
        title: title,
        message: message || '',
        created_at: Date.now(),
        auto_dismiss: level !== 'Error',
        read: false,
    };
    currentConfig.banners = currentConfig.banners || [];
    currentConfig.banners.push(banner);
    saveConfigToBackend();
    renderBanners();
    return banner.id;
}
```

- [ ] **步骤 3：添加自动消失定时器管理**

```js
function startDismissTimer(banner) {
    if (!banner.auto_dismiss) return;
    var timeoutMs = DISMISS_TIMES[banner.level] || 300000; // 默认 5 分钟
    if (_notificationTimers[banner.id]) clearTimeout(_notificationTimers[banner.id]);
    _notificationTimers[banner.id] = setTimeout(function() {
        dismissNotification(banner.id);
    }, timeoutMs);
}

var DISMISS_TIMES = {
    Success: 30000,
    Info: 300000,
    Warning: 7200000,
    Error: Infinity,
};

function dismissNotification(bannerId) {
    currentConfig.banners = (currentConfig.banners || []).filter(function(b) { return b.id !== bannerId; });
    delete _notificationTimers[bannerId];
    saveConfigToBackend();
    renderBanners();
}

function clearAllTimers() {
    Object.keys(_notificationTimers).forEach(function(id) {
        clearTimeout(_notificationTimers[id]);
    });
    _notificationTimers = {};
}
```

将这些函数放在 `pushNotification` 之后。

- [ ] **步骤 4：提交**

```bash
git add src/main.js
git commit -m "feat(js): 添加横幅格式迁移、pushNotification、自动消失定时器

- loadConfig() 中迁移旧横幅格式到新格式
- 添加 pushNotification() JS 推送接口
- 添加 DISMISS_TIMES 和 startDismissTimer/dismissNotification 自动消失"
```

### 任务 4：JS 端重写 `renderBanners()` 为 Toast 浮层

**文件：** `src/main.js`

- [ ] **步骤 1：替换整个 `renderBanners()` 函数**

删除旧的 `renderBanners()`（第 2335-2371 行），替换为：

```js
function renderBanners() {
    var banners = currentConfig.banners || [];
    var container = document.getElementById('bannerArea');
    if (!container) return;

    // 清理已消失横幅的定时器
    var activeIds = {};
    banners.forEach(function(b) { activeIds[b.id] = true; });
    Object.keys(_notificationTimers).forEach(function(id) {
        if (!activeIds[id]) {
            clearTimeout(_notificationTimers[id]);
            delete _notificationTimers[id];
        }
    });

    // 移除已超时的 auto_dismiss 横幅
    var now = Date.now();
    var changed = false;
    banners = banners.filter(function(b) {
        if (!b.auto_dismiss) return true;
        if (b.level === 'Success' && now - b.created_at > 30000) { changed = true; return false; }
        if (b.level === 'Info' && now - b.created_at > 300000) { changed = true; return false; }
        if (b.level === 'Warning' && now - b.created_at > 7200000) { changed = true; return false; }
        return true;
    });
    if (changed) {
        currentConfig.banners = banners;
        saveConfigToBackend();
    }

    // 去重合并：同 source + 同 title 合并
    var merged = {};
    banners.forEach(function(b) {
        var key = b.source + '|' + b.title;
        if (merged[key]) {
            merged[key].count = (merged[key].count || 1) + 1;
        } else {
            merged[key] = { banner: b, count: 1 };
        }
    });
    var deduped = Object.keys(merged).map(function(k) { return merged[k]; });

    // 最多显示 3 条 Toast
    var maxShow = 3;
    var visible = deduped.slice(0, maxShow);
    var hiddenCount = deduped.length - maxShow;

    container.innerHTML = '';
    if (deduped.length === 0) {
        container.style.display = 'none';
        return;
    }
    container.style.display = 'flex';

    // 超出 3 条的汇总提示
    if (hiddenCount > 0) {
        var summary = document.createElement('div');
        summary.className = 'toast-summary';
        summary.textContent = '还有 ' + hiddenCount + ' 条通知';
        summary.addEventListener('click', function() { toggleNotificationCenter(); });
        container.appendChild(summary);
    }

    visible.forEach(function(item) {
        var b = item.banner;
        var el = document.createElement('div');
        el.className = 'toast-item toast-' + b.level.toLowerCase();
        el.dataset.bannerId = b.id;

        // 来源标签
        var sourceBadge = document.createElement('span');
        sourceBadge.className = 'toast-source';
        sourceBadge.textContent = b.source;
        el.appendChild(sourceBadge);

        // 标题
        var titleEl = document.createElement('span');
        titleEl.className = 'toast-title';
        titleEl.textContent = b.title + (item.count > 1 ? ' (×' + item.count + ')' : '');
        el.appendChild(titleEl);

        // 关闭按钮
        var closeBtn = document.createElement('button');
        closeBtn.className = 'toast-close';
        closeBtn.innerHTML = '&times;';
        closeBtn.addEventListener('click', function(e) {
            e.stopPropagation();
            dismissNotification(b.id);
        });
        el.appendChild(closeBtn);

        // 自动消失倒计时提示
        if (b.auto_dismiss && b.level !== 'Error') {
            var timeEl = document.createElement('div');
            timeEl.className = 'toast-timer';
            var remaining = getRemainingSec(b);
            if (remaining > 0) {
                timeEl.textContent = remaining + ' 秒后自动消失';
            }
            el.appendChild(timeEl);
        }

        // hover 暂停倒计时
        el.addEventListener('mouseenter', function() {
            if (_notificationTimers[b.id]) {
                clearTimeout(_notificationTimers[b.id]);
                delete _notificationTimers[b.id];
            }
        });
        el.addEventListener('mouseleave', function() {
            startDismissTimer(b);
        });

        container.appendChild(el);

        // 新通知启动定时器
        if (!_notificationTimers[b.id]) {
            startDismissTimer(b);
        }
    });
}

function getRemainingSec(banner) {
    var timeoutMs = DISMISS_TIMES[banner.level] || 300000;
    var elapsed = Date.now() - banner.created_at;
    var remaining = Math.max(0, Math.ceil((timeoutMs - elapsed) / 1000));
    return remaining;
}
```

- [ ] **步骤 2：更新 `__onReminderFired` 回调**

在 `DOMContentLoaded` 回调中找到 `__onReminderFired`（第 2404 行），更新为调用 `pushNotification` 而非全量重新拉取配置：

```js
            window.__onReminderFired = function() {
                invoke('get_config').then(function(fresh) {
                    currentConfig = fresh;
                    renderBanners();
                    if (currentTab === 'todo') renderTodos();
                }).catch(function(e) {
                    window.__log.error('重新拉取配置失败: ' + e);
                });
            };
```

改为（注意：`__onReminderFired` 目前是拉取全量配置，因为 Rust 端已经通过 `push_notification()` 写入了 config。保持现状即可，JS 端会正确渲染新格式）。

实际上不需要改 `__onReminderFired`，保持原样。

- [ ] **步骤 3：提交**

```bash
git add src/main.js
git commit -m "feat(js): 重写 renderBanners 为右上角 Toast 浮层

- 自动消失超时检查
- 去重合并（同 source + 同 title）
- 最多 3 条可见 + 汇总条
- hover 暂停倒计时
- 倒计时显示剩余秒数"
```

### 任务 5：JS 端添加铃铛图标和通知中心下拉面板

**文件：** `src/main.js` + `src/index.html`

- [ ] **步骤 1：HTML 标题栏添加铃铛按钮**

在 `src/index.html` 中，在设置按钮和窗口控件之间添加铃铛按钮（第 21 行）：

```html
        <button class="title-bar-btn" id="notificationBell" title="通知中心">🔔</button>
```

位置在 `settingsBtn` 之后、`window-controls` 之前。

- [ ] **步骤 2：JS 端添加通知中心渲染函数**

在 `renderBanners()` 之后添加：

```js
function toggleNotificationCenter() {
    var panel = document.getElementById('notificationCenter');
    if (panel) {
        panel.classList.toggle('open');
        if (!panel.classList.contains('open')) return;
        panel.remove();
        return;
    }
    renderNotificationCenter();
}

function renderNotificationCenter() {
    var old = document.getElementById('notificationCenter');
    if (old) old.remove();

    var banners = currentConfig.banners || [];
    var sorted = banners.slice().sort(function(a, b) { return b.created_at - a.created_at; });

    var panel = document.createElement('div');
    panel.id = 'notificationCenter';
    panel.className = 'notif-center open';

    // 头部
    var header = document.createElement('div');
    header.className = 'notif-center-header';
    header.innerHTML = '<span>通知中心</span>'
        + '<span class="notif-mark-read" id="notifMarkRead">全部已读</span>';
    panel.appendChild(header);

    // 列表
    var list = document.createElement('div');
    list.className = 'notif-center-list';
    if (sorted.length === 0) {
        list.innerHTML = '<div class="notif-empty">暂无通知</div>';
    } else {
        sorted.forEach(function(b) {
            var item = document.createElement('div');
            item.className = 'notif-item' + (b.read ? ' read' : '');
            var iconMap = { Info: 'ℹ️', Success: '✅', Warning: '⚠️', Error: '❌' };
            item.innerHTML = '<span class="notif-item-icon">' + (iconMap[b.level] || 'ℹ️') + '</span>'
                + '<div class="notif-item-body">'
                + '<span class="notif-item-source">' + escapeHtml(b.source) + '</span>'
                + '<span class="notif-item-title">' + escapeHtml(b.title) + '</span>'
                + (b.message ? '<span class="notif-item-msg">' + escapeHtml(b.message) + '</span>' : '')
                + '<span class="notif-item-time">' + formatRelativeTime(b.created_at) + '</span>'
                + '</div>'
                + '<button class="notif-item-close" data-banner-id="' + escapeHtml(b.id) + '">&times;</button>';
            list.appendChild(item);
        });
    }
    panel.appendChild(list);

    document.body.appendChild(panel);

    // 全部已读
    document.getElementById('notifMarkRead').addEventListener('click', function() {
        (currentConfig.banners || []).forEach(function(b) { b.read = true; });
        saveConfigToBackend();
        renderNotificationCenter();
        renderBanners();
    });

    // 单个关闭
    panel.querySelectorAll('.notif-item-close').forEach(function(btn) {
        btn.addEventListener('click', function(e) {
            var id = this.dataset.bannerId;
            dismissNotification(id);
            var itemEl = this.closest('.notif-item');
            if (itemEl) itemEl.classList.add('removing');
            setTimeout(function() {
                renderNotificationCenter();
                renderBanners();
            }, 200);
        });
    });

    // 点击外部关闭
    setTimeout(function() {
        document.addEventListener('click', function closeNotif(e) {
            var notif = document.getElementById('notificationCenter');
            var bell = document.getElementById('notificationBell');
            if (!notif) { document.removeEventListener('click', closeNotif); return; }
            if (!notif.contains(e.target) && e.target !== bell) {
                notif.classList.remove('open');
                setTimeout(function() { if (notif && !notif.classList.contains('open')) notif.remove(); }, 200);
                document.removeEventListener('click', closeNotif);
            }
        });
    }, 0);
}

function formatRelativeTime(ts) {
    var diff = Date.now() - ts;
    if (diff < 60000) return '刚刚';
    if (diff < 3600000) return Math.floor(diff / 60000) + ' 分钟前';
    if (diff < 86400000) return Math.floor(diff / 3600000) + ' 小时前';
    return Math.floor(diff / 86400000) + ' 天前';
}

function updateBellBadge() {
    var bell = document.getElementById('notificationBell');
    if (!bell) return;
    var unread = (currentConfig.banners || []).filter(function(b) { return !b.read; }).length;
    bell.textContent = unread > 0 ? '🔔' + unread : '🔔';
}
```

- [ ] **步骤 3：绑定铃铛点击事件**

在 `setupEventDelegation()` 中或直接在 `DOMContentLoaded` 中添加：

```js
document.getElementById('notificationBell').addEventListener('click', function(e) {
    e.stopPropagation();
    renderNotificationCenter();
});
```

- [ ] **步骤 4：在 `renderBanners()` 末尾更新铃铛徽标**

在 `renderBanners()` 末尾添加调用：`updateBellBadge();`

- [ ] **步骤 5：提交**

```bash
git add src/main.js src/index.html
git commit -m "feat(ui): 添加通知中心铃铛图标和下拉面板

- 标题栏添加铃铛按钮
- 通知中心下拉面板，按时间倒序排列
- 全部已读、单条关闭、外部点击关闭
- 相对时间显示格式
- 未读计数徽标"
```

### 任务 6：CSS 样式 — Toast 和通知中心

**文件：** `src/styles.css`

- [ ] **步骤 1：删除旧 banner 样式**

删除以下 CSS 区块（第 1372-1422 行）：

```css
/* ==================== 提醒横幅区 ==================== */
.banner-area { ... }
.banner-area.has-banners { ... }
.banner-item { ... }
.banner-item-text { ... }
.banner-item-close { ... }
```

将这些行替换为新样式。

- [ ] **步骤 2：添加 Toast 新样式**

```css
/* ==================== 通知 Toast + 通知中心 ==================== */

/* Toast 容器 — 固定在标题栏下方右侧 */
#bannerArea {
  position: fixed;
  top: 48px;
  right: 16px;
  z-index: 1000;
  display: none;
  flex-direction: column;
  gap: 6px;
  max-width: 340px;
  pointer-events: none; /* 让容器不拦截点击，子元素恢复 */
}

.toast-item {
  pointer-events: auto;
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 6px 8px;
  padding: 8px 12px;
  background: rgba(24, 28, 42, 0.95);
  backdrop-filter: blur(16px);
  -webkit-backdrop-filter: blur(16px);
  border: 1px solid rgba(255,255,255,0.08);
  border-radius: 10px;
  box-shadow: 0 4px 20px rgba(0,0,0,0.3);
  animation: toastIn 0.25s cubic-bezier(0.22, 1, 0.36, 1);
  position: relative;
  cursor: default;
  min-width: 200px;
}

/* 左边框按级别分色 */
.toast-item::before {
  content: '';
  position: absolute;
  left: 0;
  top: 4px;
  bottom: 4px;
  width: 3px;
  border-radius: 2px;
}
.toast-info::before { background: #4b8bf4; }
.toast-success::before { background: #34d399; }
.toast-warning::before { background: #fbbf24; }
.toast-error::before { background: #f87171; }

.toast-source {
  font-size: 10px;
  font-weight: 600;
  padding: 1px 6px;
  border-radius: 4px;
  background: rgba(75,139,244,0.15);
  color: var(--accent);
  flex-shrink: 0;
}
.toast-success .toast-source { background: rgba(52,211,153,0.15); color: #34d399; }
.toast-warning .toast-source { background: rgba(251,191,36,0.15); color: #fbbf24; }
.toast-error .toast-source { background: rgba(248,113,113,0.15); color: #f87171; }

.toast-title {
  flex: 1;
  font-size: var(--font-sm);
  color: var(--text);
  line-height: 1.3;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.toast-close {
  flex-shrink: 0;
  background: transparent;
  border: none;
  color: rgba(255,255,255,0.3);
  font-size: 14px;
  cursor: pointer;
  padding: 0 2px;
  line-height: 1;
  transition: color 0.15s;
}
.toast-close:hover { color: var(--text); }

.toast-timer {
  width: 100%;
  font-size: 10px;
  color: rgba(255,255,255,0.3);
  padding-left: 2px;
}

/* 汇总条 */
.toast-summary {
  pointer-events: auto;
  text-align: center;
  padding: 6px 14px;
  font-size: var(--font-xs);
  color: var(--text-secondary);
  background: rgba(255,255,255,0.04);
  border: 1px solid var(--border);
  border-radius: 8px;
  cursor: pointer;
  transition: background 0.15s;
}
.toast-summary:hover { background: rgba(255,255,255,0.08); }

/* Toast 动画 */
@keyframes toastIn {
  from { opacity: 0; transform: translateX(20px); }
  to { opacity: 1; transform: translateX(0); }
}

@keyframes toastOut {
  from { opacity: 1; transform: translateX(0); max-height: 60px; }
  to { opacity: 0; transform: translateX(20px); max-height: 0; padding: 0; margin: 0; }
}

/* 亮色模式适配 */
body.light #bannerArea .toast-item {
  background: rgba(255,255,255,0.95);
  border-color: rgba(0,0,0,0.08);
  box-shadow: 0 4px 20px rgba(0,0,0,0.08);
}
body.light .toast-title { color: rgba(0,0,0,0.87); }
body.light .toast-timer { color: rgba(0,0,0,0.35); }
body.light .toast-close { color: rgba(0,0,0,0.3); }
body.light .toast-close:hover { color: rgba(0,0,0,0.8); }
body.light .toast-summary { background: rgba(0,0,0,0.03); }
body.light .toast-summary:hover { background: rgba(0,0,0,0.06); }
```

- [ ] **步骤 3：添加通知中心下拉面板样式**

```css
/* 通知中心 */
#notificationBell {
  position: relative;
}

.notif-center {
  position: fixed;
  top: 44px;
  right: 52px;
  width: 340px;
  max-height: 340px;
  background: rgba(24, 28, 42, 0.97);
  backdrop-filter: blur(20px);
  -webkit-backdrop-filter: blur(20px);
  border: 1px solid rgba(255,255,255,0.08);
  border-radius: 12px;
  box-shadow: 0 8px 40px rgba(0,0,0,0.4);
  z-index: 1001;
  display: flex;
  flex-direction: column;
  animation: notifIn 0.2s ease;
  overflow: hidden;
}

@keyframes notifIn {
  from { opacity: 0; transform: translateY(-8px); }
  to { opacity: 1; transform: translateY(0); }
}

.notif-center-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 12px 14px;
  border-bottom: 1px solid var(--border);
  font-size: var(--font-base);
  font-weight: 600;
  color: var(--text);
  flex-shrink: 0;
}

.notif-mark-read {
  font-size: var(--font-xs);
  font-weight: 400;
  color: var(--accent);
  cursor: pointer;
}
.notif-mark-read:hover { color: var(--accent-hover); }

.notif-center-list {
  flex: 1;
  overflow-y: auto;
  padding: 4px 0;
  max-height: 280px;
}

.notif-item {
  display: flex;
  align-items: flex-start;
  gap: 8px;
  padding: 8px 14px;
  border-bottom: 1px solid rgba(255,255,255,0.04);
  transition: background 0.15s;
}
.notif-item:hover { background: rgba(255,255,255,0.04); }
.notif-item.read { opacity: 0.6; }
.notif-item.removing { animation: toastOut 0.2s ease forwards; }

.notif-item-icon { font-size: 14px; line-height: 1.4; flex-shrink: 0; }

.notif-item-body {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.notif-item-source {
  font-size: 10px;
  color: var(--accent);
  font-weight: 500;
}

.notif-item-title {
  font-size: var(--font-sm);
  color: var(--text);
  line-height: 1.3;
}

.notif-item-msg {
  font-size: var(--font-xs);
  color: var(--text-secondary);
  line-height: 1.3;
}

.notif-item-time {
  font-size: 10px;
  color: var(--text-muted);
}

.notif-item-close {
  flex-shrink: 0;
  background: transparent;
  border: none;
  color: rgba(255,255,255,0.3);
  font-size: 14px;
  cursor: pointer;
  padding: 0;
  line-height: 1;
  transition: color 0.15s;
}
.notif-item-close:hover { color: var(--text); }

.notif-empty {
  text-align: center;
  padding: 24px;
  color: var(--text-muted);
  font-size: var(--font-sm);
}

/* 亮色模式 — 通知中心 */
body.light .notif-center {
  background: rgba(245, 246, 248, 0.98);
  border-color: rgba(0,0,0,0.08);
  box-shadow: 0 8px 40px rgba(0,0,0,0.1);
}
body.light .notif-item { border-bottom-color: rgba(0,0,0,0.04); }
body.light .notif-item:hover { background: rgba(0,0,0,0.03); }
body.light .notif-item-close { color: rgba(0,0,0,0.3); }
body.light .notif-item-close:hover { color: rgba(0,0,0,0.8); }
```

- [ ] **步骤 4：编译验证**

运行：`cargo tauri build` 或者 `cargo check`（CSS 不需要编译，但确保索引页能引用）
检查方式：打开 `src/index.html` 确认 `<link>` 引用正确

- [ ] **步骤 5：提交**

```bash
git add src/styles.css
git commit -m "feat(css): 添加 Toast 浮层和通知中心新样式

- 浮动 Toast 容器（右上角固定定位）
- 按级别分色左边框
- 来源标签按级别着色
- 进场/退场动画
- 通知中心下拉面板
- 暗色/亮色模式适配"
```

### 任务 7：集成验证

- [ ] **步骤 1：检查所有改动文件**

运行：`git diff --stat`
预期看到 4 个文件被修改：`src/main.rs`、`src/main.js`、`src/styles.css`、`src/index.html`

- [ ] **步骤 2：编译 Rust**

运行：`cargo check`
预期：编译通过

- [ ] **步骤 3：最终提交**

```bash
git add -A
git commit -m "feat: 横幅通知系统重新设计

- BannerEntry 解耦为通用通知结构体
- 右上角 Toast 浮层替代内联横幅
- 按类型分色（信息/成功/警告/错误）
- 自动消失机制 + hover 暂停
- 通知中心下拉面板
- 旧格式迁移兼容"
```
