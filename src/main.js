const invoke = (cmd, args) => window.__TAURI_INTERNALS__.invoke(cmd, args);

// ==================== 状态 ====================
let currentConfig = { backup_root: '', games: [], timezone_sets: [] };
let selectedGameId = '';
let selectedSlotId = '';
let filePathsBySlot = {};      // { "gameId:slotId": ["D:/saves/save.dat", "D:/saves/config.ini"] }
let currentHashesBySlot = {};  // { "gameId:slotId": { "save.dat": "abc", "config.ini": "def" } }
let _isSettingsActive = false;
let _previousTab = 'convert';

// ==================== DOM 引用 ====================

// 时间转换
const timezoneSets = document.getElementById('timezoneSets');
const addTimezoneBtn = document.getElementById('addTimezoneBtn');

// 标题栏按钮
const minimizeBtn = document.getElementById('minimizeBtn');
const maximizeBtn = document.getElementById('maximizeBtn');
const closeBtn = document.getElementById('closeBtn');

// 存档管理
const gameTabs = document.getElementById('gameTabs');
const slotTabs = document.getElementById('slotTabs');
const fileTagsContainer = document.getElementById('fileTags');
const browseFileBtn = document.getElementById('browseFileBtn');
const rehashBtn = document.getElementById('rehashBtn');
const saveBackupBtn = document.getElementById('saveBackupBtn');
const backupError = document.getElementById('backupError');
const backupSuccess = document.getElementById('backupSuccess');
const backupList = document.getElementById('backupList');
const backupListTitle = document.getElementById('backupListTitle');

// 设置
const settingsBtn = document.getElementById('settingsBtn');
const settingsBackupRoot = document.getElementById('settingsBackupRoot');
const settingsSetDirBtn = document.getElementById('settingsSetDirBtn');
const settingsOpenDirBtn = document.getElementById('settingsOpenDirBtn');
const themeSlider = document.getElementById('themeSlider');
const autoStartToggle = document.getElementById('autoStartToggle');
const trayToggle = document.getElementById('trayToggle');
const reminderToggle = document.getElementById('reminderToggle');

// ==================== Tab 栏管理 ====================
const TAB_DEFS = {
    convert: { icon: '<svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 3"/></svg>', label: '时间转换' },
    backup:  { icon: '<svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M4 4h16v16H4z"/><path d="M4 9h16"/><path d="M9 4v5"/><path d="M15 4v5"/><circle cx="9" cy="14" r="1.5"/><circle cx="15" cy="14" r="1.5"/></svg>', label: '存档管理' },
    todo:    { icon: '<svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><rect x="4" y="2" width="16" height="20" rx="2"/><path d="M9 11l2 2 4-4"/></svg>', label: '待办工具' },
    log:     { icon: '<svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z"/><path d="M14 2v6h6"/><path d="M8 13h8"/><path d="M8 17h4"/></svg>', label: '日志' },
};
const DEFAULT_TAB_ORDER = ['convert', 'backup', 'todo', 'log'];
let currentTab = 'convert';
let _switchLock = false;
let _lastTabClick = 0;
let _lastGameTabClick = 0;
let _lastSlotTabClick = 0;
let _refreshLock = false;
const TAB_DEBOUNCE_MS = 300;

function renderTabBar() {
    const tabBar = document.getElementById('tabBar');
    let order = currentConfig.tab_order && currentConfig.tab_order.length
        ? [...currentConfig.tab_order] : [...DEFAULT_TAB_ORDER];
    // 确保所有 Tab 都在 order 中
    DEFAULT_TAB_ORDER.forEach(id => { if (!order.includes(id)) order.push(id); });

    tabBar.innerHTML = order.map(id => {
        const def = TAB_DEFS[id];
        if (!def) return '';
        const active = id === currentTab ? ' active' : '';
        return `<div class="tab${active}" data-tab="${id}" role="button" tabindex="0" title="${def.label}">
            <span class="tab-icon">${def.icon}</span>
        </div>`;
    }).join('');

    bindTabEvents();
}

// ==================== Tab 拖拽（鼠标事件 + DOM 移动）====================
let tabDragState = null;
let tabWasDragged = false;

function getTabDropIndex(clientY) {
    const tabs = document.querySelectorAll('#tabBar .tab');
    for (let i = 0; i < tabs.length; i++) {
        const rect = tabs[i].getBoundingClientRect();
        if (clientY < rect.top + rect.height / 2) return i;
    }
    return document.querySelectorAll('#tabBar .tab').length - 1;
}

document.addEventListener('mousemove', function(e) {
    if (!tabDragState) return;

    if (!tabDragState.dragged && Math.abs(e.clientY - tabDragState.startY) > 5) {
        tabDragState.dragged = true;
        document.body.style.userSelect = 'none';
        // 给被拖拽的 tab 加 visual feedback
        if (tabDragState.tab) tabDragState.tab.classList.add('dragging');
    }
    if (!tabDragState.dragged) return;

    const allTabs = document.querySelectorAll('#tabBar .tab');
    const dropIdx = getTabDropIndex(e.clientY);
    allTabs.forEach(function(t, i) {
        t.classList.toggle('drop-indicator', i === dropIdx && i !== tabDragState.idx);
    });
});

document.addEventListener('mouseup', function(e) {
    if (!tabDragState) return;

    document.body.style.userSelect = '';
    document.querySelectorAll('#tabBar .tab').forEach(function(t) {
        t.classList.remove('dragging', 'drop-indicator');
    });

    if (tabDragState.dragged) {
        const dropIdx = getTabDropIndex(e.clientY);
        if (dropIdx !== tabDragState.idx && dropIdx >= 0) {
            // 移动 DOM 元素而不是全量重新渲染 —— 更流畅
            const tabBar = document.getElementById('tabBar');
            const allTabs = tabBar.querySelectorAll('.tab');
            const srcTab = allTabs[tabDragState.idx];
            const refTab = allTabs[dropIdx];
            if (srcTab && refTab) {
                if (dropIdx < tabDragState.idx) {
                    tabBar.insertBefore(srcTab, refTab);
                } else {
                    tabBar.insertBefore(srcTab, refTab.nextSibling);
                }
            }

            // 更新配置
            let order = currentConfig.tab_order && currentConfig.tab_order.length
                ? [...currentConfig.tab_order] : [...DEFAULT_TAB_ORDER];
            DEFAULT_TAB_ORDER.forEach(function(id) { if (!order.includes(id)) order.push(id); });
            var srcIdx = tabDragState.idx;
            var [moved] = order.splice(srcIdx, 1);
            order.splice(dropIdx, 0, moved);
            currentConfig.tab_order = order;
            saveConfigToBackend();
        }
        tabWasDragged = true;
        setTimeout(function() { tabWasDragged = false; }, 200);
    }

    tabDragState = null;
});

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

function switchTab(tabId) {
    var now = performance.now();
    window.__log.perf('TabSwitch', '请求切到' + tabId, { lock: _switchLock });

    if (_switchLock) {
        window.__log.perf('TabSwitch', '阻断: 切换锁占用中', { tabId: tabId });
        return;
    }
    _switchLock = true;

    // 如果当前在设置模式且切换到常规面板，先退出设置
    if (_isSettingsActive && tabId !== 'settings') {
        _isSettingsActive = false;
        settingsBtn.classList.remove('active');
        renderTabBar();
    }

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
    window.__log.perf('TabSwitch', '执行切到' + tabId, { dom: +(t1 - now).toFixed(2), action: +(t2 - t1).toFixed(2) });

    requestAnimationFrame(function() {
        requestAnimationFrame(function() {
            var renderEnd = performance.now();
            window.__log.perf('TabSwitch', '完成切到' + tabId, {
                dom: +(t1 - now).toFixed(2),
                action: +(t2 - t1).toFixed(2),
                render: +(renderEnd - t2).toFixed(2),
                total: +(renderEnd - now).toFixed(2)
            });
            _switchLock = false;
        });
    });

    // 安全兜底：5秒后强制解锁，防止锁永远不被释放
    setTimeout(function() {
        if (_switchLock) {
            window.__log.warn('TabSwitch', '强制解锁 switchTab (超时)');
            _switchLock = false;
        }
    }, 5000);
}

// ==================== 时间转换 ====================

const TIMEZONES = [
    { value: 'Asia/Shanghai', label: 'GMT+8 北京' },
    { value: 'Asia/Kolkata', label: 'GMT+5:30 印度' },
    { value: 'Asia/Tokyo', label: 'GMT+9 东京' },
    { value: 'UTC', label: 'GMT+0 UTC' },
    { value: 'America/New_York', label: 'GMT-5 纽约' },
    { value: 'Europe/London', label: 'GMT+0 伦敦' },
    { value: 'Australia/Sydney', label: 'GMT+10 悉尼' },
];

const DATETIME_FORMATS = [
    { value: '', label: 'YYYY-MM-DD HH:mm:ss' },
    { value: '%Y/%m/%d %H:%M:%S', label: 'YYYY/MM/DD HH:mm:ss' },
    { value: '%Y-%m-%d %H:%M', label: 'YYYY-MM-DD HH:mm' },
    { value: '%m-%d %H:%M', label: 'MM-DD HH:mm' },
];

function getCurrentTimestampMs() { return Date.now().toString(); }

function formatDatetimeStr(rustStr, format) {
    const parts = rustStr.split(' ');
    const dateParts = parts[0].split('-');
    const timeParts = parts[1].split(':');
    const Y = dateParts[0], M = dateParts[1], D = dateParts[2];
    const h = timeParts[0], m = timeParts[1], s = timeParts[2];
    if (!format) return `${Y}-${M}-${D} ${h}:${m}:${s}`;
    // 用 format 字符串中的 %Y/%m/%d/%H/%M/%S 占位符替换为实际值
    // 新增格式只需在 DATETIME_FORMATS 中添加，无需改此函数
    return format
        .replace('%Y', Y).replace('%m', M).replace('%d', D)
        .replace('%H', h).replace('%M', m).replace('%S', s);
}

function renderTimezoneSets() {
    var t0 = performance.now();
    const sorted = [...currentConfig.timezone_sets].sort((a, b) => {
        if (a.id === DEFAULT_TZ_SET_ID) return -1;
        if (b.id === DEFAULT_TZ_SET_ID) return 1;
        if (a.pinned !== b.pinned) return b.pinned - a.pinned;
        return a.sort_order - b.sort_order;
    });

    timezoneSets.innerHTML = sorted.map(set => {
        const isBeijing = set.id === DEFAULT_TZ_SET_ID;
        const tzOptions = TIMEZONES.map(tz =>
            `<option value="${tz.value}" ${set.timezone === tz.value ? 'selected' : ''}>${tz.label}</option>`
        ).join('');
        const formatOptions = DATETIME_FORMATS.map(f =>
            `<option value="${f.value}" ${set.datetime_format === f.value ? 'selected' : ''}>${f.label}</option>`
        ).join('');

        return `<div class="tz-set" data-set-id="${escapeHtml(set.id)}">
            <div class="tz-set-header">
                <div class="tz-set-header-left">
                    ${!isBeijing ? `<span class="tz-pin ${set.pinned ? 'on' : 'off'}" data-action="pin-tz">📌</span>` : ''}
                    ${isBeijing
                        ? `<span class="tz-label">GMT+8 北京</span>`
                        : `<select class="tz-tz-select" data-action="change-tz">${tzOptions}</select>`
                    }
                </div>
                <div class="tz-set-header-right">
                    <select class="tz-format-select" data-action="change-format">${formatOptions}</select>
                    <button class="tz-reset" data-action="reset-tz">reset</button>
                    ${!isBeijing ? `<button class="tz-delete" data-action="delete-tz">&times;</button>` : ''}
                </div>
            </div>
            <div class="tz-row">
                <span class="tz-input-wrap">
                    <input class="tz-datetime-input" placeholder="时间字符串..." data-set-id="${escapeHtml(set.id)}">
                    <button class="tz-clear" data-action="clear-dt" title="清空">&times;</button>
                </span>
                <button class="tz-copy" data-action="copy-dt" title="复制">📋</button>
                <div class="tz-arrows">
                    <button class="tz-arrow" data-action="to-ts">&rarr;</button>
                    <button class="tz-arrow" data-action="to-dt">&larr;</button>
                </div>
                <span class="tz-input-wrap">
                    <input class="tz-timestamp-input" placeholder="时间戳..." data-set-id="${escapeHtml(set.id)}">
                    <button class="tz-clear" data-action="clear-ts" title="清空">&times;</button>
                </span>
                <button class="tz-copy" data-action="copy-ts" title="复制">📋</button>
            </div>
        </div>`;
    }).join('');
    window.__log.perf('Render', 'renderTimezoneSets', { ms: +(performance.now() - t0).toFixed(2), sets: currentConfig.timezone_sets.length });
}

