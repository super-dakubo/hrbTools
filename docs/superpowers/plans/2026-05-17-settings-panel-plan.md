# 设置面板改造 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 将设置从模态弹窗改为独立面板，与其他 4 个面板共用同一套 `position:absolute + opacity` 切换机制。

**Architecture:** 新增 `#panel-settings` 面板，删除 `#settingsOverlay` 模态框。Tab 栏在设置模式下渲染静态设置图标，隐藏常规 Tab。退出按钮位于设置面板内容区左上角。节假日编辑改为动态创建的独立模态框。

**Tech Stack:** 原生 HTML/CSS/JS, Tauri 2.0

---

### Task 1: HTML — 新增设置面板 + 删除设置弹窗

**Files:**
- Modify: `src/index.html` (lines 42-198)

- [ ] **Step 1: 在日志面板之后插入 `#panel-settings`**

在 `src/index.html` 的日志面板 `<div class="panel" id="panel-log">` 结束之后（line 142 `</div>`），插入设置面板 HTML：

```html
        <!-- 设置面板 -->
        <div class="panel" id="panel-settings">
            <div class="panel-inner">
                <div class="settings-header">
                    <button class="settings-back-btn" id="settingsBackBtn">← 退出设置</button>
                    <h1 class="settings-title">⚙️ 设置</h1>
                </div>
                <div class="input-group">
                    <label>备份根目录</label>
                    <div class="row">
                        <span id="settingsBackupRoot" class="path-hint">未设置</span>
                        <button id="settingsSetDirBtn" class="btn-small">更改</button>
                        <button id="settingsOpenDirBtn" class="btn-small">打开</button>
                    </div>
                </div>
                <div class="input-group">
                    <label>主题模式</label>
                    <div id="themeSlider" class="theme-slider" data-pos="0">
                        <div class="theme-indicator"></div>
                        <span class="opt" data-theme="system">🌓 跟随系统</span>
                        <span class="opt" data-theme="dark">🌙 暗色</span>
                        <span class="opt" data-theme="light">☀️ 亮色</span>
                    </div>
                </div>
                <div class="input-group">
                    <div class="row" style="justify-content:space-between;margin-top:12px;">
                        <label style="margin:0;">开机自启</label>
                        <span class="toggle-switch" id="autoStartToggle" data-state="off"><span class="toggle-thumb"></span></span>
                    </div>
                    <div class="row" style="justify-content:space-between;margin-top:8px;">
                        <label style="margin:0;">最小化到托盘</label>
                        <span class="toggle-switch" id="trayToggle" data-state="on"><span class="toggle-thumb"></span></span>
                    </div>
                    <div class="row" style="justify-content:space-between;margin-top:8px;">
                        <label style="margin:0;">启用提醒</label>
                        <span class="toggle-switch" id="reminderToggle" data-state="on"><span class="toggle-thumb"></span></span>
                    </div>
                </div>
                <div class="input-group">
                    <label>节假日配置</label>
                    <div id="holidayYearsList"></div>
                    <div class="row" style="margin-top:8px;">
                        <select id="holidayYearSelect" class="holiday-year-select"></select>
                        <button id="holidayAddBtn" class="btn-small">添加</button>
                    </div>
                </div>
                <div class="settings-hint">更多设置项将陆续添加</div>
            </div>
        </div>
```

注意：与原来的设置弹窗相比，此面板：
- 没有 `.modal-header` / `.modal-close`（用 `.settings-header` 替代）
- 没有 `#holidayEditor` 内联容器（改为动态 modal）
- `.panel-inner` 没有设置 `overflow-y: auto`（由 CSS 控制）

- [ ] **Step 2: 删除原设置弹窗**

删除 `src/index.html` 中 `#settingsOverlay` 的整个 div（lines 147-198）：

```
<!-- 设置弹窗 -->
<div class="modal-overlay" id="settingsOverlay" style="display:none">
    ...
</div>
```

- [ ] **Step 3: 验证 HTML 结构**

确认 `</div>`（line 144，content 的闭合）正确闭合，`#panel-settings` 在其内部。确认没有残留的 `#settingsOverlay`。

---

### Task 2: CSS — 新增设置面板样式 + 齿轮高亮

**Files:**
- Modify: `src/styles.css`

- [ ] **Step 1: 新增设置面板专属样式**

在 `.panel-inner` 样式块之后（line 319 附近），添加：

```css
/* ==================== 设置面板 ==================== */
#panel-settings .panel-inner {
    overflow-y: auto;
}

.settings-header {
    display: flex;
    align-items: center;
    border-bottom: 1px solid var(--border);
    padding-bottom: 10px;
    margin-bottom: 14px;
}

.settings-title {
    font-size: var(--font-md);
    font-weight: 600;
    color: var(--text);
    margin: 0 0 0 12px;
}

.settings-back-btn {
    font-size: var(--font-sm);
    padding: 3px 10px;
    border-radius: 6px;
    background: var(--surface);
    color: var(--text-secondary);
    cursor: pointer;
    display: flex;
    align-items: center;
    gap: 4px;
    border: none;
    flex-shrink: 0;
}

.settings-back-btn:hover {
    background: var(--surface-hover);
    color: var(--text);
}
```

