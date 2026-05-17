# 设置面板改造设计文档

## 概述

将设置从模态弹窗（`modal-overlay`）改为独立面板，与其他 4 个功能面板共用同一套 Panel 切换机制。

## 交互逻辑

### 进入/退出
- **进入设置**：点击标题栏齿轮图标 ⚙️
- **退出设置**：点击设置内容区左上角「← 退出设置」按钮，或再次点击标题栏 ⚙️（蓝色高亮态）
- 退出后回到进入设置前所在的面板

### 设置模式下
- **Tab 栏**：显示静态半透明 ⚙️ 图标（`opacity: 0.6`，无 `cursor:pointer`），作为视觉标识，不响应点击
- **Tab 栏常规图标**：完全隐藏
- **标题栏齿轮**：蓝色高亮（`color: #4b8bf4`），点击可退出
- **面板切换**：设置面板和其他 4 个面板互斥，通过 `position: absolute` + `opacity` 切换

### 不可行的操作
- 点击 Tab 栏不能退出设置（Tab 栏已隐藏）
- 设置面板内不能拖拽（Tab 拖拽仅用于常规面板）

## HTML 变化（`index.html`）

### 新增：`#panel-settings`

在 `<div class="content">` 内，日志面板之后，添加第 5 个面板：

```html
<div class="panel" id="panel-settings">
    <div class="panel-inner">
        <div class="settings-header">
            <button class="settings-back-btn" id="settingsBackBtn">← 退出设置</button>
            <h1 class="settings-title">⚙️ 设置</h1>
        </div>
        <!-- 设置内容：从原 settingsOverlay 迁移 -->
        ...
    </div>
</div>
```

### 删除

删除原 `#settingsOverlay` 模态弹窗（`index.html` 中第 148-198 行）。

### 新增：节假日编辑模态框

独立 modal，与待办编辑弹框（`.todo-edit-modal`）复用同一套 modal 样式：

```html
<div class="modal-overlay" id="holidayModal" style="display:none">
    <div class="modal">
        <!-- 节假日 JSON 编辑内容 -->
    </div>
</div>
```

## CSS 变化（`styles.css`）

### 新增

```css
#panel-settings .panel-inner {
    overflow-y: auto;  /* 内容过长时滚动 */
}

.settings-header {
    display: flex;
    align-items: center;
    border-bottom: 1px solid var(--border);
    padding-bottom: 10px;
    margin-bottom: 14px;
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
}

.settings-back-btn:hover {
    background: var(--surface-hover);
}

/* 设置模式下的静态 Tab */
.title-bar-btn.active {
    color: var(--accent);
}

/* Tab 栏设置状态 */
.tab-bar.settings-mode .tab { display: none; }
.tab-bar.settings-mode .tab-settings-indicator { display: flex; }
```

### 删除

删除 `.modal-overlay` 中设置弹窗相关的不再需要的样式（保留通用 modal 样式供节假日编辑使用）。

### 保留

`modal-overlay`、`modal`、`modal-header`、`modal-close` 等通用 modal 样式保留，供节假日编辑和待办编辑使用。

## JS 变化（`main.js`）

### 新增函数

```js
// 设置状态
let _previousTab = 'convert';  // 进入设置前的面板
let _isSettingsActive = false;

function toggleSettings() {
    if (_isSettingsActive) {
        // 退出设置，回到之前的面板
        _isSettingsActive = false;
        switchTab(_previousTab);
        settingsBtn.classList.remove('active');
        // 重新渲染 Tab 栏恢复常规图标
        renderTabBar();
    } else {
        // 进入设置
        _previousTab = currentTab;
        _isSettingsActive = true;
        settingsBtn.classList.add('active');
        // 切换面板
        switchTab('settings');
        // 重新渲染 Tab 栏显示静态设置图标
        renderSettingsTabBar();
    }
}
```

### 新增：`renderSettingsTabBar()`

```js
function renderSettingsTabBar() {
    const tabBar = document.getElementById('tabBar');
    // 仅显示静态设置图标，不可点击
    tabBar.innerHTML = '<div class="tab-settings-indicator" title="设置（当前）">⚙️</div>';
}
```

### 修改：`settingsBtn` 事件

```js
settingsBtn.addEventListener('click', () => {
    updateSettingsDisplay();
    toggleSettings();
});
```

### 修改：`switchTab()`

在 `switchTab` 中添加对设置模式的检测：如果当前在设置模式且调用了 `switchTab` 切换常规面板，自动退出设置模式。

```js
function switchTab(tabId) {
    if (tabId === 'settings') {
        // 特殊处理：settings 不是一个真实的 Tab
        _switchLock = false;
        return;
    }
    // 正常切换逻辑...
    if (_isSettingsActive) {
        _isSettingsActive = false;
        settingsBtn.classList.remove('active');
        renderTabBar();
    }
}
```

### 修改：面板切换逻辑

`switchTab` 中需要支持 `'settings'` 这个特殊 ID。设置面板 ID 为 `panel-settings`，但 settings 不在 `TAB_DEFS` 中也没有 `.tab[data-tab="settings"]`。切换时：
1. 不修改任何 Tab 的 active 状态（Tab 栏由 `renderSettingsTabBar` 管理）
2. 移除所有面板的 active 类（`document.querySelectorAll('.panel').forEach(p => p.classList.remove('active'))`）
3. 给 `#panel-settings` 添加 active 类

### 改造：节假日编辑

将 `openHolidayEditor()` 的渲染目标从原来的 `settingsOverlay` 内内联编辑器改为独立模态框。使用 `#holidayModal` 覆盖层，与待办编辑弹框相同的交互模式。

### 删除

- `settingsCloseBtn` 事件监听器（不再需要）
- `settingsOverlay` 的 `click` 关闭事件
- 所有 `settingsOverlay.style.display = 'none'` 调用

### 保留

- `updateSettingsDisplay()` — 仍然需要
- `applyTheme()` — 不变
- `themeSlider`、`autoStartToggle`、`trayToggle`、`reminderToggle` 事件监听 — 不变
- `settingsSetDirBtn`、`settingsOpenDirBtn` 事件监听 — 不变
- 所有节假日管理相关函数（`renderHolidayYears`、`openHolidayEditor`、`parseAndPreviewHolidayJSON` 等）— 但 `openHolidayEditor` 渲染位置改为 modal

## 数据流

无变化。设置面板中的交互直接修改 `currentConfig` 内存对象，然后调用 `saveConfigToBackend()` 持久化。

## 涉及文件

| 文件 | 改动类型 | 说明 |
|------|---------|------|
| `src/index.html` | 修改 | 加 `#panel-settings`，删 `#settingsOverlay`，加 `#holidayModal` |
| `src/styles.css` | 修改 | 加设置面板滚动/退出按钮/静态 Tab 样式，删冗余 modal 样式 |
| `src/main.js` | 修改 | 加 `toggleSettings()` / `renderSettingsTabBar()`，改齿轮事件、`switchTab()`，节假日编辑改 modal |

## 边界情况

- 如果设置内容很长（如多年节假日配置），面板内滚动条正常工作
- 标题栏齿轮高亮与设置模式状态同步
- 应用启动时不在设置模式
- 切换主题时设置面板内颜色正常
- 节假日编辑 modal 关闭后不影响设置面板状态