function saveTimezoneValues() {
    const state = {};
    timezoneSets.querySelectorAll('.tz-set').forEach(el => {
        const dt = el.querySelector('.tz-datetime-input');
        const ts = el.querySelector('.tz-timestamp-input');
        state[el.dataset.setId] = { dt: dt?.value || '', ts: ts?.value || '' };
    });
    return state;
}

function restoreTimezoneValues(saved) {
    timezoneSets.querySelectorAll('.tz-set').forEach(el => {
        const s = saved[el.dataset.setId];
        if (!s) return;
        const dt = el.querySelector('.tz-datetime-input');
        const ts = el.querySelector('.tz-timestamp-input');
        if (dt) dt.value = s.dt;
        if (ts) ts.value = s.ts;
    });
}

async function initTimezoneDefaults() {
    const setEls = timezoneSets.querySelectorAll('.tz-set');
    for (const setEl of setEls) {
        const setId = setEl.dataset.setId;
        const set = currentConfig.timezone_sets.find(s => s.id === setId);
        if (!set) continue;
        const tsInput = setEl.querySelector('.tz-timestamp-input');
        const dtInput = setEl.querySelector('.tz-datetime-input');
        if (!tsInput || tsInput.value) continue;
        tsInput.value = getCurrentTimestampMs();
        try {
            const ts = parseInt(tsInput.value, 10);
            const response = await invoke('convert_to_datetime', { request: { timestamp_ms: ts, timezone: set.timezone } });
            if (response.success && dtInput) {
                dtInput.value = formatDatetimeStr(response.datetime_str, set.datetime_format);
            }
        } catch (err) { /* ignore */ }
    }
}

// 事件委托：点击事件
timezoneSets.addEventListener('click', async (e) => {
    const btn = e.target.closest('[data-action]');
    if (!btn) return;
    const setEl = btn.closest('.tz-set');
    const setId = setEl.dataset.setId;
    const action = btn.dataset.action;
    const dtInput = setEl.querySelector('.tz-datetime-input');
    const tsInput = setEl.querySelector('.tz-timestamp-input');
    const set = currentConfig.timezone_sets.find(s => s.id === setId);
    if (!set) return;

    if (action === 'pin-tz') {
        await invoke('toggle_timezone_pin', { setId });
        set.pinned = !set.pinned;
        const saved = saveTimezoneValues();
        renderTimezoneSets();
        restoreTimezoneValues(saved);
    } else if (action === 'reset-tz') {
        tsInput.value = getCurrentTimestampMs();
        try {
            const response = await invoke('convert_to_datetime', { request: { timestamp_ms: parseInt(tsInput.value, 10), timezone: set.timezone } });
            if (response.success) dtInput.value = formatDatetimeStr(response.datetime_str, set.datetime_format);
        } catch (err) { /* ignore */ }
    } else if (action === 'delete-tz') {
        const saved = saveTimezoneValues();
        await invoke('remove_timezone_set', { setId });
        currentConfig = await invoke('get_config');
        renderTimezoneSets();
        restoreTimezoneValues(saved);
    } else if (action === 'to-ts') {
        const dtStr = dtInput.value.trim();
        if (!dtStr) return;
        try {
            const response = await invoke('convert_to_timestamp', { request: { datetime_str: dtStr, timezone: set.timezone } });
            tsInput.value = response.success ? String(response.timestamp) : 'error';
        } catch (err) {
            tsInput.value = 'error';
        }
    } else if (action === 'to-dt') {
        const tsStr = tsInput.value.trim();
        if (!tsStr) return;
        const ts = parseInt(tsStr, 10);
        if (isNaN(ts)) return;
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
    } else if (action === 'copy-dt') {
        const val = dtInput.value.trim();
        if (!val) return;
        await navigator.clipboard.writeText(val);
        const orig = btn.textContent;
        btn.textContent = '✓';
        setTimeout(() => { btn.textContent = orig; }, 1000);
    } else if (action === 'copy-ts') {
        const val = tsInput.value.trim();
        if (!val) return;
        await navigator.clipboard.writeText(val);
        const orig = btn.textContent;
        btn.textContent = '✓';
        setTimeout(() => { btn.textContent = orig; }, 1000);
    } else if (action === 'clear-dt') {
        dtInput.value = '';
    } else if (action === 'clear-ts') {
        tsInput.value = '';
    }
});

// 事件委托：变更事件
timezoneSets.addEventListener('change', async (e) => {
    const action = e.target.dataset.action;
    if (!action) return;
    const setEl = e.target.closest('.tz-set');
    if (!setEl) return;
    const setId = setEl.dataset.setId;
    const set = currentConfig.timezone_sets.find(s => s.id === setId);
    if (!set) return;

    if (action === 'change-tz') {
        set.timezone = e.target.value;
        await invoke('update_timezone_set', { setId, timezone: set.timezone, datetimeFormat: set.datetime_format });
    } else if (action === 'change-format') {
        set.datetime_format = e.target.value;
        await invoke('update_timezone_set', { setId, timezone: set.timezone, datetimeFormat: set.datetime_format });
    }
});

// 新增时区
addTimezoneBtn.addEventListener('click', async () => {
    const saved = saveTimezoneValues();
    await invoke('add_timezone_set');
    currentConfig = await invoke('get_config');
    renderTimezoneSets();
    restoreTimezoneValues(saved);
    await initTimezoneDefaults();
});

// 标题栏窗口控制
minimizeBtn.addEventListener('click', () => invoke('window_minimize'));
maximizeBtn.addEventListener('click', () => invoke('window_toggle_maximize'));
closeBtn.addEventListener('click', () => invoke('window_close'));

// ==================== 配置管理 ====================

async function loadConfig() {
    var tStartup = performance.now();
    // 使用头部脚本预热的 IPC 调用（冷启动已在 HTML 解析阶段完成）
    var config = window.__configPromise ? await window.__configPromise : null;
    if (!config) config = await invoke('get_config');
    currentConfig = config;
    // 迁移旧 reminder.datetime → workday_time/restday_time（仅重复待办）
    (currentConfig.todos || []).forEach(function(t) {
        if (t.reminder && !t.reminder.workday_time && !t.reminder.restday_time && t.reminder.datetime && t.repeat) {
            t.reminder.workday_time = t.reminder.datetime.slice(11, 16);
            t.reminder.restday_time = t.reminder.workday_time;
        }
    });
    var tIpc = performance.now();
    applyTheme(currentConfig.theme || 'system');
    updateSettingsDisplay();
    // 初始化 Tab
    const order = currentConfig.tab_order && currentConfig.tab_order.length
        ? currentConfig.tab_order : DEFAULT_TAB_ORDER;
    currentTab = order[0];
    renderTabBar();
    var tBar = performance.now();
    switchTab(currentTab);
    renderTimezoneSets();
    var tTz = performance.now();
    await initTimezoneDefaults();
    if (currentConfig.games.length > 0) {
        selectedGameId = currentConfig.games[0].id;
        if (currentConfig.games[0].slots.length > 0) {
            selectedSlotId = currentConfig.games[0].slots[0].id;
        }
    }
    renderGameTabs();
    renderSlotTabs();
    restoreFilePaths();
    await refreshCurrentHashes();
    refreshBackupList();

    if (window.__log && window.__log.perf) {
        window.__log.perf('Startup', 'loadConfig IPC', { ms: +(tIpc - tStartup).toFixed(2) });
        window.__log.perf('Startup', 'loadConfig tabBar', { ms: +(tBar - tIpc).toFixed(2) });
        window.__log.perf('Startup', 'loadConfig tz', { ms: +(tTz - tBar).toFixed(2) });
        window.__log.perf('Startup', 'loadConfig total', { ms: +(performance.now() - tStartup).toFixed(2) });
    }

    // 在第一个面板底部显示启动耗时
    var startupTiming = document.getElementById('startupTiming');
    if (startupTiming) {
        var totalMs = +(performance.now() - tStartup).toFixed(1);
        var ipcMs = +(tIpc - tStartup).toFixed(1);
        var renderMs = +(tBar - tIpc).toFixed(1);
        startupTiming.textContent = '启动: ' + totalMs + 'ms (IPC: ' + ipcMs + 'ms, 渲染: ' + renderMs + 'ms)';
    }
}

async function saveConfigToBackend() {
    await invoke('set_config', { config: currentConfig });
}

// ==================== 文件标签管理 ====================

function getCurrentFilePaths() {
    if (!selectedGameId || !selectedSlotId) return [];
    const key = selectedGameId + ':' + selectedSlotId;
    return filePathsBySlot[key] || [];
}

function setCurrentFilePaths(paths) {
    if (!selectedGameId || !selectedSlotId) return;
    const key = selectedGameId + ':' + selectedSlotId;
    filePathsBySlot[key] = paths;
    const game = currentConfig.games.find(g => g.id === selectedGameId);
    if (!game) return;
    const slot = game.slots.find(s => s.id === selectedSlotId);
    if (!slot) return;
    slot.file_paths = paths;
    saveConfigToBackend();
}

function renderFileTags() {
    var t0 = performance.now();
    if (!fileTagsContainer) return;
    const paths = getCurrentFilePaths();
    if (paths.length === 0) {
        fileTagsContainer.innerHTML = '<span class="empty-hint" style="padding:0.3rem 0;font-size:0.78rem;">暂无文件，点击 + 添加</span>'
            + '<button class="file-tag-add" id="addFileBtn" title="添加文件">+</button>';
    } else {
        fileTagsContainer.innerHTML = paths.map((fp, i) => {
            const fileName = fp.replace(/\\/g, '/').split('/').pop() || fp;
            return '<span class="file-tag" data-index="' + i + '" title="' + escapeHtml(fp) + '">'
                + escapeHtml(fileName)
                + '<span class="tag-close" data-action="remove-file" data-index="' + i + '">&times;</span>'
                + '</span>';
        }).join('') + '<button class="file-tag-add" id="addFileBtn" title="添加文件">+</button>';
    }

    window.__log.perf('Render', 'renderFileTags', { ms: +(performance.now() - t0).toFixed(2), files: paths.length });
    }

// ==================== 游戏标签渲染 ====================

