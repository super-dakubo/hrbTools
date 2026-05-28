# 代码检查修复实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 修复全量代码检查中发现的 4 个严重 Bug、4 个脆弱性、6 个设计优化项

**Architecture:** 按优先级分三阶段执行：B 类（高优先，用户可见 bug）→ W 类（中优先，边缘情况）→ D 类（低优先，代码整洁）。每个任务在 `src/main.js` 中严格遵守面板隔离规则（仅改目标区块，不跨区）。

**Tech Stack:** Rust (Tauri 2.0) + 原生 JS + CSS

---

## 阶段一：严重 Bug (B1-B4)

### Task 1: 修复恢复弹窗字段名 `f.path` → `f.original_path`

**Files:**
- Modify: `src/main.js:974`

- [ ] **Step 1: 定位并修复字段引用**

在 `main.js:974`，`showRestoreFileModal` 函数中修改 innerHTML 中的字段引用：

```js
// 修改前 (第 974 行)
+'<span class="restore-file-path">' + escapeHtml(shortenPath(f.path)) + '</span>'

// 修改后
+'<span class="restore-file-path">' + escapeHtml(shortenPath(f.original_path)) + '</span>'
```

- [ ] **Step 2: 验证改动仅限目标行**

```bash
git diff src/main.js
```
Expected: `f.path` → `f.original_path` 的单行变更，无其他改动。

- [ ] **Step 3: Commit**

```bash
git add src/main.js
git commit -m "fix: restore dialog file path field name (f.path → f.original_path)"
```

---

### Task 2: 修复 `open_log_folder` Linux 分支命令

**Files:**
- Modify: `src/main.rs:1572-1578`

- [ ] **Step 1: 修改非 Windows 分支为分平台处理**

将 `main.rs:1572-1578` 替换：

```rust
    // 原代码 (第 1572-1578 行):
    #[cfg(not(target_os = "windows"))]
    {
        std::process::Command::new("open")
            .arg(&log_dir)
            .spawn()
            .map_err(|e| format!("打开日志文件夹失败: {}", e))?;
    }

    // 修改后:
    #[cfg(target_os = "macos")]
    {
        std::process::Command::new("open")
            .arg(&log_dir)
            .spawn()
            .map_err(|e| format!("打开日志文件夹失败: {}", e))?;
    }

    #[cfg(target_os = "linux")]
    {
        std::process::Command::new("xdg-open")
            .arg(&log_dir)
            .spawn()
            .map_err(|e| format!("打开日志文件夹失败: {}", e))?;
    }
```

- [ ] **Step 2: 编译检查**

```bash
cargo check
```
Expected: 编译成功，无警告。

- [ ] **Step 3: Commit**

```bash
git add src/main.rs
git commit -m "fix: split open_log_folder non-Windows branch into macos/linux"
```

---

### Task 3: 修复备份失败后恢复流程继续执行

**Files:**
- Modify: `src/main.js:916-922`

- [ ] **Step 1: 添加备份失败后的 return**

在 `main.js:916-922`，`handleRestore` 函数中修改：

```js
// 原代码 (第 916-922 行):
if (!backupResult.success) {
    alert('备份当前文件失败: ' + backupResult.message);
}
await doRestoreWithFileSelect(folderName);

// 修改后:
if (!backupResult.success) {
    alert('备份当前文件失败: ' + backupResult.message);
    return;
}
await doRestoreWithFileSelect(folderName);
```

- [ ] **Step 2: 验证改动范围**

```bash
git diff src/main.js
```
Expected: 仅在第 922 行后添加 `return;`，无其他改动。

- [ ] **Step 3: Commit**

```bash
git add src/main.js
git commit -m "fix: stop restore if pre-restore backup fails"
```

---

### Task 4: 修复 `bindTabEvents` 事件监听器堆积

**Files:**
- Modify: `src/main.js:152-178`（移除 `bindTabEvents` 中的事件绑定）
- Modify: `src/main.js:2393-2623`（在 `setupEventDelegation` 中添加 Tab 栏事件）

- [ ] **Step 1: 分析当前绑定**

`bindTabEvents()`（`main.js:152-178`）在每次 `renderTabBar()` 时被调用，向 `tabBar` 绑定了 `mousedown` 和 `click` 两个监听器。`tabBar` 元素不会被替换，所以监听器不断累积。

