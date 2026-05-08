// 直接使用 Tauri 内部 IPC
const invoke = (cmd, args) => window.__TAURI_INTERNALS__.invoke(cmd, args);

// ==================== 状态 ====================
let currentConfig = { backup_root: '', games: [], timezone_sets: [] };
let selectedGameId = '';
let selectedSlotId = '';
let filePathsBySlot = {};      // { "gameId:slotId": ["D:/saves/save.dat", "D:/saves/config.ini"] }
let currentHashesBySlot = {};  // { "gameId:slotId": { "save.dat": "abc", "config.ini": "def" } }

// ==================== DOM 引用 ====================

// 全局 Tab
const tabs = document.querySelectorAll('.tab');
const panels = document.querySelectorAll('.panel');

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
const settingsOverlay = document.getElementById('settingsOverlay');
const settingsCloseBtn = document.getElementById('settingsCloseBtn');
const settingsBackupRoot = document.getElementById('settingsBackupRoot');
const settingsSetDirBtn = document.getElementById('settingsSetDirBtn');
const settingsOpenDirBtn = document.getElementById('settingsOpenDirBtn');
const themeToggleBtn = document.getElementById('themeToggleBtn');

// ==================== 全局 Tab 切换 ====================
tabs.forEach(tab => {
    tab.addEventListener('click', () => {
        tabs.forEach(t => t.classList.remove('active'));
        panels.forEach(p => p.classList.remove('active'));
        tab.classList.add('active');
        document.getElementById('panel-' + tab.dataset.tab).classList.add('active');
        if (tab.dataset.tab === 'backup') refreshAll();
    });
});

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
    const Y = dateParts[0];
    const M = dateParts[1];
    const D = dateParts[2];
    const h = timeParts[0];
    const m = timeParts[1];
    const s = timeParts[2];
    if (!format) return `${Y}-${M}-${D} ${h}:${m}:${s}`;
    if (format === '%Y/%m/%d %H:%M:%S') return `${Y}/${M}/${D} ${h}:${m}:${s}`;
    if (format === '%Y-%m-%d %H:%M') return `${Y}-${M}-${D} ${h}:${m}`;
    if (format === '%m-%d %H:%M') return `${M}-${D} ${h}:${m}`;
    return rustStr;
}