function renderGameTabs() {
    var t0 = performance.now();
    const games = getSortedGames();
    gameTabs.innerHTML = games.map(g => {
        const activeClass = g.id === selectedGameId ? ' active' : '';
        return `<button class="game-tab${activeClass}" data-game-id="${escapeHtml(g.id)}"
                  title="双击改名">
                  <span class="tab-pin" data-action="pin-game" data-game-id="${escapeHtml(g.id)}"
                    style="font-size:0.75rem;color:${g.pinned ? '#fbbf24' : 'rgba(255,255,255,0.2)'}">&#128204;</span>
                  ${escapeHtml(g.name)}
                  <span class="tab-close" data-action="delete-game" data-game-id="${escapeHtml(g.id)}">&times;</span>
                </button>`;
    }).join('') + `<button class="game-tab-add" id="addGameBtn" title="新增游戏">+</button>`;

    window.__log.perf('Render', 'renderGameTabs', { ms: +(performance.now() - t0).toFixed(2), games: games.length });
}

function getSortedGames() {
    return [...currentConfig.games].sort((a, b) => {
        if (a.pinned !== b.pinned) return b.pinned - a.pinned;
        return a.name.localeCompare(b.name);
    });
}

function startInlineEditGame(tab) {
    const gameId = tab.dataset.gameId;
    const game = currentConfig.games.find(g => g.id === gameId);
    if (!game) return;
    const name = game.name;
    const input = document.createElement('input');
    input.value = name;
    input.addEventListener('keydown', async (e) => {
        if (e.key === 'Enter') {
            const newName = input.value.trim();
            if (newName && newName !== name) await renameGame(gameId, newName);
        } else if (e.key === 'Escape') {
            renderGameTabs();
            if (selectedGameId) renderSlotTabs();
        }
    });
    input.addEventListener('blur', async () => {
        const newName = input.value.trim();
        if (newName && newName !== name) await renameGame(gameId, newName);
        else { renderGameTabs(); if (selectedGameId) renderSlotTabs(); }
    });
    // Replace the text content but keep the close button
    while (tab.firstChild) tab.removeChild(tab.firstChild);
    tab.appendChild(input);
    // Add close button back
    const closeBtn = document.createElement('span');
    closeBtn.className = 'tab-close';
    closeBtn.dataset.action = 'delete-game';
    closeBtn.dataset.gameId = gameId;
    closeBtn.innerHTML = '&times;';
    tab.appendChild(closeBtn);
    input.focus();
    input.select();
}

async function renameGame(gameId, newName) {
    if (currentConfig.games.some(g => g.name === newName)) {
        alert('该游戏名已存在');
        renderGameTabs(); renderSlotTabs();
        return;
    }
    const game = currentConfig.games.find(g => g.id === gameId);
    if (game) game.name = newName;
    // Keys are ID-based, no need to update filePathsBySlot / currentHashesBySlot
    await saveConfigToBackend();
    renderGameTabs();
    renderSlotTabs();
    refreshBackupList();
}

async function toggleGamePin(gameId) {
    const result = await invoke('toggle_game_pin', { gameId: gameId });
    if (result.success) {
        const game = currentConfig.games.find(g => g.id === gameId);
        if (game) game.pinned = !game.pinned;
        renderGameTabs();
    }
}

// ==================== 存档位标签渲染 ====================

function renderSlotTabs() {
    var t0 = performance.now();
    if (!selectedGameId) { slotTabs.innerHTML = ''; window.__log.perf('Render', 'renderSlotTabs', { ms: +(performance.now() - t0).toFixed(2), slots: 0 }); return; }
    const game = currentConfig.games.find(g => g.id === selectedGameId);
    if (!game || game.slots.length === 0) {
        slotTabs.innerHTML = '<span class="slot-tabs-label">存档位</span>';
        window.__log.perf('Render', 'renderSlotTabs', { ms: +(performance.now() - t0).toFixed(2), slots: 0 }); return;
    }

    slotTabs.innerHTML = '<span class="slot-tabs-label">存档位</span>' +
        game.slots.map(s => {
            const activeClass = s.id === selectedSlotId ? ' active' : '';
            return `<button class="slot-tag${activeClass}" data-slot-id="${escapeHtml(s.id)}">
                      ${escapeHtml(s.name)}
                      <span class="tag-close" data-action="delete-slot" data-slot-id="${escapeHtml(s.id)}">&times;</span>
                    </button>`;
        }).join('') +
        `<button class="slot-tag-add" id="addSlotBtn" title="新增存档位">+</button>`;

    window.__log.perf('Render', 'renderSlotTabs', { ms: +(performance.now() - t0).toFixed(2), slots: game.slots.length });
}

function startInlineEditSlot(tag) {
    const game = currentConfig.games.find(g => g.id === selectedGameId);
    if (!game) return;
    const slotId = tag.dataset.slotId;
    const slot = game.slots.find(s => s.id === slotId);
    if (!slot) return;
    const name = slot.name;
    const input = document.createElement('input');
    input.value = name;
    input.addEventListener('keydown', async (e) => {
        if (e.key === 'Enter') {
            const newName = input.value.trim();
            if (newName && newName !== name) await renameSlot(slotId, newName);
        } else if (e.key === 'Escape') { renderSlotTabs(); }
    });
    input.addEventListener('blur', async () => {
        const newName = input.value.trim();
        if (newName && newName !== name) await renameSlot(slotId, newName);
        else renderSlotTabs();
    });
    while (tag.firstChild) tag.removeChild(tag.firstChild);
    tag.appendChild(input);
    const closeBtn = document.createElement('span');
    closeBtn.className = 'tag-close';
    closeBtn.dataset.action = 'delete-slot';
    closeBtn.dataset.slotId = slotId;
    closeBtn.innerHTML = '&times;';
    tag.appendChild(closeBtn);
    input.focus();
    input.select();
}

async function renameSlot(slotId, newName) {
    const game = currentConfig.games.find(g => g.id === selectedGameId);
    if (!game) return;
    if (game.slots.some(s => s.name === newName)) { alert('该存档位名已存在'); renderSlotTabs(); return; }
    const slot = game.slots.find(s => s.id === slotId);
    if (slot) slot.name = newName;
    // Keys are ID-based, no need to update filePathsBySlot / currentHashesBySlot
    await saveConfigToBackend();
    renderSlotTabs();
    refreshBackupList();
}

function restoreFilePaths() {
    if (!selectedGameId || !selectedSlotId) { renderFileTags(); return; }
    const key = selectedGameId + ':' + selectedSlotId;
    if (filePathsBySlot[key] && filePathsBySlot[key].length > 0) {
        renderFileTags();
        return;
    }
    const game = currentConfig.games.find(g => g.id === selectedGameId);
    if (!game) return;
    const slot = game.slots.find(s => s.id === selectedSlotId);
    if (slot && slot.file_paths && slot.file_paths.length > 0) {
        filePathsBySlot[key] = [...slot.file_paths];
        renderFileTags();
    }
}

// ==================== 哈希 ====================

async function refreshCurrentHashes() {
    var t0 = performance.now();
    if (!selectedGameId || !selectedSlotId) return;
    const key = selectedGameId + ':' + selectedSlotId;
    const fps = filePathsBySlot[key];
    if (!fps || fps.length === 0) return;
    const game = currentConfig.games.find(g => g.id === selectedGameId);
    const slot = game ? game.slots.find(s => s.id === selectedSlotId) : null;
    const patterns = slot ? slot.key_file_patterns : [];
    try {
        const hashes = await invoke('compute_hash', { filePaths: fps, patterns: patterns });
        currentHashesBySlot[key] = hashes;
        window.__log.perf('Render', 'refreshCurrentHashes', { ms: +(performance.now() - t0).toFixed(2), files: fps.length });
    } catch (e) { window.__log.perf('Render', 'refreshCurrentHashes', { ms: +(performance.now() - t0).toFixed(2), error: 'fail' }); }
}

// ==================== 文件选择 ====================

browseFileBtn.addEventListener('click', async () => {
    const startDir = (currentConfig.backup_root || null);
    const path = await invoke('pick_file', { startDir });
    if (path) {
        const paths = getCurrentFilePaths();
        if (!paths.includes(path)) {
            paths.push(path);
            setCurrentFilePaths(paths);
            renderFileTags();
            await refreshCurrentHashes();
            refreshBackupList();
        }
    }
});

rehashBtn.addEventListener('click', async () => {
    const fps = getCurrentFilePaths();
    if (fps.length === 0) { showBackupError('请先添加存档文件'); return; }
    if (!selectedGameId || !selectedSlotId) { showBackupError('请先选择游戏和存档位'); return; }
    hideMessages();
    await refreshCurrentHashes();
    refreshBackupList();
    showBackupSuccess('哈希已重算');
});

// ==================== 备份操作 ====================

saveBackupBtn.addEventListener('click', async () => {
    hideMessages();
    const gameId = selectedGameId;
    const slotId = selectedSlotId;
    const fps = getCurrentFilePaths();

    if (!gameId) { showBackupError('请先选择游戏'); return; }
    if (!slotId) { showBackupError('请先选择存档位'); return; }
    if (fps.length === 0) { showBackupError('请先添加存档文件'); return; }
    if (!currentConfig.backup_root) { showBackupError('请先在设置中配置备份根目录'); return; }

    setButtonLoading(saveBackupBtn, '保存中...');
    try {
        await refreshCurrentHashes();
        setCurrentFilePaths(fps);

        const result = await invoke('create_backup', {
            gameId: gameId,
            slotId: slotId,
            filePaths: fps
        });
        if (result.success) {
            showBackupSuccess(result.message);
            window.__log.info('Backup', '保存存档成功');
            await refreshCurrentHashes();
            refreshBackupList();
        } else {
            showBackupError(result.message);
        }
    } catch (err) {
        showBackupError('备份失败: ' + err);
    } finally {
        resetButton(saveBackupBtn, '保存存档');
    }
});

// ==================== 备份列表 ====================