当前功能：
1. `mousedown` → 记录 `tabDragState`，启动拖拽
2. `click` → 防抖检测后调 `switchTab`

- [ ] **Step 2: 清空 `bindTabEvents` 函数体**

将 `bindTabEvents` 改为空函数，保留声明（防止调用处报错）：

```js
// 原 main.js:152-178
function bindTabEvents() {
    var tabBar = document.getElementById('tabBar');

    // 事件委托：mousedown 记录拖拽目标
    tabBar.addEventListener('mousedown', function(e) {
        var tab = e.target.closest('.tab');
        if (!tab || e.button !== 0) return;
        var allTabs = tabBar.querySelectorAll('.tab');
        var idx = Array.from(allTabs).indexOf(tab);
        tabDragState = { tab: tab, idx: idx, startY: e.clientY };
    });

    // 事件委托：click 切换 Tab（带防抖）
    tabBar.addEventListener('click', function(e) {
        var tab = e.target.closest('.tab');
        if (!tab || tabWasDragged) return;
        var tabId = tab.dataset.tab;
        if (tabId !== currentTab) {
            var clickTime = Date.now();
            if (clickTime - _lastTabClick < TAB_DEBOUNCE_MS) {
                window.__log.perf('TabSwitch', '防抖忽略切到' + tabId, { interval: clickTime - _lastTabClick });
                return;
            }
            _lastTabClick = clickTime;
            switchTab(tabId);
        }
    });
}

// 修改后:
function bindTabEvents() {
    // 已迁移至 setupEventDelegation，此函数保留为空
}
```

- [ ] **Step 3: 在 `setupEventDelegation` 中添加 Tab 栏事件**

在 `main.js` 的 `setupEventDelegation()` 函数中（约第 2393 行），添加 Tab 栏事件处理区块。放在 `gameTabs` 处理之前：

```js
function setupEventDelegation() {

    // ─── Tab 栏（事件从 bindTabEvents 迁移至此，一次性绑定）───
    var tabBar = document.getElementById('tabBar');

    tabBar.addEventListener('mousedown', function(e) {
        var tab = e.target.closest('.tab');
        if (!tab || e.button !== 0) return;
        var allTabs = tabBar.querySelectorAll('.tab');
        var idx = Array.from(allTabs).indexOf(tab);
        tabDragState = { tab: tab, idx: idx, startY: e.clientY };
    });

    tabBar.addEventListener('click', function(e) {
        var tab = e.target.closest('.tab');
        if (!tab || tabWasDragged) return;
        var tabId = tab.dataset.tab;
        if (tabId !== currentTab) {
            var clickTime = Date.now();
            if (clickTime - _lastTabClick < TAB_DEBOUNCE_MS) {
                window.__log.perf('TabSwitch', '防抖忽略切到' + tabId, { interval: clickTime - _lastTabClick });
                return;
            }
            _lastTabClick = clickTime;
            switchTab(tabId);
        }
    });

    // ─── 游戏标签 ───（后续代码不变）
    gameTabs.addEventListener('click', async function(e) {
        // ...
```

- [ ] **Step 4: 验证无重复绑定**

```bash
# 确认 bindTabEvents 正文为空
grep -n "function bindTabEvents" src/main.js
grep -n "bindTabEvents" src/main.js | head -5
```
Expected: `bindTabEvents` 定义中无 `addEventListener` 调用。

- [ ] **Step 5: Commit**

```bash
git add src/main.js
git commit -m "fix: move Tab bar events from bindTabEvents to setupEventDelegation to prevent listener accumulation"
```

---

## 阶段二：代码脆弱性 (W1-W4)

### Task 5: `_saveInProgress` 加超时兜底

**Files:**
- Modify: `src/main.js:2240-2246`

- [ ] **Step 1: 添加超时强制解锁**

在 `autoSave` 函数中，`_saveInProgress = true` 后启动 5 秒超时：