function renderTimezoneSets() {
    const sorted = [...currentConfig.timezone_sets].sort((a, b) => {
        if (a.id === 'beijing') return -1;
        if (b.id === 'beijing') return 1;
        if (a.pinned !== b.pinned) return b.pinned - a.pinned;
        return a.sort_order - b.sort_order;
    });

    timezoneSets.innerHTML = sorted.map(set => {
        const isBeijing = set.id === 'beijing';
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
    currentConfig = await invoke('get_config');
    applyTheme(currentConfig.theme || 'system');
    updateSettingsDisplay();
    renderTimezoneSets();
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

    bindFileTagEvents();
}

function bindFileTagEvents() {
    const addBtn = document.getElementById('addFileBtn');
    if (addBtn) {
        addBtn.addEventListener('click', async () => {
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
    }

    fileTagsContainer.querySelectorAll('[data-action="remove-file"]').forEach(btn => {
        btn.addEventListener('click', async (e) => {
            e.stopPropagation();
            const idx = parseInt(btn.dataset.index, 10);
            const paths = getCurrentFilePaths();
            paths.splice(idx, 1);
            setCurrentFilePaths(paths);
            renderFileTags();
            await refreshCurrentHashes();
            refreshBackupList();
        });
    });
}

// ==================== 游戏标签渲染 ====================

function renderGameTabs() {
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

    bindGameTabEvents();
}

function getSortedGames() {
    return [...currentConfig.games].sort((a, b) => {
        if (a.pinned !== b.pinned) return b.pinned - a.pinned;
        return a.name.localeCompare(b.name);
    });
}

function bindGameTabEvents() {
    document.querySelectorAll('.game-tab').forEach(tab => {
        tab.addEventListener('click', (e) => {
            if (e.target.dataset.action === 'delete-game') return;
            if (e.target.dataset.action === 'pin-game') {
                e.stopPropagation();
                toggleGamePin(e.target.dataset.gameId);
                return;
            }
            const gameId = tab.dataset.gameId;
            if (gameId !== selectedGameId) {
                selectedGameId = gameId;
                selectedSlotId = '';
                const game = currentConfig.games.find(g => g.id === gameId);
                if (game && game.slots.length > 0) {
                    selectedSlotId = game.slots[0].id;
                    restoreFilePaths();
                }
                renderGameTabs();
                renderSlotTabs();
                refreshBackupList();
            }
        });

        tab.addEventListener('dblclick', (e) => {
            if (e.target.dataset.action === 'delete-game') return;
            startInlineEditGame(tab);
        });

    });

    document.querySelectorAll('.tab-close[data-action="delete-game"]').forEach(btn => {
        btn.addEventListener('click', async (e) => {
            e.stopPropagation();
            const gameId = btn.dataset.gameId;
            const game = currentConfig.games.find(g => g.id === gameId);
            if (!game) return;
            if (!confirm(`确定删除游戏「${game.name}」及其所有存档位吗？`)) return;
            currentConfig.games = currentConfig.games.filter(g => g.id !== gameId);
            if (selectedGameId === gameId) { selectedGameId = ''; selectedSlotId = ''; }
            await saveConfigToBackend();
            renderGameTabs();
            renderSlotTabs();
            refreshBackupList();
        });
    });

    const addBtn = document.getElementById('addGameBtn');
    if (addBtn) {
        addBtn.addEventListener('click', async () => {
            const gameId = crypto.randomUUID();
            const slotId = crypto.randomUUID();
            const n = currentConfig.games.length + 1;
            const name = `游戏${n}`;
            currentConfig.games.push({
                id: gameId,
                name,
                slots: [{ id: slotId, name: '存档1', file_paths: [], next_backup_number: 1, key_file_patterns: [] }],
                pinned: false
            });
            await saveConfigToBackend();
            selectedGameId = gameId;
            selectedSlotId = slotId;
            renderGameTabs();
            renderSlotTabs();
            refreshBackupList();
            setTimeout(() => {
                const newTab = document.querySelector(`.game-tab[data-game-id="${gameId}"]`);
                if (newTab) startInlineEditGame(newTab);
            }, 50);
        });
    }
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
    if (!selectedGameId) { slotTabs.innerHTML = ''; return; }
    const game = currentConfig.games.find(g => g.id === selectedGameId);
    if (!game || game.slots.length === 0) {
        slotTabs.innerHTML = '<span class="slot-tabs-label">存档位</span>';
        return;
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

    bindSlotTagEvents(game);
}

function bindSlotTagEvents(game) {
    document.querySelectorAll('.slot-tag').forEach(tag => {
        tag.addEventListener('click', (e) => {
            if (e.target.dataset.action === 'delete-slot') return;
            const slotId = tag.dataset.slotId;
            if (slotId !== selectedSlotId) {
                selectedSlotId = slotId;
                restoreFilePaths();
                renderSlotTabs();
                refreshBackupList();
            }
        });

        tag.addEventListener('dblclick', (e) => {
            if (e.target.dataset.action === 'delete-slot') return;
            startInlineEditSlot(tag);
        });
    });

    document.querySelectorAll('.tag-close[data-action="delete-slot"]').forEach(btn => {
        btn.addEventListener('click', async (e) => {
            e.stopPropagation();
            const slotId = btn.dataset.slotId;
            const slot = game.slots.find(s => s.id === slotId);
            if (!slot) return;
            if (game.slots.length <= 1) { alert('至少保留一个存档位'); return; }
            if (!confirm(`确定删除存档位「${slot.name}」及其所有备份吗？`)) return;
            game.slots = game.slots.filter(s => s.id !== slotId);
            if (selectedSlotId === slotId) selectedSlotId = game.slots[0].id;
            await saveConfigToBackend();
            renderSlotTabs();
            refreshBackupList();
        });
    });

    const addBtn = document.getElementById('addSlotBtn');
    if (addBtn) {
        addBtn.addEventListener('click', async () => {
            const slotId = crypto.randomUUID();
            const n = game.slots.length + 1;
            const name = `存档${n}`;
            game.slots.push({ id: slotId, name, file_paths: [], next_backup_number: 1, key_file_patterns: [] });
            await saveConfigToBackend();
            selectedSlotId = slotId;
            renderSlotTabs();
            refreshBackupList();
            setTimeout(() => {
                const newTag = document.querySelector(`.slot-tag[data-slot-id="${slotId}"]`);
                if (newTag) startInlineEditSlot(newTag);
            }, 50);
        });
    }
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
    } catch (e) { /* source might not exist, ignore */ }
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
        const backups = await invoke('list_backups', {
            gameId: selectedGameId,
            slotId: selectedSlotId
        });

        if (backups.length === 0) {
            backupList.innerHTML = '<div class="empty-hint">暂无备份</div>';
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

        bindBackupItemEvents();
    } catch (err) {
        backupList.innerHTML = `<div class="empty-hint">加载失败: ${escapeHtml(String(err))}</div>`;
    }
}

function bindBackupItemEvents() {
    backupList.querySelectorAll('[data-action]').forEach(btn => {
        btn.addEventListener('click', async (e) => {
            e.stopPropagation();
            const action = btn.dataset.action;
            const folder = btn.dataset.folder;

            if (action === 'restore') await handleRestore(folder);
            else if (action === 'rename-backup') await handleRenameBackup(folder, btn.dataset.desc);
            else if (action === 'delete-backup') await handleDeleteBackup(folder);
            else if (action === 'toggle-pin') await handleTogglePin(btn, folder);
            else if (action === 'open-backup') await handleOpenBackupFolder(folder);
            else if (action === 'rehash-backup') await handleRehashBackup(btn, folder);
        });
    });
}

async function handleRestore(folderName) {
    setButtonLoading(saveBackupBtn, '恢复中...');
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
        } else if (result.message.startsWith('SELECT_FILES:')) {
            const fileEntries = result.message.split(':').slice(1).join(':').split(';;');
            const files = fileEntries.map(e => {
                const parts = e.split('|');
                return { name: parts[0], path: parts.slice(1).join('|') };
            }).filter(f => f.name);
            showRestoreFileModal(files, folderName);
        } else if (result.message.startsWith('NEED_BACKUP_CONFIRM:')) {
            const originalPath = result.message.split(':').slice(1).join(':');
            if (confirm('当前存档「' + originalPath + '」未备份，是否需要先备份再恢复？\n\n确定 = 先备份再恢复\n取消 = 直接覆盖恢复')) {
                const backupResult = await invoke('create_backup', {
                    gameId: selectedGameId, slotId: selectedSlotId,
                    filePaths: getCurrentFilePaths()
                });
                if (!backupResult.success && !backupResult.message.startsWith('SELECT_FILES:')) {
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
    } finally {
        resetButton(saveBackupBtn, '保存存档');
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
    } else if (result.message.startsWith('SELECT_FILES:')) {
        const fileEntries = result.message.split(':').slice(1).join(':').split(';;');
        const files = fileEntries.map(e => {
            const parts = e.split('|');
            return { name: parts[0], path: parts.slice(1).join('|') };
        }).filter(f => f.name);
        showRestoreFileModal(files, folderName);
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
        setButtonLoading(saveBackupBtn, '恢复中...');
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
        } finally {
            resetButton(saveBackupBtn, '保存存档');
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
    setButtonLoading(saveBackupBtn, '删除中...');
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
    } finally {
        resetButton(saveBackupBtn, '保存存档');
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

// ==================== 设置弹窗 ====================

settingsBtn.addEventListener('click', () => {
    updateSettingsDisplay();
    settingsOverlay.style.display = 'flex';
});

settingsCloseBtn.addEventListener('click', () => {
    settingsOverlay.style.display = 'none';
});

settingsOverlay.addEventListener('click', (e) => {
    if (e.target === settingsOverlay) settingsOverlay.style.display = 'none';
});

const THEME_LABELS = { system: '🌓 跟随系统', dark: '🌙 暗色模式', light: '☀️ 亮色模式' };
const THEME_ORDER = ['system', 'dark', 'light'];

let systemIsDark = window.matchMedia('(prefers-color-scheme: dark)').matches;

window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', (e) => {
    systemIsDark = e.matches;
    if (currentConfig.theme === 'system') applyTheme('system');
});

themeToggleBtn.addEventListener('click', () => {
    const idx = THEME_ORDER.indexOf(currentConfig.theme);
    const newTheme = THEME_ORDER[(idx + 1) % 3];
    currentConfig.theme = newTheme;
    applyTheme(newTheme);
    saveConfigToBackend();
});

function applyTheme(theme) {
    const isLight = theme === 'system' ? !systemIsDark : theme === 'light';
    if (isLight) {
        document.body.classList.add('light');
    } else {
        document.body.classList.remove('light');
    }
    themeToggleBtn.textContent = THEME_LABELS[theme] || THEME_LABELS.dark;
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

function escapeHtml(str) {
    const div = document.createElement('div');
    div.textContent = str;
    return div.innerHTML;
}

function shortenPath(path) {
    if (!path) return '';
    const parts = path.replace(/\\/g, '/').split('/');
    if (parts.length <= 2) return path;
    return '.../' + parts.slice(-2).join('/');
}

function refreshAll() {
    renderGameTabs();
    renderSlotTabs();
    if (selectedGameId && selectedSlotId) {
        restoreFilePaths();
        refreshCurrentHashes();
        refreshBackupList();
    }
}

// ==================== 启动 ====================

loadConfig();