async function refreshBackupList() {
    var t0 = performance.now();
    if (!selectedGameId || !selectedSlotId) {
        backupList.innerHTML = '<div class="empty-hint">请先选择游戏和存档位</div>';
        backupListTitle.textContent = '备份记录';
        return;
    }

    const game = currentConfig.games.find(g => g.id === selectedGameId);
    const slot = game ? game.slots.find(s => s.id === selectedSlotId) : null;
    backupListTitle.textContent = game && slot
        ? `备份记录 — ${game.name} / ${slot.name}`
        : '备份记录';

    try {
        var tIpc = performance.now();
        const backups = await invoke('list_backups', {
            gameId: selectedGameId,
            slotId: selectedSlotId
        });
        var ipcMs = +(performance.now() - tIpc).toFixed(2);

        if (backups.length === 0) {
            backupList.innerHTML = '<div class="empty-hint">暂无备份</div>';
            window.__log.perf('Render', 'refreshBackupList', { ms: +(performance.now() - t0).toFixed(2), backups: 0, ipc: ipcMs });
            return;
        }

        const currentHashes = currentHashesBySlot[selectedGameId + ':' + selectedSlotId] || {};
        const hashCounts = {};
        backups.forEach(b => { if (b.content_hash) hashCounts[b.content_hash] = (hashCounts[b.content_hash] || 0) + 1; });

        backupList.innerHTML = backups.map(b => {
            let extraClass = '';
            let badgeHtml = '';
            const isCurrentMatch = currentHashes && Object.values(currentHashes).includes(b.content_hash);
            const isDuplicate = !isCurrentMatch && b.content_hash && hashCounts[b.content_hash] > 1;

            if (isCurrentMatch) {
                extraClass = ' hash-match';
                badgeHtml = '<span class="hash-badge match">= 当前</span>';
            } else if (isDuplicate) {
                extraClass = ' hash-duplicate';
                badgeHtml = '<span class="hash-badge duplicate">= 重复</span>';
            }

            return `<div class="backup-item${extraClass}">
                <button class="btn-pin${b.pinned ? ' pinned' : ''}" data-action="toggle-pin" data-folder="${escapeHtml(b.folder_name)}" title="${b.pinned ? '取消置顶' : '置顶'}">&#128204;</button>
                <span class="name" title="${escapeHtml(b.display_name)}">${escapeHtml(b.display_name)}</span>
                ${badgeHtml}
                <span class="original-path" title="${escapeHtml(b.original_file_path)}">${escapeHtml(shortenPath(b.original_file_path))}</span>
                <button class="btn-small" data-action="restore" data-folder="${escapeHtml(b.folder_name)}">恢复</button>
                <button class="btn-small" data-action="rename-backup" data-folder="${escapeHtml(b.folder_name)}" data-desc="${escapeHtml(b.description || '')}">重命名</button>
                <button class="btn-small" data-action="open-backup" data-folder="${escapeHtml(b.folder_name)}">打开</button>
                <button class="btn-small" data-action="rehash-backup" data-folder="${escapeHtml(b.folder_name)}">重算</button>
                <button class="btn-danger" data-action="delete-backup" data-folder="${escapeHtml(b.folder_name)}">删除</button>
            </div>`;
        }).join('');

        window.__log.perf('Render', 'refreshBackupList', { ms: +(performance.now() - t0).toFixed(2), backups: backups.length, ipc: ipcMs });
    } catch (err) {
        backupList.innerHTML = `<div class="empty-hint">加载失败: ${escapeHtml(String(err))}</div>`;
        window.__log.perf('Render', 'refreshBackupList', { ms: +(performance.now() - t0).toFixed(2), error: String(err) });
    }
}

async function handleRestore(folderName) {
    try {
        const result = await invoke('restore_backup', {
            gameId: selectedGameId,
            slotId: selectedSlotId,
            folderName: folderName,
            skipBackup: false,
            selectedFiles: null
        });

        if (result.success) {
            alert(result.message);
            await refreshCurrentHashes();
            refreshBackupList();
        } else if (result.available_files && result.available_files.length > 0) {
            showRestoreFileModal(result.available_files, folderName);
        } else if (result.need_backup_confirm) {
            const originalPath = result.need_backup_confirm;
            if (confirm('当前存档「' + originalPath + '」未备份，是否需要先备份再恢复？\n\n确定 = 先备份再恢复\n取消 = 直接覆盖恢复')) {
                const backupResult = await invoke('create_backup', {
                    gameId: selectedGameId, slotId: selectedSlotId,
                    filePaths: getCurrentFilePaths()
                });
                if (!backupResult.success) {
                    alert('备份当前文件失败: ' + backupResult.message);
                }
                await doRestoreWithFileSelect(folderName);
            } else {
                await doRestoreWithFileSelect(folderName, true);
            }
            await refreshCurrentHashes();
            refreshBackupList();
        } else {
            alert('恢复失败: ' + result.message);
        }
    } catch (err) {
        alert('恢复失败: ' + err);
    }
}

async function doRestoreWithFileSelect(folderName, skipBackup) {
    const result = await invoke('restore_backup', {
        gameId: selectedGameId,
        slotId: selectedSlotId,
        folderName: folderName,
        skipBackup: skipBackup || false,
        selectedFiles: null
    });
    if (result.success) {
        alert(result.message);
    } else if (result.available_files && result.available_files.length > 0) {
        showRestoreFileModal(result.available_files, folderName);
    } else {
        alert('恢复失败: ' + result.message);
    }
}

// ==================== 恢复文件选择弹窗 ====================

function showRestoreFileModal(files, folderName) {
    const old = document.getElementById('restoreOverlay');
    if (old) old.remove();

    const overlay = document.createElement('div');
    overlay.id = 'restoreOverlay';
    overlay.className = 'modal-overlay';
    overlay.style.display = 'flex';
    overlay.innerHTML = '<div class="modal" style="width:420px;">'
        + '<div class="modal-header">'
            + '<span class="modal-title">选择要恢复的文件</span>'
            + '<button class="modal-close" id="restoreCloseBtn">&times;</button>'
        + '</div>'
        + '<div class="modal-body">'
            + '<div class="restore-file-list">'
                + files.map((f, i) => '<label class="restore-file-item">'
                    + '<input type="checkbox" data-file="' + escapeHtml(f.name) + '" checked>'
                    + '<span class="restore-file-name">' + escapeHtml(f.name) + '</span>'
                    + '<span class="restore-file-path">' + escapeHtml(shortenPath(f.path)) + '</span>'
                + '</label>').join('')
            + '</div>'
            + '<div style="margin-top:12px;display:flex;gap:8px;">'
                + '<button id="restoreSelectAll" class="btn-small" style="flex:0 0 auto;">全选</button>'
                + '<button id="restoreDeselectAll" class="btn-small" style="flex:0 0 auto;">全不选</button>'
                + '<button id="restoreConfirmBtn" style="flex:1;">恢复</button>'
            + '</div>'
        + '</div>'
    + '</div>';
    document.querySelector('.container').appendChild(overlay);

    const close = function() { overlay.remove(); };
    overlay.querySelector('#restoreCloseBtn').addEventListener('click', close);
    overlay.addEventListener('click', function(e) { if (e.target === overlay) close(); });

    overlay.querySelector('#restoreSelectAll').addEventListener('click', function() {
        overlay.querySelectorAll('.restore-file-item input[type="checkbox"]').forEach(function(cb) { cb.checked = true; });
    });
    overlay.querySelector('#restoreDeselectAll').addEventListener('click', function() {
        overlay.querySelectorAll('.restore-file-item input[type="checkbox"]').forEach(function(cb) { cb.checked = false; });
    });

    overlay.querySelector('#restoreConfirmBtn').addEventListener('click', async function() {
        var selected = [];
        overlay.querySelectorAll('.restore-file-item input[type="checkbox"]:checked').forEach(function(cb) {
            selected.push(cb.dataset.file);
        });
        if (selected.length === 0) { alert('请至少选择一个文件'); return; }
        close();
        try {
            var result = await invoke('restore_backup', {
                gameId: selectedGameId,
                slotId: selectedSlotId,
                folderName: folderName,
                skipBackup: true,
                selectedFiles: selected
            });
            if (result.success) {
                alert(result.message);
                await refreshCurrentHashes();
                refreshBackupList();
            } else {
                alert('恢复失败: ' + result.message);
            }
        } catch (err) {
            alert('恢复失败: ' + err);
        }
    });
}

async function handleRenameBackup(folderName, currentDesc) {
    const newDesc = prompt('修改备份描述（时间戳不可改）:', currentDesc || '');
    if (newDesc === null) return;
    const result = await invoke('rename_backup', {
        gameId: selectedGameId,
        slotId: selectedSlotId,
        folderName: folderName,
        newDescription: newDesc.trim()
    });
    if (result.success) { refreshBackupList(); }
    else { alert('重命名失败: ' + result.message); }
}

async function handleOpenBackupFolder(folderName) {
    if (!currentConfig.backup_root || !selectedGameId || !selectedSlotId) return;
    const folderPath = [currentConfig.backup_root, selectedGameId, selectedSlotId, folderName].join('\\');
    const result = await invoke('open_folder', { path: folderPath });
    if (!result.success) alert('打开失败: ' + result.message);
}

async function handleRehashBackup(btn, folderName) {
    setButtonLoading(btn, '...');
    try {
        const result = await invoke('recompute_backup_hash', {
            gameId: selectedGameId,
            slotId: selectedSlotId,
            folderName: folderName
        });
        if (result.success) {
            await refreshCurrentHashes();
            refreshBackupList();
        } else {
            alert('重算失败: ' + result.message);
        }
    } catch (err) {
        alert('重算失败: ' + err);
    } finally {
        resetButtonRaw(btn);
    }
}

async function handleDeleteBackup(folderName) {
    if (!confirm('确定要删除此备份吗？此操作不可恢复。')) return;
    try {
        const result = await invoke('delete_backup', {
            gameId: selectedGameId,
            slotId: selectedSlotId,
            folderName: folderName
        });
        if (result.success) { refreshBackupList(); }
        else { alert('删除失败: ' + result.message); }
    } catch (err) {
        alert('删除失败: ' + err);
    }
}

async function handleTogglePin(btn, folderName) {
    setButtonLoading(btn, '...');
    try {
        const result = await invoke('toggle_backup_pin', {
            gameId: selectedGameId,
            slotId: selectedSlotId,
            folderName: folderName
        });
        if (result.success) refreshBackupList();
    } catch (err) {
        alert('操作失败: ' + err);
    } finally {
        resetButtonRaw(btn);
    }
}

// ==================== 设置面板切换 ====================

let _lastSettingsClick = 0;

settingsBtn.addEventListener('click', () => {
    var now = Date.now();
    if (now - _lastSettingsClick < TAB_DEBOUNCE_MS) return;
    _lastSettingsClick = now;
    updateSettingsDisplay();
    toggleSettings();
});

function renderSettingsTabBar() {
    var tabBar = document.getElementById('tabBar');
    tabBar.innerHTML = '<div class="tab-settings-indicator" title="点击退出设置">'
        + '<div class="si-sep"></div>'
        + '<div class="si-icon" id="settingsTabExit">&#x2190;</div>'
        + '<div class="si-sep"></div>'
        + '</div>';
    var exitBtn = document.getElementById('settingsTabExit');
    if (exitBtn) {
        exitBtn.addEventListener('click', function(e) {
            e.stopPropagation();
            if (_isSettingsActive) toggleSettings();
        });
    }
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
        document.querySelectorAll('.panel').forEach(function(p) { p.classList.remove('active'); });
        var panel = document.getElementById('panel-settings');
        if (panel) panel.classList.add('active');
        renderSettingsTabBar();
        window.__log.info('Settings', '进入设置面板');
    }
}

const THEME_LABELS = { system: '🌓 跟随系统', dark: '🌙 暗色模式', light: '☀️ 亮色模式' };
const THEME_ORDER = ['system', 'dark', 'light'];

let systemIsDark = window.matchMedia('(prefers-color-scheme: dark)').matches;

window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', (e) => {
    systemIsDark = e.matches;
    if (currentConfig.theme === 'system') applyTheme('system');
});

themeSlider.addEventListener('click', function(e) {
    var opt = e.target.closest('.opt');
    if (!opt) return;
    var newTheme = opt.dataset.theme;
    if (newTheme === currentConfig.theme) return;
    currentConfig.theme = newTheme;
    applyTheme(newTheme);
    saveConfigToBackend();
});

// 开机自启开关
autoStartToggle.addEventListener('click', function() {
    currentConfig.auto_start = !currentConfig.auto_start;
    updateSettingsDisplay();
    saveConfigToBackend();
});

// 托盘开关
trayToggle.addEventListener('click', function() {
    currentConfig.minimize_to_tray = !currentConfig.minimize_to_tray;
    updateSettingsDisplay();
    saveConfigToBackend();
});

// 启用提醒开关
reminderToggle.addEventListener('click', function() {
    currentConfig.reminder_enabled = !currentConfig.reminder_enabled;
    updateSettingsDisplay();
    saveConfigToBackend();
});

