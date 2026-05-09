# 性能优化与本地日志系统 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 解决 Tauri 生产构建面板切换卡顿，建立本地日志系统

**Architecture:** CSS 层面板从 `display:none/block` 切换改为绝对定位叠放 + 仅触发合成层变化（`opacity`），根治布局重算导致的卡顿。日志层使用前端 `window.__log` 环形缓冲区 → Tauri IPC `log_write` → 文件输出，外加应用内日志面板。

**Tech Stack:** vanilla HTML/CSS/JS, Tauri 2.0 Rust (serde, chrono), 无 npm/打包器

---

### Task 1: CSS 渲染优化 — 面板绝对定位 + 合成层切换

**Files:**
- Modify: `src/styles.css`（`.content` ~L215, `.panel` ~L223）

- [ ] **Step 1: `.content` 容器添加定位参考**

```css
.content {
    flex: 1;
    padding: 20px 24px;
    min-width: 0;
    position: relative;   /* 新增 */
    overflow: hidden;      /* 改，原来为 overflow-y: auto，每个面板自行控制 */
}
```

- [ ] **Step 2: 重写 `.panel` / `.panel.active`**

当前：
```css
.panel { display: none; }
.panel.active { display: block; }
```

改为：
```css
.panel {
    display: block;          /* 永远 block */
    position: absolute;
    top: 20px;               /* 匹配 .content padding */
    left: 24px;
    right: 24px;
    bottom: 20px;
    overflow-y: auto;        /* 每个面板独立滚动 */
    opacity: 0;
    pointer-events: none;
    visibility: hidden;
    will-change: opacity;    /* 独立合成层，GPU 加速 */
}
.panel.active {
    opacity: 1;
    pointer-events: auto;
    visibility: visible;
}
```

注意：`.content` 的 `overflow-y: auto` 移动到每个 `.panel` 上，因为绝对定位后父容器的 overflow 对子元素不再生效。

- [ ] **Step 3: 编译 + 快速验证**

Run: `cargo tauri dev`
Expected: 面板正常显示，切换流畅，每个面板可独立滚动

---

### Task 2: Rust 端 — 新增 `log_write` 命令

**Files:**
- Modify: `src/main.rs`

- [ ] **Step 1: 新增 `log_write` 命令**

在 `src/main.rs` 末尾 `// ===` 区块后追加：

```rust
// ==================== 日志命令 ====================

#[tauri::command]
fn log_write(app_handle: tauri::AppHandle, lines: Vec<String>) -> Result<(), String> {
    let app_dir = get_app_dir();
    let log_dir = app_dir.join("logs");
    fs::create_dir_all(&log_dir).map_err(|e| e.to_string())?;

    let today = chrono::Local::now().format("%Y-%m-%d").to_string();
    let log_path = log_dir.join(format!("{}.log", today));

    let mut file = fs::OpenOptions::new()
        .create(true)
        .append(true)
        .open(&log_path)
        .map_err(|e| e.to_string())?;
    for line in &lines {
        writeln!(file, "{}", line).map_err(|e| e.to_string())?;
    }

    // 文件 ~10MB 轮转
    if let Ok(meta) = fs::metadata(&log_path) {
        if meta.len() > 10 * 1024 * 1024 {
            let bak1 = log_dir.join(format!("{}.1.log", today));
            let bak2 = log_dir.join(format!("{}.2.log", today));
            let _ = fs::remove_file(&bak2);
            let _ = fs::rename(&bak1, &bak2);
            let _ = fs::rename(&log_path, &bak1);
        }
    }

    Ok(())
}
```

注意：`chrono` 已在 `Cargo.toml` 依赖中（见 CLAUDE.md）。

- [ ] **Step 2: 注册命令**

在 `main()` 中找到 `.invoke_handler(tauri::generate_handler![...])`，将 `log_write` 加入数组。

- [ ] **Step 3: 编译验证**

Run: `cargo build`
Expected: 编译成功

---

### Task 3: 前端 — `window.__log` 日志模块

**Files:**
- Modify: `src/main.js`（末尾追加新区块，约在 EOF 之前）

- [ ] **Step 1: 在 main.js 末尾追加日志模块**

在 `// ====================` 之后追加：