```js
// 原代码 (main.js:2240-2246):
_saveInProgress = true;
saveConfigToBackend().then(function() {
    _saveInProgress = false;
    syncPendingReminders();
}).catch(function() {
    _saveInProgress = false;
});

// 修改后:
_saveInProgress = true;
var _saveTimeout = setTimeout(function() {
    _saveInProgress = false;
}, 5000);
saveConfigToBackend().then(function() {
    clearTimeout(_saveTimeout);
    _saveInProgress = false;
    syncPendingReminders();
}).catch(function() {
    clearTimeout(_saveTimeout);
    _saveInProgress = false;
});
```

- [ ] **Step 2: 验证改动范围**

```bash
git diff src/main.js
```
Expected: 仅 `autoSave` 函数内变更。

- [ ] **Step 3: Commit**

```bash
git add src/main.js
git commit -m "fix: add 5s timeout safeguard for _saveInProgress lock"
```

---

### Task 6: 清理孤儿 pending_reminder

**Files:**
- Modify: `src/main.js:1914-1945`

- [ ] **Step 1: 在 `syncPendingReminders` 开头添加孤儿清理**

在 `main.js:1915` 后添加：

```js
// 原: 
function syncPendingReminders() {
    currentConfig.pending_reminders = currentConfig.pending_reminders || [];
    var changed = false;
    (currentConfig.todos || []).forEach(function(t) {

// 修改后:
function syncPendingReminders() {
    currentConfig.pending_reminders = currentConfig.pending_reminders || [];
    var changed = false;

    // 清理已删除待办的孤儿 pending_reminder
    var todoIds = new Set((currentConfig.todos || []).map(function(t) { return t.id; }));
    var before = currentConfig.pending_reminders.length;
    currentConfig.pending_reminders = currentConfig.pending_reminders.filter(function(r) { return todoIds.has(r.todo_id); });
    if (currentConfig.pending_reminders.length !== before) changed = true;

    (currentConfig.todos || []).forEach(function(t) {
```

- [ ] **Step 2: 验证改动范围**

```bash
git diff src/main.js
```
Expected: 仅 `syncPendingReminders` 函数开头新增孤儿清理逻辑。

- [ ] **Step 3: Commit**

```bash
git add src/main.js
git commit -m "fix: clean up orphan pending_reminders for deleted todos"
```

---

### Task 7: 时间转换操作加防连击

**Files:**
- Modify: `src/main.js:367-440`（时间转换事件委托）

- [ ] **Step 1: 在时间转换面板的 click 委托中添加操作中的禁用**

在 `main.js:367-440`，对异步操作（`reset-tz`、`to-ts`、`to-dt`、`delete-tz`）添加按钮禁用/恢复：

```js
// reset-tz 分支 (第 385-390 行)
} else if (action === 'reset-tz') {
    btn.disabled = true;
    tsInput.value = getCurrentTimestampMs();
    try {
        const response = await invoke('convert_to_datetime', { request: { timestamp_ms: parseInt(tsInput.value, 10), timezone: set.timezone } });
        if (response.success) dtInput.value = formatDatetimeStr(response.datetime_str, set.datetime_format);
    } catch (err) { /* ignore */ }
    btn.disabled = false;
```

```js
// delete-tz 分支 (第 391-396 行)
} else if (action === 'delete-tz') {
    btn.disabled = true;
    const saved = saveTimezoneValues();
    await invoke('remove_timezone_set', { setId });
    currentConfig = await invoke('get_config');
    renderTimezoneSets();
    restoreTimezoneValues(saved);
    // btn 已被重建，不需要恢复 disabled
```

```js
// to-ts 分支 (第 397-405 行)
} else if (action === 'to-ts') {
    const dtStr = dtInput.value.trim();
    if (!dtStr) return;
    btn.disabled = true;
    try {
        const response = await invoke('convert_to_timestamp', { request: { datetime_str: dtStr, timezone: set.timezone } });
        tsInput.value = response.success ? String(response.timestamp) : 'error';
    } catch (err) {
        tsInput.value = 'error';
    }
    btn.disabled = false;
```