function applyTheme(theme) {
    const isLight = theme === 'system' ? !systemIsDark : theme === 'light';
    if (isLight) {
        document.body.classList.add('light');
    } else {
        document.body.classList.remove('light');
    }
    var pos = THEME_ORDER.indexOf(theme);
    if (pos !== -1 && themeSlider) {
        themeSlider.dataset.pos = pos;
        themeSlider.querySelectorAll('.opt').forEach(function(o, i) {
            o.classList.toggle('active', i === pos);
        });
    }
}

settingsSetDirBtn.addEventListener('click', async () => {
    const dir = await invoke('pick_directory');
    if (dir) {
        currentConfig.backup_root = dir;
        await saveConfigToBackend();
        updateSettingsDisplay();
    }
});

settingsOpenDirBtn.addEventListener('click', async () => {
    if (!currentConfig.backup_root) {
        alert('请先设置备份根目录');
        return;
    }
    const result = await invoke('open_folder', { path: currentConfig.backup_root });
    if (!result.success) alert('打开失败: ' + result.message);
});

function updateSettingsDisplay() {
    if (currentConfig.backup_root) {
        settingsBackupRoot.textContent = currentConfig.backup_root;
        settingsBackupRoot.classList.add('has-value');
    } else {
        settingsBackupRoot.textContent = '未设置';
        settingsBackupRoot.classList.remove('has-value');
    }
    // 开关状态
    if (autoStartToggle) {
        autoStartToggle.dataset.state = currentConfig.auto_start ? 'on' : 'off';
    }
    if (trayToggle) {
        trayToggle.dataset.state = currentConfig.minimize_to_tray ? 'on' : 'off';
    }
    if (reminderToggle) {
        reminderToggle.dataset.state = currentConfig.reminder_enabled !== false ? 'on' : 'off';
    }
    // 主题滑块状态
    if (themeSlider) {
        var pos = THEME_ORDER.indexOf(currentConfig.theme || 'system');
        if (pos !== -1) {
            themeSlider.dataset.pos = pos;
            themeSlider.querySelectorAll('.opt').forEach(function(o, i) {
                o.classList.toggle('active', i === pos);
            });
        }
    }
    renderHolidayYears();
}

// ==================== 节假日管理 ====================

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
            + '<button class="btn-small" data-action="edit-holiday" data-year="' + h.year + '">编辑</button>'
            + '<button class="btn-small" data-action="del-holiday" data-year="' + h.year + '">删除</button>'
            + '</div>';
    }).join('');
}

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
    var editor = document.getElementById('holidayEditor');
    var existing = (currentConfig.holiday_data || []).find(function(h) { return h.year === year; });
    var defaultText = existing ? JSON.stringify(existing, null, 2) : getTemplateJSON(year);

    editor.style.display = 'block';
    editor.innerHTML = ''
        + '<div class="holiday-editor-panel">'
        + '<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px;">'
        + '<strong>' + year + '年 节假日配置</strong>'
        + '<button class="btn-small" id="holidayCopyTemplate">复制模板</button>'
        + '</div>'
        + '<textarea id="holidayJsonInput" class="holiday-json-input" placeholder="编辑 JSON 配置">'
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

    // 保存按钮只绑定一次，点击时从 textarea 读取最新内容
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
        editor.style.display = 'none';
        window.__log.info('Holiday', data.year + '年节假日配置已保存');
    });

    if (defaultText) {
        parseAndPreviewHolidayJSON(defaultText, year);
    }
}

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

    var errors = [];
    if (!data.year || data.year < 2000 || data.year > 2099) errors.push('年份无效，需在 2000-2099 之间');
    if (data.year !== year) errors.push('年份不匹配，期望 ' + year + ' 但 JSON 中是 ' + data.year);

    if (!Array.isArray(data.holidays)) errors.push('holidays 必须是数组');
    if (!Array.isArray(data.makeup_days)) errors.push('makeup_days 必须是数组');

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
            if (mmddRe.test(h.start) && mmddRe.test(h.end)) {
                holidayRanges.push({ name: h.name, start: h.start, end: h.end });
            }
        });
    }

    for (var i = 0; i < holidayRanges.length; i++) {
        for (var j = i + 1; j < holidayRanges.length; j++) {
            if (holidayRanges[i].start <= holidayRanges[j].end && holidayRanges[j].start <= holidayRanges[i].end) {
                errors.push('假期重叠: "' + holidayRanges[i].name + '" 与 "' + holidayRanges[j].name + '"');
            }
        }
    }

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

    var saveBtn = document.getElementById('holidaySaveBtn');
    saveBtn.style.display = '';
}

// 添加节假日按钮
document.getElementById('holidayAddBtn').addEventListener('click', function() {
    var year = parseInt(document.getElementById('holidayYearSelect').value, 10);
    var exists = (currentConfig.holiday_data || []).some(function(h) { return h.year === year; });
    if (exists) {
        alert('该年份已配置，请编辑');
        return;
    }
    openHolidayEditor(year);
});

// ==================== 按钮防重复 ====================

function setButtonLoading(btn, text) {
    btn.disabled = true;
    btn._originalText = btn.textContent;
    btn.textContent = text;
}

function resetButton(btn, originalText) {
    btn.disabled = false;
    btn.textContent = originalText;
}

function resetButtonRaw(btn) {
    btn.disabled = false;
    if (btn._originalText) {
        btn.textContent = btn._originalText;
        delete btn._originalText;
    }
}

// ==================== 消息提示 ====================

function hideMessages() {
    backupError.style.display = 'none';
    backupSuccess.style.display = 'none';
}

function showBackupError(msg) {
    backupError.innerText = msg;
    backupError.style.display = 'block';
    backupSuccess.style.display = 'none';
}

function showBackupSuccess(msg) {
    backupSuccess.innerText = msg;
    backupSuccess.style.display = 'block';
    backupError.style.display = 'none';
}

// ==================== 工具函数 ====================

const DEFAULT_TZ_SET_ID = 'beijing';

// 安全推进月份：当月天数不足时不溢出到下个月，而是 clamp 到月末
function safeAddMonth(date) {
    var target = new Date(date);
    var origDay = target.getDate();
    target.setMonth(target.getMonth() + 1);
    if (target.getDate() !== origDay) {
        target.setDate(0);
    }
    return target;
}