- [ ] **Step 2: 新增齿轮高亮样式**

在标题栏按钮样式附近或在 `.title-bar-spacer` 之后，添加：

```css
.title-bar-btn.active {
    color: var(--accent);
}
```

- [ ] **Step 3: 删除不需要的 `.settings-hint`（保留复用）**

`.settings-hint` 仍然在设置面板中使用，保留不删。

---

### Task 3: JS — 修改设置入口 + 新增 toggleSettings / renderSettingsTabBar

**Files:**
- Modify: `src/main.js` (lines 1093-1106, 状态区)

**注意：遵守 panel-isolation 规则，只改设置弹窗相关代码，不动其他面板代码。**

- [ ] **Step 1: 在状态区添加设置模式变量**

在状态区（line 4 `let currentConfig` 附近），添加：

```js
let _isSettingsActive = false;
let _previousTab = 'convert';
```

- [ ] **Step 2: 替换 settingsBtn 事件**

将 lines 1095-1098：

```js
settingsBtn.addEventListener('click', () => {
    updateSettingsDisplay();
    settingsOverlay.style.display = 'flex';
});
```

改为：

```js
settingsBtn.addEventListener('click', () => {
    updateSettingsDisplay();
    toggleSettings();
});
```

- [ ] **Step 3: 删除 settingsCloseBtn 和 settingsOverlay 事件**

删除 lines 1100-1106：

```js
settingsCloseBtn.addEventListener('click', () => {
    settingsOverlay.style.display = 'none';
});

settingsOverlay.addEventListener('click', (e) => {
    if (e.target === settingsOverlay) settingsOverlay.style.display = 'none';
});
```

- [ ] **Step 4: 添加 toggleSettings + renderSettingsTabBar 函数**

在 `THEME_LABELS` 常量定义（line 1108）之前，添加：

```js
// ==================== 设置面板切换 ====================

function renderSettingsTabBar() {
    var tabBar = document.getElementById('tabBar');
    tabBar.innerHTML = '<div class="tab-settings-indicator" title="设置（当前）" style="display:flex;align-items:center;justify-content:center;height:100%;font-size:18px;color:var(--accent);opacity:0.6;cursor:default;">⚙️</div>';
}

function toggleSettings() {
    if (_isSettingsActive) {
        _isSettingsActive = false;
        settingsBtn.classList.remove('active');
        switchTab(_previousTab);
        renderTabBar();
    } else {
        _previousTab = currentTab;
        _isSettingsActive = true;
        settingsBtn.classList.add('active');
        // 直接操作面板而不是走 switchTab（避免锁和 Tab 逻辑）
        document.querySelectorAll('.panel').forEach(function(p) { p.classList.remove('active'); });
        var panel = document.getElementById('panel-settings');
        if (panel) panel.classList.add('active');
        document.querySelectorAll('.tab').forEach(function(t) { t.classList.remove('active'); });
        renderSettingsTabBar();
        window.__log.info('Settings', '进入设置面板');
    }
}
```

- [ ] **Step 5: 添加 settingsBackBtn 事件**

在 `updateSettingsDisplay` 函数定义之前，添加：

```js
// 设置面板退出按钮（事件委托，但用直接绑定因为 settingsBackBtn 是静态的）
document.getElementById('settingsBackBtn').addEventListener('click', function() {
    if (_isSettingsActive) toggleSettings();
});
```

- [ ] **Step 6: 修改 switchTab 兼容设置模式**

在 `switchTab` 函数（line 181）中，在 `_switchLock = true;` 之后添加设置模式检查：

```js
    // 如果当前在设置模式且切换到常规面板，先退出设置
    if (_isSettingsActive && tabId !== 'settings') {
        _isSettingsActive = false;
        settingsBtn.classList.remove('active');
        renderTabBar();
    }
```

找到 lines 191-197 的现有切换逻辑，不需要修改——`switchTab` 通过 `panel.classList` 操作，`#panel-settings` 上没有 `.tab[data-tab="settings"]`，所以 `document.querySelector('.tab[data-tab="' + tabId + '"]')` 返回 null，不会出错。

- [ ] **Step 7: 验证逻辑**

确认 `cargo tauri dev` 或使用 `cargo check` 验证无编译错误（JS 无编译步骤，检查语法）。

---

### Task 4: JS — 改造节假日编辑为动态模态框

**Files:**
- Modify: `src/main.js` (lines 1242-1301 `openHolidayEditor`)

- [ ] **Step 1: 重写 `openHolidayEditor` 为动态 modal**

将 `openHolidayEditor` 函数（lines 1242-1301）替换为创建动态 modal 的版本：