```js
// to-dt 分支 (第 406-420 行)
} else if (action === 'to-dt') {
    const tsStr = tsInput.value.trim();
    if (!tsStr) return;
    const ts = parseInt(tsStr, 10);
    if (isNaN(ts)) return;
    btn.disabled = true;
    try {
        const response = await invoke('convert_to_datetime', { request: { timestamp_ms: ts, timezone: set.timezone } });
        if (response.success) {
            dtInput.value = formatDatetimeStr(response.datetime_str, set.datetime_format);
        } else {
            dtInput.value = 'error';
        }
    } catch (err) {
        dtInput.value = 'error';
    }
    btn.disabled = false;
```

- [ ] **Step 2: Commit**

```bash
git add src/main.js
git commit -m "fix: add disabled guard to timezone async operations to prevent double-send"
```

---

### Task 8: `refreshBackupList` 加执行锁

**Files:**
- Modify: `src/main.js:831-895`

- [ ] **Step 1: 添加 `_backupListLock` 变量**

在文件顶部 `_refreshLock` 定义旁（约第 58 行）添加：

```js
// 原代码 (main.js:58):
let _refreshLock = false;

// 修改后:
let _refreshLock = false;
let _backupListLock = false;
```

- [ ] **Step 2: 在 `refreshBackupList` 函数头部加锁**

修改 `main.js:831-837`：

```js
// 原代码 (main.js:831-837):
async function refreshBackupList() {
    var t0 = performance.now();
    if (!selectedGameId || !selectedSlotId) {
        backupList.innerHTML = '<div class="empty-hint">请先选择游戏和存档位</div>';
        backupListTitle.textContent = '备份记录';
        return;
    }

// 修改后:
async function refreshBackupList() {
    if (_backupListLock) {
        window.__log.perf('Backup', '阻断: refreshBackupList 锁占用中');
        return;
    }
    _backupListLock = true;
    var t0 = performance.now();
    if (!selectedGameId || !selectedSlotId) {
        backupList.innerHTML = '<div class="empty-hint">请先选择游戏和存档位</div>';
        backupListTitle.textContent = '备份记录';
        _backupListLock = false;
        return;
    }
```

- [ ] **Step 3: 在所有 return 前和函数末尾释放锁**

找到 `refreshBackupList` 中的所有 `return` 语句（`main.js:854-856` 的 `backups.length === 0` 分支和 `main.js:893` 的 catch 分支），在 return 前加 `_backupListLock = false`。

函数末尾 `main.js:895` 闭合前加：

```js
    // 在函数体末尾（main.js ~895 的 catch 之后、函数闭合之前）
    _backupListLock = false;
}
```

完整修改：

```js
// main.js ~854 的 backups.length === 0 分支:
if (backups.length === 0) {
    backupList.innerHTML = '<div class="empty-hint">暂无备份</div>';
    window.__log.perf('Render', 'refreshBackupList', { ms: +(performance.now() - t0).toFixed(2), backups: 0, ipc: ipcMs });
    _backupListLock = false;
    return;
}

// main.js ~893 的 catch 分支:
} catch (err) {
    backupList.innerHTML = `<div class="empty-hint">加载失败: ${escapeHtml(String(err))}</div>`;
    window.__log.perf('Render', 'refreshBackupList', { ms: +(performance.now() - t0).toFixed(2), error: String(err) });
}

// main.js ~895 的函数闭合处添加:
    _backupListLock = false;
}
```

- [ ] **Step 4: Commit**

```bash
git add src/main.js
git commit -m "fix: add _backupListLock to prevent concurrent refreshBackupList calls"
```

---

## 阶段三：设计优化 (D1-D6)

### Task 9: 配置自动备份（config.json.bak）

**Files:**
- Modify: `src/main.rs:475-491`（`save_config` 函数）

- [ ] **Step 1: 在 `save_config` 写文件前备份旧配置**

修改 `main.rs:475-491`：

```rust
fn save_config(app: &tauri::AppHandle, config: &AppConfig) {
    let path = config_path(app);
    if let Some(parent) = path.parent() {
        let _ = fs::create_dir_all(parent);
    }

    // 备份旧配置：写新配置前将已有 config.json 备份为 config.json.bak
    if path.exists() {
        let bak_path = path.with_extension("json.bak");
        let _ = fs::copy(&path, &bak_path);
    }

    if let Ok(json) = serde_json::to_string_pretty(config) {
        let tmp_path = path.with_extension("tmp");
        if let Err(e) = fs::write(&tmp_path, &json) {
            log_error(app, &format!("写入临时配置文件失败: {}", e));
            return;
        }
        if let Err(e) = fs::rename(&tmp_path, &path) {
            log_error(app, &format!("重命名配置文件失败: {}", e));
            let _ = fs::remove_file(&tmp_path);
        }
    }
}
```