function escapeHtml(str) {
    // 纯字符串替换，不创建 DOM 元素 — 避免 GC 压力
    return String(str).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

function shortenPath(path) {
    if (!path) return '';
    const parts = path.replace(/\\/g, '/').split('/');
    if (parts.length <= 2) return path;
    return '.../' + parts.slice(-2).join('/');
}

async function refreshAll() {
    if (_refreshLock) {
        window.__log.perf('Backup', '阻断: refreshAll 锁占用中');
        return;
    }
    _refreshLock = true;
    var t0 = performance.now();
    try {
        renderGameTabs();
        renderSlotTabs();
        if (selectedGameId && selectedSlotId) {
            restoreFilePaths();
            await refreshCurrentHashes();
            await refreshBackupList();
        }
    } finally {
        window.__log.perf('Backup', '刷新备份列表', { ms: +(performance.now() - t0).toFixed(2) });
        _refreshLock = false;
    }
}

// ==================== 待办工具 ====================
const todoList = document.getElementById('todoList');
const todoSearch = document.getElementById('todoSearch');
const todoFilterStatus = document.getElementById('todoFilterStatus');
const todoFilterPriority = document.getElementById('todoFilterPriority');
const todoStats = document.getElementById('todoStats');

function getReminderDisplay(todo) {
    if (todo.done || !todo.reminder) return '';
    if (!todo.reminder.datetime) return '';
    var now = new Date();
    var reminderTime = new Date(todo.reminder.datetime);
    var diffMs = reminderTime - now;
    if (isNaN(diffMs)) return '';
    var diffMin = Math.floor(diffMs / 60000);

    // 已过期（含刚好到期），返回已过期
    if (diffMs <= 0) {
        return '<span class="todo-reminder overdue">⏰ 已过期</span>';
    }

    var text = '';
    if (diffMin < 1) text = '1分钟内';
    else if (diffMin < 60) text = diffMin + '分钟后';
    else if (diffMin < 1440) text = Math.floor(diffMin / 60) + '小时后';
    else if (diffMin < 43200) text = Math.floor(diffMin / 1440) + '天后';
    else text = Math.floor(diffMin / 43200) + '个月后';

    var icon = todo.paused ? '⏸' : '⏰';
    var cls = todo.paused ? 'todo-reminder paused' : 'todo-reminder';
    return '<span class="' + cls + '" data-action="toggle-pause">' + icon + ' ' + text + '</span>';
}

function formatCompletedTime(isoStr) {
    if (!isoStr) return '';
    var d = new Date(isoStr);
    var y = d.getFullYear();
    var m = String(d.getMonth() + 1).padStart(2, '0');
    var day = String(d.getDate()).padStart(2, '0');
    var h = String(d.getHours()).padStart(2, '0');
    var min = String(d.getMinutes()).padStart(2, '0');
    return y + '-' + m + '-' + day + ' ' + h + ':' + min;
}

function autoClearExpiredPaused() {
    var changed = false;
    (currentConfig.todos || []).forEach(function(t) {
        if (t.done || !t.paused || !t.reminder || !t.reminder.datetime) return;
        if (t.repeat) return; // 重复任务不自动清除暂停
        var reminderTime = new Date(t.reminder.datetime);
        if (isNaN(reminderTime)) return;
        if (reminderTime <= new Date()) {
            t.paused = false;
            changed = true;
        }
    });
    return changed;
}

function renderTodos() {
    var t0 = performance.now();
    if (autoClearExpiredPaused()) saveConfigToBackend();
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

    // 排序: 未完成优先 → 按优先级 → 手动排序
    const sorted = [...filtered].sort((a, b) => {
        if (a.done !== b.done) return a.done - b.done;
        if (a.priority !== b.priority) return b.priority - a.priority;
        return a.sort_order - b.sort_order;
    });

    // 统计
    const total = items.length;
    const active = items.filter(t => !t.done).length;
    const doneCount = total - active;
    todoStats.innerHTML = '<span class="' + (statusFilter === 'all' ? 'active' : '') + '" data-filter="all">全部 <span class="count">' + total + '</span></span>'
        + '<span class="' + (statusFilter === 'active' ? 'active' : '') + '" data-filter="active">待完成 <span class="count">' + active + '</span></span>'
        + '<span class="' + (statusFilter === 'done' ? 'active' : '') + '" data-filter="done">已完成 <span class="count">' + doneCount + '</span></span>';

    // 渲染列表
    if (sorted.length === 0) {
        todoList.innerHTML = '<div class="empty-hint">暂无待办，在下方添加</div>';
        return;
    }

    todoList.innerHTML = sorted.map(t => {
        const priClass = t.priority === 2 ? 'high' : t.priority === 1 ? 'medium' : 'low';
        const priLabel = t.priority === 2 ? '高' : t.priority === 1 ? '中' : '低';
        const reminderHtml = getReminderDisplay(t);
        const tagsHtml = t.tags.map(tag => '<span class="todo-tag">' + escapeHtml(tag) + '</span>').join('');
        return '<div class="todo-item' + (t.done ? ' done' : '') + '" data-id="' + escapeHtml(t.id) + '">'
            + '<span class="todo-drag-handle">⠿</span>'
            + '<span class="todo-check" data-action="toggle-todo">' + (t.done ? '✓' : '') + '</span>'
            + (t.priority > 0 ? '<span class="todo-priority ' + priClass + '">' + priLabel + '</span>' : '')
            + '<span class="todo-text" data-action="edit-todo">' + escapeHtml(t.text) + '</span>'
            + (t.done && t.completed_at ? '<span class="todo-completed-at">' + formatCompletedTime(t.completed_at) + '</span>' : '')
            + reminderHtml
            + (tagsHtml ? '<span class="todo-tags">' + tagsHtml + '</span>' : '')
            + '<button class="todo-delete-btn" data-action="delete-todo" title="删除">×</button>'
            + '</div>';
    }).join('');

    window.__log.perf('Render', 'renderTodos', { ms: +(performance.now() - t0).toFixed(2), total: items.length, filtered: sorted.length });
}

function toggleTodoDone(id) {
    var todo = currentConfig.todos.find(function(t) { return t.id === id; });
    if (!todo) return;

    if (!todo.done) {
        // 完成 — 翻转 done 并生成克隆
        todo.done = true;
        todo.completed_at = new Date().toISOString();
        if (todo.repeat) {
            var newTodo = createNextRepeat(todo);
            if (newTodo) currentConfig.todos.push(newTodo);
        }
        window.__log.info('Todo', '完成任务: ' + todo.text);
    } else {
        // 取消完成 — 删除克隆项，翻转 done，置空完成时间，重置时间
        var childIndex = currentConfig.todos.findIndex(function(t) { return t.parent_id === todo.id; });
        if (childIndex !== -1) currentConfig.todos.splice(childIndex, 1);
        todo.done = false;
        todo.completed_at = null;
        if (todo.repeat) recalculateNextDue(todo);
        window.__log.info('Todo', '取消完成任务: ' + todo.text);
    }

    saveConfigToBackend();
    renderTodos();
}

function deleteTodo(id) {
    var item = document.querySelector('.todo-item[data-id="' + id + '"]');
    if (item) {
        item.classList.add('leaving');
        setTimeout(function() {
            var todo = currentConfig.todos.find(function(t) { return t.id === id; });
            if (todo) window.__log.info('Todo', '删除待办: ' + todo.text);
            currentConfig.todos = currentConfig.todos.filter(function(t) { return t.id !== id; });
            saveConfigToBackend();
            renderTodos();
        }, 200);
    } else {
        var todo = currentConfig.todos.find(function(t) { return t.id === id; });
        if (todo) window.__log.info('Todo', '删除待办: ' + todo.text);
        currentConfig.todos = currentConfig.todos.filter(function(t) { return t.id !== id; });
        saveConfigToBackend();
        renderTodos();
    }
}

function createNextRepeat(todo) {
    var now = new Date();
    var nextDate = new Date(now.getFullYear(), now.getMonth(), now.getDate());

    if (todo.repeat === 'daily') nextDate.setDate(nextDate.getDate() + 1);
    else if (todo.repeat === 'weekly') nextDate.setDate(nextDate.getDate() + 7);
    else if (todo.repeat === 'monthly') nextDate = safeAddMonth(nextDate);
    else return null;

    var newTodo = JSON.parse(JSON.stringify(todo));
    newTodo.id = crypto.randomUUID();
    newTodo.done = false;
    newTodo.created_at = new Date().toISOString().slice(0, 16);
    newTodo.last_notified = null;

    // 推 reminder 和 due_date
    if (newTodo.due_date && todo.repeat) {
        var d = new Date(todo.due_date + 'T00:00:00');
        if (todo.repeat === 'daily') d.setDate(d.getDate() + 1);
        else if (todo.repeat === 'weekly') d.setDate(d.getDate() + 7);
        else if (todo.repeat === 'monthly') d = safeAddMonth(d);
        newTodo.due_date = d.toISOString().slice(0, 10);
    }
    if (newTodo.reminder && newTodo.reminder.datetime && todo.repeat) {
        if (todo.repeat === 'daily') {
            var next = calculateNextReminderDate('daily',
                newTodo.reminder.workday_time,
                newTodo.reminder.restday_time);
            if (next) newTodo.reminder.datetime = next;
        } else if (todo.repeat === 'weekly') {
            var r = new Date(newTodo.reminder.datetime);
            r.setDate(r.getDate() + 7);
            newTodo.reminder.datetime = r.toISOString().slice(0, 16);
        } else if (todo.repeat === 'monthly') {
            var r = new Date(newTodo.reminder.datetime);
            r = safeAddMonth(r);
            newTodo.reminder.datetime = r.toISOString().slice(0, 16);
        }
    }
    newTodo.parent_id = todo.id;   // 记录关联，供取消完成时查找删除
    return newTodo;
}

function recalculateNextDue(todo) {
    if (!todo.due_date) return;
    var due = new Date(todo.due_date);
    var now = new Date();
    // 仅当到期日已过期时重置到下一周期
    if (due <= now) {
        var next = new Date(now.getFullYear(), now.getMonth(), now.getDate());
        if (todo.repeat === 'daily') next.setDate(next.getDate() + 1);
        else if (todo.repeat === 'weekly') next.setDate(next.getDate() + 7);
        else if (todo.repeat === 'monthly') next = safeAddMonth(next);
        todo.due_date = next.toISOString().slice(0, 10);
        if (todo.reminder && todo.reminder.datetime) {
            if (todo.repeat === 'daily') {
                var next = calculateNextReminderDate('daily',
                    todo.reminder.workday_time,
                    todo.reminder.restday_time);
                if (next) todo.reminder.datetime = next;
            } else if (todo.repeat === 'weekly') {
                var r = new Date(todo.reminder.datetime);
                r.setDate(r.getDate() + 7);
                todo.reminder.datetime = r.toISOString().slice(0, 16);
            } else if (todo.repeat === 'monthly') {
                var r = new Date(todo.reminder.datetime);
                r = safeAddMonth(r);
                todo.reminder.datetime = r.toISOString().slice(0, 16);
            }
        }
    }
    // 到期日未过期 → 不动
}

// 添加待办按钮
document.getElementById('todoAddBtn').addEventListener('click', function() {
    openTodoEditModal(null);
});

// 搜索/筛选事件
todoSearch.addEventListener('input', function() { renderTodos(); });
todoFilterStatus.addEventListener('change', function() { renderTodos(); });
todoFilterPriority.addEventListener('change', function() { renderTodos(); });

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
    if (hours == null || isNaN(hours) || minutes == null || isNaN(minutes)) return '';

    if (repeat === 'daily') {
        var target = new Date(now.getFullYear(), now.getMonth(), now.getDate(), hours, minutes, 0, 0);
        if (target <= now) target.setDate(target.getDate() + 1);
        return formatISOLocal(target);
    }

    if (repeat === 'weekly') {
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
            if (h.start <= h.end) {
                if (mmdd >= h.start && mmdd <= h.end) return 'restday';
            } else {
                // 跨年假期段
                if (mmdd >= h.start || mmdd <= h.end) return 'restday';
            }
        }
    }

    var day = date.getDay();
    if (day === 0 || day === 6) return 'restday';
    return 'workday';
}

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
        if (d === 0 && target > now) return formatISOLocal(target);
        if (d === 0) continue;
        return formatISOLocal(target);
    }
    return '';
}