```js
// ==================== 日志系统 ====================

(function() {
    var LEVEL_MAP = { DEBUG: 0, INFO: 1, PERF: 2, WARN: 3, ERROR: 4 };
    var MAX = 2000;
    var FLUSH_MS = 10000;
    var FLUSH_AT = 100;
    var buffer = [];
    var minLv = 1;   // 默认 INFO
    var busy = false;
    var timer = null;

    function pad2(n) { return String(n).padStart(2, '0'); }
    function pad3(n) { return String(n).padStart(3, '0'); }

    function fmtTime(ts) {
        var d = new Date(ts);
        return d.getFullYear() + '-' + pad2(d.getMonth()+1) + '-' + pad2(d.getDate())
            + ' ' + pad2(d.getHours()) + ':' + pad2(d.getMinutes()) + ':'
            + pad2(d.getSeconds()) + '.' + pad3(d.getMilliseconds());
    }

    function fmt(entry) {
        var lv = entry.level.padEnd(5);
        var src = (entry.source||'').padEnd(10);
        return '[' + fmtTime(entry.time) + '][' + lv + '][' + src + '] ' + entry.message;
    }

    function doFlush() {
        if (busy || buffer.length === 0) return;
        busy = true;
        var batch = buffer.splice(0, buffer.length);
        // 只写 WARN+ 到文件
        var lines = batch.filter(function(e) { return LEVEL_MAP[e.level] >= 3; }).map(fmt);
        if (lines.length) {
            try {
                window.__TAURI_INTERNALS__.invoke('log_write', { lines: lines })
                    .catch(function() {});
            } catch(e) {}
        }
        busy = false;
    }

    function schedule() {
        if (timer) clearTimeout(timer);
        timer = setTimeout(function() { doFlush(); schedule(); }, FLUSH_MS);
    }

    function push(lv, src, msg, data) {
        if (LEVEL_MAP[lv] < minLv) return;
        buffer.push({ time: Date.now(), level: lv, source: src, message: String(msg), data: data });
        if (buffer.length > MAX) buffer.splice(0, buffer.length - MAX);
        if (buffer.length >= FLUSH_AT) doFlush();
    }

    window.__log = {
        debug: function(s,m,d) { push('DEBUG',s,m,d); },
        info:  function(s,m,d) { push('INFO', s,m,d); },
        perf:  function(s,m,d) { push('PERF', s,m,d); },
        warn:  function(s,m,d) { push('WARN', s,m,d); },
        error: function(s,m,d) { push('ERROR',s,m,d); },
        flush: doFlush,
        setLevel: function(l) { if (LEVEL_MAP[l] !== void 0) minLv = LEVEL_MAP[l]; },
        getEntries: function(f) {
            var r = buffer.slice();
            if (f) {
                if (f.level && f.level !== 'ALL') r = r.filter(function(e){return e.level===f.level;});
                if (f.search) {
                    var q = f.search.toLowerCase();
                    r = r.filter(function(e){ return e.message.toLowerCase().indexOf(q)!==-1 || (e.source||'').toLowerCase().indexOf(q)!==-1; });
                }
                if (f.source) r = r.filter(function(e){return e.source===f.source;});
            }
            return r.reverse();
        },
        clear: function() { buffer.length = 0; },
        export: function() {
            var text = buffer.map(fmt).join('\n');
            var blob = new Blob([text], {type:'text/plain;charset=utf-8'});
            var url = URL.createObjectURL(blob);
            var a = document.createElement('a');
            a.href = url;
            a.download = 'logs_' + new Date().toISOString().slice(0,10) + '.txt';
            a.click();
            URL.revokeObjectURL(url);
        }
    };
    schedule();
})();
```

- [ ] **Step 2: 验证**

Run: `cargo tauri dev`
Expected: 打开控制台，输入 `window.__log.info('Test','hello')` 无报错

---

### Task 4: 日志 Tab 定义 + 日志面板 HTML/CSS

**Files:**
- Modify: `src/main.js`（`TAB_DEFS` 和 `DEFAULT_TAB_ORDER`）
- Modify: `src/index.html`（追加 `#panel-log`）
- Modify: `src/styles.css`（日志面板样式）

- [ ] **Step 1: 修改 Tab 定义**

