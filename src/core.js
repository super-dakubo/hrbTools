const invoke = (cmd, args) => window.__TAURI_INTERNALS__.invoke(cmd, args);

// ==================== 状态 ====================
let currentConfig = { backup_root: '', games: [], timezone_sets: [] };
let selectedGameId = '';
let selectedSlotId = '';
let filePathsBySlot = {};      // { "gameId:slotId": ["D:/saves/save.dat", "D:/saves/config.ini"] }
let currentHashesBySlot = {};  // { "gameId:slotId": { "save.dat": "abc", "config.ini": "def" } }
let _isSettingsActive = false;
let _previousTab = 'convert';

// Screenshot state
let _ssSources = [];           // ScreenshotSource[]
let _ssCurrentSourceId = '';   // Currently selected source ID
let _ssEntries = [];           // ScreenshotEntry[] for current source
let _ssPage = 0;               // Current page (0-indexed)
let _ssPageSize = 20;          // Items per page
let _ssCache = {};             // sourceId -> { entries, fetchedAt }
let _ssSearchQuery = '';       // Current search filter
let _ssSearchTimer = null;     // Debounce timer
let _ssLbIndex = -1;           // Lightbox current index

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
const reminderToggle = document.getElementById('reminderToggle');

// ==================== Tab 栏管理 ====================
const TAB_DEFS = {
    convert: { icon: '<svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 3"/></svg>', label: '时间转换' },
    backup:  { icon: '<svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M4 4h16v16H4z"/><path d="M4 9h16"/><path d="M9 4v5"/><path d="M15 4v5"/><circle cx="9" cy="14" r="1.5"/><circle cx="15" cy="14" r="1.5"/></svg>', label: '存档管理' },
    todo:    { icon: '<svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><rect x="4" y="2" width="16" height="20" rx="2"/><path d="M9 11l2 2 4-4"/></svg>', label: '待办工具' },
    screenshot: { icon: '<svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M23 19a2 2 0 01-2 2H3a2 2 0 01-2-2V8a2 2 0 012-2h4l2-3h6l2 3h4a2 2 0 012 2z"/><circle cx="12" cy="13" r="4"/></svg>', label: '截图' },
    log:     { icon: '<svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z"/><path d="M14 2v6h6"/><path d="M8 13h8"/><path d="M8 17h4"/></svg>', label: '日志' },
};
const DEFAULT_TAB_ORDER = ['convert', 'backup', 'todo', 'screenshot', 'log'];
let currentTab = 'convert';
let _switchLock = false;
let _lastTabClick = 0;
let _lastGameTabClick = 0;
let _lastSlotTabClick = 0;
let _refreshLock = false;
let _backupListLock = false;
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
    // 已迁移至 setupEventDelegation，此函数保留为空
}

function switchTab(tabId) {
    var now = performance.now();
    if (_switchLock) {
        window.__log.perf('TabSwitch', '阻断: 切换锁占用中', { tabId: tabId });
        return;
    }
    _switchLock = true;

    // Close screenshot lightbox on tab switch
    var ssLb = document.getElementById('ssLightbox');
    if (ssLb) ssLb.classList.remove('open');

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
    else if (tabId === 'screenshot') { renderScreenshotPanel(); }
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

// ==================== 配置管理 ====================

async function loadConfig() {
    var tStartup = performance.now();
    // 使用头部脚本预热的 IPC 调用（冷启动已在 HTML 解析阶段完成）
    var config = window.__configPromise ? await window.__configPromise : null;
    if (!config) {
        window.__log.error('Config', '获取配置失败: IPC 返回空');
        config = await invoke('get_config');
    }
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
        // 清理经 Rust serde 反序列化后 title 丢失的旧横幅
        currentConfig.banners = currentConfig.banners.filter(function(b) {
            return b.title && b.title.trim() !== '';
        });
    }
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

let _saveInProgress = false;
let _pendingSave = false;
async function saveConfigToBackend() {
    if (_saveInProgress) {
        _pendingSave = true;
        return;
    }
    _saveInProgress = true;
    _pendingSave = false;
    try {
        await invoke('set_config', { config: currentConfig });
    } catch (err) {
        window.__log.error('Config', '保存配置失败: ' + err);
    } finally {
        _saveInProgress = false;
        if (_pendingSave) {
            saveConfigToBackend();
        }
    }
}

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