```js
function openHolidayEditor(year) {
    var existing = (currentConfig.holiday_data || []).find(function(h) { return h.year === year; });
    var defaultText = existing ? JSON.stringify(existing, null, 2) : getTemplateJSON(year);

    var oldEl = document.querySelector('.holiday-edit-overlay');
    if (oldEl) oldEl.remove();

    var overlay = document.createElement('div');
    overlay.className = 'holiday-edit-overlay modal-overlay';
    overlay.style.cssText = 'display:flex;';
    overlay.innerHTML = '<div class="modal" style="width:480px;">'
        + '<div class="modal-header">'
            + '<span class="modal-title">📅 ' + year + '年 节假日配置</span>'
            + '<button class="modal-close holiday-edit-close-btn">&times;</button>'
        + '</div>'
        + '<div class="modal-body">'
            + '<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px;">'
                + '<button class="btn-small" id="holidayCopyTemplate">复制模板</button>'
            + '</div>'
            + '<textarea id="holidayJsonInput" class="holiday-json-input" placeholder="编辑 JSON 配置" style="width:100%;height:200px;font-family:monospace;font-size:12px;padding:8px;border-radius:6px;border:1px solid var(--border);background:var(--input-bg);color:var(--text);resize:vertical;box-sizing:border-box;">' + escapeHtml(defaultText) + '</textarea>'
            + '<div id="holidayPreview" style="margin-top:8px;"></div>'
            + '<div style="margin-top:8px;display:flex;gap:8px;justify-content:flex-end;">'
                + '<button class="btn-small" id="holidaySaveBtn" style="display:none;">确认保存</button>'
                + '<button class="btn-small holiday-edit-close-btn">取消</button>'
            + '</div>'
        + '</div>'
        + '</div>';

    document.body.appendChild(overlay);

    function closeModal() {
        overlay.remove();
    }

    overlay.querySelectorAll('.holiday-edit-close-btn').forEach(function(btn) {
        btn.addEventListener('click', closeModal);
    });
    overlay.addEventListener('click', function(e) {
        if (e.target === overlay) closeModal();
    });

    document.getElementById('holidayCopyTemplate').addEventListener('click', function() {
        navigator.clipboard.writeText(getTemplateJSON(year)).catch(function() {
            alert('复制失败，请手动复制');
        });
    });

    document.getElementById('holidayJsonInput').addEventListener('input', function() {
        parseAndPreviewHolidayJSON(this.value, year);
    });

    document.getElementById('holidaySaveBtn').addEventListener('click', async function() {
        var text = document.getElementById('holidayJsonInput').value;
        var data;
        try {
            data = JSON.parse(text);
        } catch(e) {
            alert('JSON 格式错误，无法保存');
            return;
        }
        var list = currentConfig.holiday_data || [];
        var idx = list.findIndex(function(h) { return h.year === data.year; });
        if (idx !== -1) list[idx] = data;
        else list.push(data);
        currentConfig.holiday_data = list;
        await saveConfigToBackend();
        renderHolidayYears();
        closeModal();
        window.__log.info('Holiday', data.year + '年节假日配置已保存');
    });

    if (defaultText) {
        parseAndPreviewHolidayJSON(defaultText, year);
    }
}
```

关键变更：
- 从内联 `#holidayEditor`（`display:block/none`）改为动态创建/销毁的 `.holiday-edit-overlay` modal
- 复用 `modal-overlay` / `modal` / `modal-header` / `modal-close` 样式（todo edit modal 的同类模式）
- 移除旧的 `hide()` 实现，改为 `overlay.remove()`

- [ ] **Step 2: 验证**

检查 `parseAndPreviewHolidayJSON` 中引用的 `document.getElementById('holidaySaveBtn')` 仍有效（它在动态创建的 HTML 中）。

---

### Task 5: 验证 + 最终检查

- [ ] **Step 1: 运行 `cargo check`**

```bash
cargo check
```
预期：编译通过（未改 Rust 代码）。

- [ ] **Step 2: 运行 `cargo tauri dev`**

启动应用后检查：
- 观察加载是否正常，`loadingOverlay` 是否淡出
- 点击齿轮，应切换到设置面板，Tab 栏显示静态 ⚙️ 图标
- 设置面板内容完整：备份根目录、主题切换、三个开关、节假日列表
- 点击「← 退出设置」回到之前的面板
- 再次点击齿轮进入设置，再点齿轮退出
- 点节假日「编辑」→ 弹出 modal 编辑 JSON → 保存/取消正常
- 点节假日「添加」→ 年份选择 + 添加按钮正常
- Tab 拖拽功能在正常模式下不受影响

- [ ] **Step 3: git diff 检查**

```bash
git diff
```
确认每行改动对应需求中的一条：
1. HTML: 新增 `#panel-settings` + 删除 `#settingsOverlay` ✓
2. CSS: 新增设置面板滚动/退出按钮/齿轮高亮样式 ✓
3. JS: 新增 `toggleSettings`/`renderSettingsTabBar` + 改齿轮事件 + 改 `switchTab` + 删除弹窗事件 + 节假日编辑改 modal ✓