在 `TAB_DEFS` 对象中添加：
```js
const TAB_DEFS = {
    // ... 现有三个 ...
    log: { icon: '📋', label: '日志' },
};
```

在 `DEFAULT_TAB_ORDER` 中添加 `'log'`：
```js
const DEFAULT_TAB_ORDER = ['convert', 'backup', 'todo', 'log'];
```

- [ ] **Step 2: 在 index.html 添加日志面板**

在待办面板（`#panel-todo`）的 `</div>` 后追加：

```html
<!-- 日志面板 -->
<div class="panel" id="panel-log">
    <div class="log-toolbar">
        <input type="text" id="logSearch" class="log-search-input" placeholder="搜索日志...">
        <select id="logLevelFilter" class="log-filter-select">
            <option value="ALL">全部</option>
            <option value="ERROR">ERROR</option>
            <option value="WARN">WARN</option>
            <option value="PERF">PERF</option>
            <option value="INFO">INFO</option>
            <option value="DEBUG">DEBUG</option>
        </select>
        <button id="logExportBtn" class="btn-small">导出</button>
        <button id="logClearBtn" class="btn-small">清屏</button>
    </div>
    <div id="logEntries" class="log-entries">
        <div class="empty-hint">暂无日志</div>
    </div>
</div>
```

- [ ] **Step 3: 添加日志面板 CSS**

在 `styles.css` 末尾追加：

```css
/* ==================== 日志面板 ==================== */
#panel-log { display: flex; flex-direction: column; }

.log-toolbar {
    display: flex;
    gap: 8px;
    align-items: center;
    margin-bottom: 12px;
    flex-shrink: 0;
}
.log-search-input {
    flex: 1;
    padding: 6px 10px;
    border: 1px solid var(--border);
    border-radius: 6px;
    background: var(--input-bg);
    color: var(--text);
    font-size: var(--font-sm);
    outline: none;
}
.log-search-input:focus {
    border-color: var(--accent);
}
.log-filter-select {
    padding: 6px 8px;
    border: 1px solid var(--border);
    border-radius: 6px;
    background: var(--input-bg);
    color: var(--text);
    font-size: var(--font-sm);
}

.log-entries {
    flex: 1;
    overflow-y: auto;
    font-family: monospace;
    font-size: var(--font-xs);
    line-height: 1.6;
    background: var(--input-bg);
    border: 1px solid var(--border);
    border-radius: 6px;
    padding: 8px;
}
.log-entry {
    display: flex;
    gap: 8px;
    padding: 2px 4px;
    border-bottom: 1px solid var(--border);
    align-items: baseline;
}
.log-entry:last-child { border-bottom: none; }
.log-entry-time {
    color: var(--text-muted);
    flex-shrink: 0;
    width: 95px;
}
.log-entry-level {
    flex-shrink: 0;
    width: 44px;
    font-weight: 600;
}
.log-entry-level.L_ERROR  { color: #ff4444; }
.log-entry-level.L_WARN   { color: #ffaa00; }
.log-entry-level.L_PERF   { color: #44aaff; }
.log-entry-level.L_INFO   { color: var(--text); }
.log-entry-level.L_DEBUG  { color: var(--text-muted); }
.log-entry-source {
    color: var(--accent);
    flex-shrink: 0;
    width: 80px;
    overflow: hidden;
    text-overflow: ellipsis;
}
.log-entry-msg {
    flex: 1;
    word-break: break-all;
    color: var(--text);
}
```

注意：亮色模式（`body.light`）下这些颜色自动由 CSS 变量适配，仅 `.L_ERROR` 等固定颜色值在亮色下也够用。

- [ ] **Step 4: 验证**

Run: `cargo tauri dev`
Expected: 第四个 Tab"日志"出现，切过去看到空白日志面板

---

### Task 5: 日志面板渲染 + 交互逻辑

**Files:**
- Modify: `src/main.js`（追加日志面板渲染函数）

- [ ] **Step 1: 添加 `renderLogPanel` 和事件绑定**

在 ``// === 日志系统 ===`` 区块的 IIFE 之前或之后（保持分区清晰），追加：