function updateReminderSummary() {
    var el = document.getElementById('reminderSummaryText');
    if (!el) return;
    var wd = document.getElementById('editWorkdayTime');
    var rd = document.getElementById('editRestdayTime');
    var off = document.getElementById('editRestdayOff');
    if (!wd || !rd) return;
    var wdv = wd.value;
    var rdv = off && off.checked ? null : (rd ? rd.value : null);
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

// 编辑弹窗
function openTodoEditModal(id) {
    var isNew = id === null;
    var todo = isNew ? null : currentConfig.todos.find(function(t) { return t.id === id; });
    if (!todo && !isNew) return;
    // 已完成的一次性提醒待办不再允许编辑（编辑弹窗 autoSave 可能覆盖后端 done=true）
    if (!isNew && todo.done && !todo.repeat && todo.reminder) {
        window.__log.info('已完成的一次性提醒待办不可编辑: ' + todo.text);
        return;
    }

    if (isNew) {
        todo = {
            id: null,
            text: '',
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
    }

    var oldEl = document.querySelector('.todo-edit-overlay');
    if (oldEl) oldEl.remove();

    var priorityLabels = ['低', '中', '高'];
    var priorityHtml = '';
    for (var i = 0; i < 3; i++) {
        priorityHtml += '<button class="' + (todo.priority === i ? 'active' : '') + '" data-value="' + i + '">' + priorityLabels[i] + '</button>';
    }

    var repeatValues = [null, 'daily', 'weekly', 'monthly'];
    var repeatLabels = ['不重复', '每天', '每周', '每月'];
    var repeatOpts = '';
    for (var i = 0; i < repeatValues.length; i++) {
        repeatOpts += '<option value="' + (repeatValues[i] || '') + '" ' + (todo.repeat === repeatValues[i] ? 'selected' : '') + '>' + repeatLabels[i] + '</option>';
    }

    var overlay = document.createElement('div');
    overlay.className = 'todo-edit-overlay';
    overlay.innerHTML = '<div class="todo-edit-modal">'
        + '<div class="todo-edit-header">'
            + '<div class="todo-edit-title">' + (isNew ? '新建待办' : '编辑待办') + '</div>'
            + '<button class="todo-edit-close" id="editCloseBtn">&#x2715;</button>'
        + '</div>'
        + '<div class="todo-edit-body">'

        + '<div class="todo-edit-field">'
            + '<label>内容</label>'
            + '<input type="text" id="editText" value="' + escapeHtml(todo.text) + '">'
        + '</div>'

        + '<div class="todo-edit-field">'
            + '<label>优先级</label>'
            + '<div class="todo-priority-picker" id="editPriority">' + priorityHtml + '</div>'
        + '</div>'

        + '<div class="todo-edit-field">'
            + '<label>📅 到期日</label>'
            + '<input type="date" id="editDueDate" value="' + (todo.due_date || '') + '">'
        + '</div>'

        + '<div class="todo-edit-field">'
            + '<label>标签（逗号分隔）</label>'
            + '<input type="text" id="editTags" value="' + escapeHtml((todo.tags || []).join(', ')) + '">'
        + '</div>'

        + '<div class="todo-edit-field">'
            + '<label>备注</label>'
            + '<textarea id="editNotes">' + escapeHtml(todo.notes || '') + '</textarea>'
        + '</div>'

        + '<div class="todo-edit-field">'
            + '<label>重复</label>'
            + '<select id="editRepeat">' + repeatOpts + '</select>'
        + '</div>'

        + '<div class="todo-edit-field">'
            + '<label>⏰ 提醒时间</label>'
            + '<div class="reminder-input-group">'
                // 不重复
                + '<input type="datetime-local" id="editReminderOnce" class="ri ri-once" value="' + (todo.reminder && !todo.repeat ? todo.reminder.datetime : '') + '">'
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
    + '</div>'
    + '</div>';

    document.querySelector('.container').appendChild(overlay);

    // 编辑已有待办：恢复每周/每月的选择值
    if (todo.reminder && todo.repeat === 'weekly') {
        var d = new Date(todo.reminder.datetime);
        var weekday = d.getDay() === 0 ? 7 : d.getDay();
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

    // 重复类型切换 → 切换提醒输入控件
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
        autoSave();
    });
    switchReminderInput(repeatSelect.value || null); // 初始化状态

    // ─── 关闭 ───
    function closeModal() {
        // 新待办且内容为空 → 从数组清理（防止自动保存了空内容）
        if (isNew && todo.id && !overlay.querySelector('#editText').value.trim()) {
            var idx = currentConfig.todos.indexOf(todo);
            if (idx !== -1) currentConfig.todos.splice(idx, 1);
            saveConfigToBackend();
        }
        renderTodos(); // 统一刷新（编辑中跳过，关闭时保证列表最新）
        overlay.remove();
    }
    overlay.querySelector('#editCloseBtn').addEventListener('click', closeModal);
    overlay.addEventListener('click', function(e) { if (e.target === overlay) closeModal(); });

    // ─── 自动保存（每项修改后 300ms 防抖写入配置） ───
    var _saveTimer = null;
    function collectFields() {
        var text = overlay.querySelector('#editText').value.trim();
        if (!text) return null;
        var activePri = overlay.querySelector('.todo-priority-picker .active');
        var repeatType = overlay.querySelector('#editRepeat').value;
        var reminderVal = null;
        var dayMode = 'fixed';
        if (repeatType === '' || repeatType === null) {
            reminderVal = overlay.querySelector('#editReminderOnce').value;
        } else if (repeatType === 'daily') {
            var wdVal = overlay.querySelector('#editWorkdayTime').value;
            var rdVal = overlay.querySelector('#editRestdayTime').value;
            var rdOff = overlay.querySelector('#editRestdayOff').checked;
            if (wdVal || rdVal) {
                var nextDate = calculateNextReminderDate('daily', wdVal || null, rdOff ? null : (rdVal || null));
                if (nextDate) {
                    reminderVal = nextDate;
                }
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
        return {
            text: text,
            priority: activePri ? parseInt(activePri.dataset.value, 10) : 1,
            due_date: overlay.querySelector('#editDueDate').value || null,
            tags: overlay.querySelector('#editTags').value.split(',').map(function(s) { return s.trim(); }).filter(Boolean),
            notes: overlay.querySelector('#editNotes').value,
            repeat: overlay.querySelector('#editRepeat').value || null,
            reminder: reminderVal ? { datetime: reminderVal, sound: true, day_mode: dayMode } : null,
        };
    }
    var _saveInProgress = false;
    function autoSave() {
        if (_saveTimer) clearTimeout(_saveTimer);
        if (_saveInProgress) return; // 前一次保存未完成则跳过本次
        _saveTimer = setTimeout(function() {
            var fields = collectFields();
            if (!fields) return;
            // 新待办首次保存时生成 ID
            if (isNew && !todo.id) {
                todo.id = crypto.randomUUID();
                todo.created_at = new Date().toISOString().slice(0, 16);
                todo.sort_order = currentConfig.todos.length;
                currentConfig.todos.push(todo);
            }
            todo.text = fields.text;
            todo.priority = fields.priority;
            todo.due_date = fields.due_date;
            todo.tags = fields.tags;
            todo.notes = fields.notes;
            todo.repeat = fields.repeat;
            if (fields.reminder) {
                if (!todo.reminder) {
                    todo.reminder = { datetime: fields.reminder.datetime, sound: true, day_mode: fields.reminder.day_mode || 'fixed', workday_time: null, restday_time: null };
                } else {
                    todo.reminder.datetime = fields.reminder.datetime;
                    todo.reminder.day_mode = fields.reminder.day_mode || 'fixed';
                }
                if (fields.repeat === 'daily') {
                    todo.reminder.workday_time = overlay.querySelector('#editWorkdayTime').value || null;
                    todo.reminder.restday_time = overlay.querySelector('#editRestdayOff').checked ? null : (overlay.querySelector('#editRestdayTime').value || null);
                }
            } else {
                todo.reminder = null;
            }
            _saveInProgress = true;
            saveConfigToBackend().then(function() {
                _saveInProgress = false;
            }).catch(function() {
                _saveInProgress = false;
            });
            // 编辑弹窗中不渲染列表（关闭时才渲染），避免 DOM 操作卡顿
            if (!overlay.parentNode) renderTodos();
        }, 300);
    }
    // 各字段修改触发自动保存
    overlay.querySelector('#editText').addEventListener('input', autoSave);
    overlay.querySelectorAll('.todo-priority-picker button').forEach(function(btn) {
        btn.addEventListener('click', function() {
            overlay.querySelectorAll('.todo-priority-picker button').forEach(function(b) { b.classList.remove('active'); });
            this.classList.add('active');
            autoSave();
        });
    });
    overlay.querySelector('#editDueDate').addEventListener('change', autoSave);
    overlay.querySelector('#editTags').addEventListener('input', autoSave);
    overlay.querySelector('#editNotes').addEventListener('input', autoSave);
    // 提醒输入控件变化
    overlay.querySelector('#editReminderOnce').addEventListener('change', autoSave);
    overlay.querySelector('#editReminderWeekday').addEventListener('change', autoSave);
    overlay.querySelector('#editReminderWeeklyTime').addEventListener('change', autoSave);
    overlay.querySelector('#editReminderMonthDay').addEventListener('change', autoSave);
    overlay.querySelector('#editReminderMonthlyTime').addEventListener('change', autoSave);
    var editWorkdayTime = overlay.querySelector('#editWorkdayTime');
    var editRestdayTime = overlay.querySelector('#editRestdayTime');
    var editRestdayOff = overlay.querySelector('#editRestdayOff');
    if (editWorkdayTime) editWorkdayTime.addEventListener('change', function() {
        updateReminderSummary();
        autoSave();
    });
    if (editRestdayTime) editRestdayTime.addEventListener('change', function() {
        updateReminderSummary();
        autoSave();
    });
    if (editRestdayOff) editRestdayOff.addEventListener('change', function() {
        updateReminderSummary();
        autoSave();
    });
}

// ==================== 启动 ====================

document.addEventListener('DOMContentLoaded', async function() {
    var t0 = performance.now();
    // 第一步：必须同步的操作 — 加载配置、应用主题
    await loadConfig();
    // 隐藏加载层
    var loadingOverlay = document.getElementById('loadingOverlay');
    if (loadingOverlay) loadingOverlay.classList.add('hidden');

    // 第二步：分步渲染，避免阻塞首帧
    requestAnimationFrame(function() {
        // Tab 栏（首帧已由 loadConfig 渲染）

        requestAnimationFrame(function() {
            // 内容面板（首帧已由 switchTab 渲染）

            var tDel = performance.now();

            // 第三步：日志面板事件绑定 + 加载历史日志（不阻塞首帧）
            setTimeout(function() {
                bindLogPanelEvents();
                window.__log.loadFromFile();
            }, 100);

            // 第四步：一次性事件委托，替代每次渲染后重新绑定监听器
            setupEventDelegation();

            // 第五步：初始化提醒横幅队列系统 + 定义后台回调
            window.__bannerQueue = [];
            window.__bannerIdSeq = 0;
            window.__renderBanners = function() {
                var area = document.getElementById('bannerArea');
                if (!area) return;
                var maxShow = 2;
                var visible = window.__bannerQueue.slice(0, maxShow);
                var hiddenCount = window.__bannerQueue.length - maxShow;
                area.innerHTML = '';
                if (window.__bannerQueue.length === 0) {
                    area.classList.remove('has-banners');
                    return;
                }
                area.classList.add('has-banners');
                visible.forEach(function(item) {
                    var row = document.createElement('div');
                    row.className = 'banner-item';
                    var span = document.createElement('span');
                    span.className = 'banner-item-text';
                    span.textContent = item.text;
                    row.appendChild(span);
                    var btn = document.createElement('button');
                    btn.className = 'banner-item-close';
                    btn.innerHTML = '&times;';
                    btn.addEventListener('click', function() {
                        var idx = window.__bannerQueue.indexOf(item);
                        if (idx !== -1) window.__bannerQueue.splice(idx, 1);
                        window.__renderBanners();
                        // 不保存配置：Rust 线程已持久化 done/last_notified
                    });
                    row.appendChild(btn);
                    area.appendChild(row);
                });
                if (hiddenCount > 0) {
                    var more = document.createElement('div');
                    more.className = 'banner-item';
                    more.style.background = 'rgba(229,57,53,0.7)';
                    more.style.fontSize = '12px';
                    more.style.padding = '4px 16px';
                    more.style.justifyContent = 'center';
                    more.textContent = '还有 ' + hiddenCount + ' 条提醒';
                    area.appendChild(more);
                }
            };
            window.__onReminderFired = function(id, text) {
                window.__bannerQueue.push({ text: '⏰ ' + text, id: ++window.__bannerIdSeq, todoId: id });
                window.__renderBanners();
                // 本地更新待办状态，不重新拉取（Rust 端 save_config 在 for 循环后才执行，磁盘数据尚未更新）
                var todo = (currentConfig.todos || []).find(function(t) { return t.id === id; });
                if (todo) {
                    // 仅一次性待办标记完成，周期性待办保留原状态
                    if (!todo.repeat) {
                        todo.done = true;
                        todo.completed_at = new Date().toISOString();
                    }
                    todo.last_notified = Date.now();
                }
                if (currentTab === 'todo') {
                    renderTodos();
                }
            };

            // 启动时扫描过期提醒，展示横幅并将一次性待办标记完成
            (function() {
                var now = new Date();
                var items = [];
                var needSave = false;
                (currentConfig.todos || []).forEach(function(t) {
                    if (t.done || !t.reminder || !t.reminder.datetime) return;
                    // 跳过已被用户关闭过的提醒
                    if (t.last_notified) return;
                    var rt = new Date(t.reminder.datetime);
                    if (!isNaN(rt) && rt <= now) {
                        items.push({ text: '⏰ ' + t.text, todoId: t.id });
                        // 一次性待办启动时自动标记完成
                        if (!t.repeat && t.reminder.datetime && t.reminder.datetime.includes('T')) {
                            t.done = true;
                            t.completed_at = new Date().toISOString();
                            t.last_notified = Date.now();
                            needSave = true;
                        }
                    }
                });
                items.forEach(function(item) {
                    window.__bannerQueue.push({ text: item.text, id: ++window.__bannerIdSeq, todoId: item.todoId });
                });
                window.__renderBanners();

                // 先保存再刷新，避免竞态
                var refreshPromise;
                if (needSave) {
                    refreshPromise = saveConfigToBackend().catch(function(e) {
                        window.__log.error('启动扫描保存失败: ' + e);
                    }).then(function() {
                        return invoke('get_config');
                    });
                } else if (items.length > 0) {
                    refreshPromise = invoke('get_config');
                }
                if (refreshPromise) {
                    refreshPromise.then(function(fresh) {
                        currentConfig.todos = fresh.todos;
                        renderTodos();
                    }).catch(function() {});
                }
            })();

            // 填充年份下拉
            (function populateHolidayYears() {
                var select = document.getElementById('holidayYearSelect');
                if (!select) return;
                var currentYear = new Date().getFullYear();
                for (var y = 2026; y <= currentYear + 1; y++) {
                    var opt = document.createElement('option');
                    opt.value = String(y);
                    opt.textContent = y + '年';
                    select.appendChild(opt);
                }
            })();

            window.__log.perf('Startup', 'DOMContentLoaded 总耗时', {
                loadConfig: +(tDel - t0).toFixed(2),
                full: +(performance.now() - t0).toFixed(2)
            });
        });
    });
});

// ==================== 事件委托（一次性设置，替代每次渲染后重新绑定） ====================

function setupEventDelegation() {

    // ─── 游戏标签 ───
    gameTabs.addEventListener('click', async function(e) {
        // 新增游戏
        var addBtn = e.target.closest('.game-tab-add');
        if (addBtn) {
            var gameId = crypto.randomUUID();
            var slotId = crypto.randomUUID();
            var n = currentConfig.games.length + 1;
            currentConfig.games.push({
                id: gameId, name: '游戏' + n,
                slots: [{ id: slotId, name: '存档1', file_paths: [], next_backup_number: 1, key_file_patterns: [] }],
                pinned: false
            });
            await saveConfigToBackend();
            selectedGameId = gameId;
            selectedSlotId = slotId;
            renderGameTabs();
            renderSlotTabs();
            refreshBackupList();
            setTimeout(function() {
                var newTab = document.querySelector('.game-tab[data-game-id="' + gameId + '"]');
                if (newTab) startInlineEditGame(newTab);
            }, 50);
            return;
        }
        // 删除游戏
        var delBtn = e.target.closest('[data-action="delete-game"]');
        if (delBtn) {
            var gId = delBtn.dataset.gameId;
            var game = currentConfig.games.find(function(g) { return g.id === gId; });
            if (!game) return;
            if (!confirm('确定删除游戏「' + game.name + '」及其所有存档位吗？')) return;
            currentConfig.games = currentConfig.games.filter(function(g) { return g.id !== gId; });
            if (selectedGameId === gId) { selectedGameId = ''; selectedSlotId = ''; }
            await saveConfigToBackend();
            renderGameTabs();
            renderSlotTabs();
            refreshBackupList();
            return;
        }
        // 置顶切换
        var pinBtn = e.target.closest('[data-action="pin-game"]');
        if (pinBtn) {
            toggleGamePin(pinBtn.dataset.gameId);
            return;
        }
        // 选中游戏
        var tab = e.target.closest('.game-tab');
        if (!tab) return;
        var gId = tab.dataset.gameId;
        if (gId !== selectedGameId) {
            var now = Date.now();
            if (now - _lastGameTabClick < TAB_DEBOUNCE_MS) return;
            _lastGameTabClick = now;
            selectedGameId = gId;
            selectedSlotId = '';
            var g = currentConfig.games.find(function(g) { return g.id === gId; });
            if (g && g.slots.length > 0) {
                selectedSlotId = g.slots[0].id;
                restoreFilePaths();
            }
            renderGameTabs();
            renderSlotTabs();
            refreshBackupList();
        }
    });

    gameTabs.addEventListener('dblclick', function(e) {
        if (e.target.closest('[data-action="delete-game"]')) return;
        var tab = e.target.closest('.game-tab');
        if (!tab) return;
        startInlineEditGame(tab);
    });

    // ─── 存档位标签 ───
    slotTabs.addEventListener('click', async function(e) {
        // 新增存档位
        var addBtn = e.target.closest('.slot-tag-add');
        if (addBtn) {
            var game = currentConfig.games.find(function(g) { return g.id === selectedGameId; });
            if (!game) return;
            var slotId = crypto.randomUUID();
            var n = game.slots.length + 1;
            game.slots.push({ id: slotId, name: '存档' + n, file_paths: [], next_backup_number: 1, key_file_patterns: [] });
            await saveConfigToBackend();
            selectedSlotId = slotId;
            renderSlotTabs();
            refreshBackupList();
            setTimeout(function() {
                var newTag = document.querySelector('.slot-tag[data-slot-id="' + slotId + '"]');
                if (newTag) startInlineEditSlot(newTag);
            }, 50);
            return;
        }
        // 删除存档位
        var delBtn = e.target.closest('[data-action="delete-slot"]');
        if (delBtn) {
            var game = currentConfig.games.find(function(g) { return g.id === selectedGameId; });
            if (!game) return;
            var slotId = delBtn.dataset.slotId;
            var slot = game.slots.find(function(s) { return s.id === slotId; });
            if (!slot) return;
            if (game.slots.length <= 1) { alert('至少保留一个存档位'); return; }
            if (!confirm('确定删除存档位「' + slot.name + '」及其所有备份吗？')) return;
            game.slots = game.slots.filter(function(s) { return s.id !== slotId; });
            if (selectedSlotId === slotId) selectedSlotId = game.slots[0].id;
            await saveConfigToBackend();
            renderSlotTabs();
            refreshBackupList();
            return;
        }
        // 选中存档位
        var tag = e.target.closest('.slot-tag');
        if (!tag) return;
        var slotId = tag.dataset.slotId;
        if (slotId !== selectedSlotId) {
            var now = Date.now();
            if (now - _lastSlotTabClick < TAB_DEBOUNCE_MS) return;
            _lastSlotTabClick = now;
            selectedSlotId = slotId;
            restoreFilePaths();
            renderSlotTabs();
            refreshBackupList();
        }
    });

    slotTabs.addEventListener('dblclick', function(e) {
        if (e.target.closest('[data-action="delete-slot"]')) return;
        var tag = e.target.closest('.slot-tag');
        if (!tag) return;
        startInlineEditSlot(tag);
    });

    // ─── 文件标签 ───
    fileTagsContainer.addEventListener('click', async function(e) {
        var addBtn = e.target.closest('.file-tag-add, #addFileBtn');
        if (addBtn) {
            var startDir = (currentConfig.backup_root || null);
            var path = await invoke('pick_file', { startDir: startDir });
            if (path) {
                var paths = getCurrentFilePaths();
                if (!paths.includes(path)) {
                    paths.push(path);
                    setCurrentFilePaths(paths);
                    renderFileTags();
                    await refreshCurrentHashes();
                    refreshBackupList();
                }
            }
            return;
        }
        var removeBtn = e.target.closest('[data-action="remove-file"]');
        if (removeBtn) {
            var idx = parseInt(removeBtn.dataset.index, 10);
            var paths = getCurrentFilePaths();
            paths.splice(idx, 1);
            setCurrentFilePaths(paths);
            renderFileTags();
            await refreshCurrentHashes();
            refreshBackupList();
        }
    });

    // ─── 节假日管理 ───
    document.getElementById('holidayYearsList').addEventListener('click', function(e) {
        var btn = e.target.closest('[data-action]');
        if (!btn) return;
        if (btn.dataset.action === 'edit-holiday') {
            openHolidayEditor(parseInt(btn.dataset.year, 10));
        } else if (btn.dataset.action === 'del-holiday') {
            var year = parseInt(btn.dataset.year, 10);
            currentConfig.holiday_data = (currentConfig.holiday_data || []).filter(function(h) { return h.year !== year; });
            saveConfigToBackend().then(function() {
                renderHolidayYears();
                document.getElementById('holidayEditor').style.display = 'none';
            });
        }
    });

    // ─── 备份列表操作 ───
    backupList.addEventListener('click', async function(e) {
        var btn = e.target.closest('[data-action]');
        if (!btn) return;
        var action = btn.dataset.action;
        var folder = btn.dataset.folder;

        if (action === 'restore') await handleRestore(folder);
        else if (action === 'rename-backup') await handleRenameBackup(folder, btn.dataset.desc);
        else if (action === 'delete-backup') await handleDeleteBackup(folder);
        else if (action === 'toggle-pin') await handleTogglePin(btn, folder);
        else if (action === 'open-backup') await handleOpenBackupFolder(folder);
        else if (action === 'rehash-backup') await handleRehashBackup(btn, folder);
    });

    // ─── 待办列表 ───
    todoList.addEventListener('click', function(e) {
        var btn = e.target.closest('[data-action]');
        if (!btn) return;
        var action = btn.dataset.action;
        var id = btn.closest('.todo-item');
        id = id ? id.dataset.id : null;
        if (!id) return;

        if (action === 'toggle-todo') {
            toggleTodoDone(id);
        } else if (action === 'edit-todo') {
            openTodoEditModal(id);
        } else if (action === 'delete-todo') {
            if (confirm('确定删除此待办？')) deleteTodo(id);
        } else if (action === 'toggle-pause') {
            var todo = currentConfig.todos.find(function(t) { return t.id === id; });
            if (!todo || !todo.reminder) return;
            var now = new Date();
            var reminderTime = new Date(todo.reminder.datetime);
            if (reminderTime <= now) return;
            todo.paused = !todo.paused;
            saveConfigToBackend();
            renderTodos();
        }
    });

    // ─── 待办统计栏点击筛选 ───
    todoStats.addEventListener('click', function(e) {
        var span = e.target.closest('span[data-filter]');
        if (!span) return;
        todoFilterStatus.value = span.dataset.filter;
        renderTodos();
    });
}

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
        // 写所有级别到文件（buffer 保留给应用内查看，由 push 中的 MAX 控制上限）
        var lines = buffer.map(fmt);
        if (lines.length) {
            try {
                window.__TAURI_INTERNALS__.invoke('log_write', { lines: lines })
                    .catch(function(err) {
                        console.warn('日志写入失败', err);
                    })
                    .finally(function() { busy = false; });
            } catch(e) { busy = false; }
        } else {
            busy = false;
        }
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

    // 解析文件中的日志行：[timestamp][level][source] message
    function parseLogLine(line) {
        var m = line.match(/^\[(.+?)\]\[(.+?)\]\[(.+?)\]\s(.+)$/);
        if (!m) return null;
        var ts = new Date(m[1].replace(' ', 'T') + (m[1].length === 23 ? '' : '.000')).getTime();
        return {
            time: isNaN(ts) ? Date.now() : ts,
            level: m[2].trim(),
            source: m[3].trim(),
            message: m[4]
        };
    }

    window.__log = {
        debug: function(s,m,d) { push('DEBUG',s,m,d); },
        info:  function(s,m,d) { push('INFO', s,m,d); },
        perf:  function(s,m,d) { push('PERF', s,m,d); },
        warn:  function(s,m,d) { push('WARN', s,m,d); },
        error: function(s,m,d) { push('ERROR',s,m,d); },
        flush: doFlush,
        setLevel: function(l) { if (LEVEL_MAP[l] !== void 0) minLv = LEVEL_MAP[l]; },
        loadFromFile: function() {
            window.__TAURI_INTERNALS__.invoke('read_today_logs', {}).then(function(lines) {
                for (var i = 0; i < lines.length; i++) {
                    var entry = parseLogLine(lines[i]);
                    if (entry) buffer.push(entry);
                }
                if (buffer.length > MAX) buffer.splice(0, buffer.length - MAX);
                // 如果日志面板正在显示，刷新渲染
                var panel = document.getElementById('panel-log');
                if (panel && panel.classList.contains('active')) renderLogPanel();
            }).catch(function() {});
        },
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

// ==================== 日志面板渲染 ====================

function renderLogPanel() {
    var t0 = performance.now();
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
        var msg = escapeHtml(e.message);
        var src = escapeHtml(e.source || '');
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
    window.__log.perf('Render', 'renderLogPanel', { ms: +(performance.now() - t0).toFixed(2), entries: showCount, totalEntries: entries.length });
}

function bindLogPanelEvents() {
    var logSearch = document.getElementById('logSearch');
    var logFilter = document.getElementById('logLevelFilter');
    var logOpenDir = document.getElementById('logOpenDirBtn');
    var logClear  = document.getElementById('logClearBtn');
    if (logSearch) logSearch.addEventListener('input', renderLogPanel);
    if (logFilter) logFilter.addEventListener('change', renderLogPanel);
    if (logOpenDir) logOpenDir.addEventListener('click', function() {
        invoke('open_log_folder').catch(function(err) {
            console.warn('打开日志目录失败', err);
        });
    });
    if (logClear)  logClear.addEventListener('click', function() {
        window.__log.clear();
        renderLogPanel();
    });
}