- [ ] **Step 2: 编译检查**

```bash
cargo check
```
Expected: 编译成功，无警告。

- [ ] **Step 3: Commit**

```bash
git add src/main.rs
git commit -m "feat: auto-backup config.json to config.json.bak before write"
```

---

### Task 10: 移除加载遮罩无效的 `backdrop-filter`

**Files:**
- Modify: `src/styles.css:1802-1803`

- [ ] **Step 1: 删除无效属性**

```css
/* 原代码 (styles.css:1802-1803) */
.loading-overlay {
  /* ...其他属性... */
  backdrop-filter: blur(4px);
  -webkit-backdrop-filter: blur(4px);
}

/* 修改后：删除 backdrop-filter 两行 */
.loading-overlay {
  /* ...其他属性不变... */
  /* 删除 backdrop-filter: blur(4px); */
  /* 删除 -webkit-backdrop-filter: blur(4px); */
}
```

- [ ] **Step 2: Commit**

```bash
git add src/styles.css
git commit -m "refactor: remove ineffective backdrop-filter on loading overlay"
```

---

### Task 11: 删除重复的 `--radius-glass` 定义

**Files:**
- Modify: `src/styles.css:54`

- [ ] **Step 1: 删除间距区的重复定义**

第 54 行位于间距区，删除：

```css
/* 原 styles.css:52-55 */
  --space-xl: 24px;
  --radius-glass: 14px;  /* ← 删除此行（第 38 行已定义） */

  --transition: 0.2s cubic-bezier(0.22, 1, 0.36, 1);
```

- [ ] **Step 2: Commit**

```bash
git add src/styles.css
git commit -m "refactor: remove duplicate --radius-glass definition"
```

---

### Task 12: 节假日背景色改为 CSS 变量

**Files:**
- Modify: `src/styles.css:376-377,390-393`

- [ ] **Step 1: 在 `:root` 中添加节假日相关变量**

在 `:root` 变量区添加（约第 33 行 pin-color 之后）：

```css
  --pin-color: #fbbf24;
  --holiday-accent: 139, 92, 246;  /* 新增 */
```

- [ ] **Step 2: 在 `:root` 的 body.light 中添加覆盖**

在 `body.light` 中（约第 83 行）添加：

```css
  --accent-rgb: 59, 130, 246;
  --holiday-accent: 139, 92, 246;  /* 新增：亮色模式不改变紫色调 */
```

- [ ] **Step 3: 引用变量替换硬编码值**

```css
/* 原 styles.css:376-377 */
.settings-group.holiday {
  background: rgba(139, 92, 246, 0.04);
  border-color: rgba(139, 92, 246, 0.12);
}

/* 修改后 */
.settings-group.holiday {
  background: rgba(var(--holiday-accent), 0.04);
  border-color: rgba(var(--holiday-accent), 0.12);
}
```

```css
/* 原 styles.css:390-393 */
body.light .settings-group.holiday {
  background: rgba(139, 92, 246, 0.03);
  border-color: rgba(139, 92, 246, 0.18);
}

/* 修改后 */
body.light .settings-group.holiday {
  background: rgba(var(--holiday-accent), 0.03);
  border-color: rgba(var(--holiday-accent), 0.18);
}
```

- [ ] **Step 4: Commit**

```bash
git add src/styles.css
git commit -m "refactor: replace hardcoded holiday purple with --holiday-accent CSS variable"
```

---

## 设计优化（复杂项，标记但暂不实施）

以下两项因涉及较多改动，标记为待讨论：

| ID | 描述 | 原因 | 涉及文件 |
|----|------|------|----------|
| D1 | 删除备份移入 `.trash` | 需要新增备份清理逻辑，涉 Rust CRUD 修改 | main.rs |
| D3 | Emoji → SVG 统一 | 替换时间转换面板和设置面板的 emoji 为内联 SVG，涉 JS 和 CSS 多处 | main.js, styles.css |