```js
// ==================== 日志面板渲染 ====================

function renderLogPanel() {
    var filterLevel = (document.getElementById('logLevelFilter') || {}).value || 'ALL';
    var searchText = (document.getElementById('logSearch') || {}).value || '';
    var entries = window.__log.getEntries({ level: filterLevel, search: searchText });
    var container = document.getElementById('logEntries');
    if (!container) return;

    if (entries.length === 0) {
        container.innerHTML = '<div class="empty-hint">暂无日志</div>';
        return;
    }

    var showCount = Math.min(entries.length, 500);
    var html = '';
    for (var i = 0; i < showCount; i++) {
        var e = entries[i];
        var d = new Date(e.time);
        var time = String(d.getHours()).padStart(2,'0') + ':'
            + String(d.getMinutes()).padStart(2,'0') + ':'
            + String(d.getSeconds()).padStart(2,'0') + '.'
            + String(d.getMilliseconds()).padStart(3,'0');
        var lv = e.level;
        var src = e.source || '';
        var msg = e.message;
        // HTML 转义
        msg = msg.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
        src = src.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
        html += '<div class="log-entry">'
            + '<span class="log-entry-time">' + time + '</span>'
            + '<span class="log-entry-level L_' + lv + '">' + lv + '</span>'
            + '<span class="log-entry-source">' + src + '</span>'
            + '<span class="log-entry-msg">' + msg + '</span>'
            + '</div>';
    }
    if (entries.length > 500) {
        html += '<div class="empty-hint" style="padding:8px;text-align:center">'
            + '显示最近 500 条，共 ' + entries.length + ' 条</div>';
    }
    container.innerHTML = html;
}
```

- [ ] **Step 2: 定义事件绑定函数 `bindLogPanelEvents`**

```js
function bindLogPanelEvents() {
    var logSearch = document.getElementById('logSearch');
    var logFilter = document.getElementById('logLevelFilter');
    var logExport = document.getElementById('logExportBtn');
    var logClear  = document.getElementById('logClearBtn');
    if (logSearch) logSearch.addEventListener('input', renderLogPanel);
    if (logFilter) logFilter.addEventListener('change', renderLogPanel);
    if (logExport) logExport.addEventListener('click', function() { window.__log.export(); });
    if (logClear)  logClear.addEventListener('click', function() {
        window.__log.clear();
        renderLogPanel();
    });
}
```

---

### Task 6: `switchTab` 优化 + 计时 + 面板切换日志集成

**Files:**
- Modify: `src/main.js`（`switchTab` 函数 ~L168）

- [ ] **Step 1: 重写 `switchTab`**

当前 `switchTab` 已只做 class toggle 和调用子函数。CSS 改后 class toggle 就只会触发 `opacity` 变化。
需要添加：双重 rAF 计时 + 日志调用 + 日志面板渲染：

```js
function switchTab(tabId) {
    var t0 = performance.now();

    currentTab = tabId;
    document.querySelectorAll('.tab').forEach(function(t) { t.classList.remove('active'); });
    document.querySelectorAll('.panel').forEach(function(p) { p.classList.remove('active'); });
    var tab = document.querySelector('.tab[data-tab="' + tabId + '"]');
    if (tab) tab.classList.add('active');
    var panel = document.getElementById('panel-' + tabId);
    if (panel) panel.classList.add('active');

    var t1 = performance.now();

    if (tabId === 'backup') { refreshAll(); }
    else if (tabId === 'todo') { renderTodos(); }
    else if (tabId === 'log') { renderLogPanel(); }

    var t2 = performance.now();

    // 双重 rAF 测量真实渲染结束时间
    requestAnimationFrame(function() {
        requestAnimationFrame(function() {
            var renderEnd = performance.now();
            window.__log.perf('TabSwitch', '切到' + tabId, {
                dom: +(t1 - t0).toFixed(2),
                action: +(t2 - t1).toFixed(2),
                render: +(renderEnd - t2).toFixed(2),
                total: +(renderEnd - t0).toFixed(2)
            });
        });
    });
}
```

注意：这完全替换现有的 switchTab 函数体。

- [ ] **Step 2: 确保 `renderLogPanel` 在 `switchTab('log')` 时调用**

已在步骤 1 中处理。

- [ ] **Step 3: 验证**

Run: `cargo tauri dev`，切换面板几次，控制台检查 `window.__log.getEntries()` 中有 PERF 记录

---

### Task 7: 启动初始化优化

**Files:**
- Modify: `src/main.js`（`init()` 或 DOMContentLoaded 回调）

- [ ] **Step 1: 查看当前初始化代码位置**

找到 DOMContentLoaded 回调（约 L440+）：

```js
document.addEventListener('DOMContentLoaded', function() {
    // ... 加载配置 ...
    // ... 渲染各面板 ...
    renderTabBar();
    renderTimezones();
    // ...
});
```

- [ ] **Step 2: 分步初始化，避免阻塞首帧**

改为：
```js
document.addEventListener('DOMContentLoaded', function() {
    // 第一步：必须同步的操作
    loadConfig();
    applyTheme();

    // 第二步：Tab 栏（首帧可见）
    requestAnimationFrame(function() {
        renderTabBar();

        // 第三步：时间转换面板（首面板，用户最先看到）
        requestAnimationFrame(function() {
            renderTimezones();

            // 第四步：注册日志面板事件（延迟初始化，不阻塞）
            setTimeout(function() {
                bindLogPanelEvents();
            }, 100);
        });
    });
});
```

这里 `bindLogPanelEvents` 是 Task 5 中的事件绑定逻辑（`logSearch.addEventListener` 等），可单独提取为函数。

注意：`loadConfig` 和 `applyTheme` 保持同步（它们是同步读取和设置 context，很快）。`loadConfig` 需要先执行，因为 `renderTabBar` 依赖 `currentConfig`。

- [ ] **Step 3: 验证**

Run: `cargo tauri dev`
Expected: 启动后立即看到界面，无白屏或冻结

---

### Task 8: 现有代码埋点

**Files:**
- Modify: `src/main.js`（多个位置）

- [ ] **Step 1: `addTodo` — 新增待办时记录**

找到 `addTodo` 函数（约 L1510+），在保存到 config 后添加：
```js
window.__log.info('Todo', '新增待办: ' + title + (repeat ? ' [repeat:' + repeat + ']' : '') + (priority ? ' [p:' + priority + ']' : ''));
```

- [ ] **Step 2: `toggleTodoDone` — 完成/取消完成时记录**

找到 `toggleTodoDone` 函数（约 L1526+），在完成分支和取消分支分别添加：
```js
// 完成时
window.__log.info('Todo', '完成任务: ' + todo.title);

// 取消完成时
window.__log.info('Todo', '取消完成任务: ' + todo.title);
```

- [ ] **Step 3: `deleteTodo` — 删除时记录**

找到 `deleteTodo` 函数：
```js
window.__log.info('Todo', '删除待办: ' + todo.title);
```
（需要在 filter 前先保存 todo 引用）

- [ ] **Step 4: `saveBackup` + `refreshAll` — 备份操作记录**

找到 `refreshAll`（约 L430+）和 `saveBackup` 函数：
```js
// refreshAll 中
var t0 = performance.now();
// ... 现有 IPC 调用 ...
window.__log.perf('Backup', '刷新备份列表', { ms: +(performance.now() - t0).toFixed(2) });

// saveBackup 中（成功回调里）
window.__log.info('Backup', '保存存档: ' + gameName + '/' + slotName + ' (' + files.length + ' 文件)');
```

- [ ] **Step 5: 验证**

Run: `cargo tauri dev`
Expected: 执行各种操作后，`window.__log.getEntries()` 包含对应的 INFO/PERF 记录

---

### Task 9: 生产构建验证

**Files:** 无

- [ ] **Step 1: 构建生产版本**

Run: `cargo tauri build`
Expected: 编译成功，生成安装包

- [ ] **Step 2: 安装运行并验证**

1. 安装并运行生产版本
2. 切换面板 — 不应再有界面冻结
3. 切换三次面板
4. 切到日志面板 — 应看到三条 PERF 级别日志
5. 点击导出 — 应下载日志文件
6. 检查 `%APPDATA%/com.hrbTools.app/logs/` — 应有今天的 .log 文件
7. 测试所有现有功能：时间转换、存档备份/恢复、待办增删改完成

- [ ] **Step 3: 如有卡顿，检查日志面板的 timing 数据**

查看 PERF 日志的 `render` 字段 — 如果仍高，说明布局/绘制仍有瓶颈，需要进一步检查 CSS 合成层。
