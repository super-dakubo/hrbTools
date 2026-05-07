// 直接使用 Tauri 内部 IPC
const invoke = (cmd, args) => window.__TAURI_INTERNALS__.invoke(cmd, args);

// ==================== 状态 ====================
let currentConfig = { backup_root: '', games: [] };
let selectedGame = '';
let selectedSlot = '';
let filePathBySlot = {};       // { "游戏1:存档1": "D:/saves/file.dat" }
let currentHashBySlot = {};    // { "游戏1:存档1": "abc123" }

// ==================== DOM 引用 ====================

// 全局 Tab
const tabs = document.querySelectorAll('.tab');
const panels = document.querySelectorAll('.panel');

// 时间转换
const datetimeInput = document.getElementById('datetimeInput');
const timestampInput = document.getElementById('timestampInput');
const timezoneSelect = document.getElementById('timezoneSelect');
const convertBtn = document.getElementById('convertBtn');
const convertBackBtn = document.getElementById('convertBackBtn');
const resetTimeBtn = document.getElementById('resetTimeBtn');
const timestampResult = document.getElementById('timestampResult');
const datetimeResult = document.getElementById('datetimeResult');
const errorMsgDiv = document.getElementById('errorMsg');
const errorMsg2Div = document.getElementById('errorMsg2');

// 存档管理
const gameTabs = document.getElementById('gameTabs');
const slotTabs = document.getElementById('slotTabs');
const filePathInput = document.getElementById('filePath');
const browseFileBtn = document.getElementById('browseFileBtn');
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

function getCurrentDatetimeStr() {
    const now = new Date();
    const pad = n => String(n).padStart(2, '0');
    return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())} ${pad(now.getHours())}:${pad(now.getMinutes())}:${pad(now.getSeconds())}`;
}

function getCurrentTimestampMs() { return Date.now().toString(); }

function resetToCurrentTime() {
    datetimeInput.value = getCurrentDatetimeStr();
    timestampInput.value = getCurrentTimestampMs();
}

async function convert() {
    errorMsgDiv.style.display = 'none';
    timestampResult.innerText = '转换中...';
    const datetimeStr = datetimeInput.value.trim();
    const timezone = timezoneSelect.value;
    if (!datetimeStr) { showConvertError(errorMsgDiv, '请输入时间字符串'); return; }
    try {
        const response = await invoke('convert_to_timestamp', { request: { datetime_str: datetimeStr, timezone: timezone } });
        if (response.success) { timestampResult.innerText = response.timestamp; }
        else { showConvertError(errorMsgDiv, response.error); timestampResult.innerText = '—'; }
    } catch (err) { showConvertError(errorMsgDiv, `调用失败: ${err}`); timestampResult.innerText = '—'; }
}

async function convertBack() {
    errorMsg2Div.style.display = 'none';
    datetimeResult.innerText = '转换中...';
    const tsStr = timestampInput.value.trim();
    const timezone = timezoneSelect.value;
    if (!tsStr) { showConvertError(errorMsg2Div, '请输入时间戳'); return; }
    const timestampMs = parseInt(tsStr, 10);
    if (isNaN(timestampMs)) { showConvertError(errorMsg2Div, '时间戳必须是整数'); return; }
    try {
        const response = await invoke('convert_to_datetime', { request: { timestamp_ms: timestampMs, timezone: timezone } });
        if (response.success) { datetimeResult.innerText = response.datetime_str; }
        else { showConvertError(errorMsg2Div, response.error); datetimeResult.innerText = '—'; }
    } catch (err) { showConvertError(errorMsg2Div, `调用失败: ${err}`); datetimeResult.innerText = '—'; }
}

function showConvertError(el, msg) { el.innerText = msg; el.style.display = 'block'; }

convertBtn.addEventListener('click', convert);
datetimeInput.addEventListener('keypress', (e) => { if (e.key === 'Enter') convert(); });
convertBackBtn.addEventListener('click', convertBack);
timestampInput.addEventListener('keypress', (e) => { if (e.key === 'Enter') convertBack(); });
resetTimeBtn.addEventListener('click', resetToCurrentTime);

// ==================== 配置管理 ====================

async function loadConfig() {
    currentConfig = await invoke('get_config');
    updateSettingsDisplay();
    if (currentConfig.games.length > 0) {
        selectedGame = currentConfig.games[0].name;
        if (currentConfig.games[0].slots.length > 0) {
            selectedSlot = currentConfig.games[0].slots[0].name;
        }
    }
    renderGameTabs();
    renderSlotTabs();
    restoreFilePath();
    await refreshCurrentHash();
    refreshBackupList();
}

async function saveConfigToBackend() {
    await invoke('set_config', { config: currentConfig });
}

// ==================== 游戏标签渲染 ====================

function renderGameTabs() {
    const games = getSortedGames();
    gameTabs.innerHTML = games.map(g => {
        const activeClass = g.name === selectedGame ? ' active' : '';
        const pinnedIcon = g.pinned ? '📌 ' : '';
        return `<button class="game-tab${activeClass}" data-game="${escapeHtml(g.name)}" draggable="true"
                  title="拖拽排序 | 双击改名${g.pinned ? ' | 已置顶' : ''}">
                  ${pinnedIcon}${escapeHtml(g.name)}
                  <span class="tab-close" data-action="delete-game" data-game="${escapeHtml(g.name)}">&times;</span>
                </button>`;
    }).join('') + `<button class="game-tab-add" id="addGameBtn" title="新增游戏">+</button>`;

    bindGameTabEvents();
}

function getSortedGames() {
    return [...currentConfig.games].sort((a, b) => {
        if (a.pinned !== b.pinned) return b.pinned - a.pinned;
        if (a.sort_order !== b.sort_order) return a.sort_order - b.sort_order;
        return a.name.localeCompare(b.name);
    });
}

function bindGameTabEvents() {
    document.querySelectorAll('.game-tab').forEach(tab => {
        tab.addEventListener('click', (e) => {
            if (e.target.dataset.action === 'delete-game') return;
            const name = tab.dataset.game;
            if (name !== selectedGame) {
                selectedGame = name;
                selectedSlot = '';
                const game = currentConfig.games.find(g => g.name === name);
                if (game && game.slots.length > 0) {
                    selectedSlot = game.slots[0].name;
                    restoreFilePath();
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

        tab.addEventListener('dragstart', (e) => {
            e.dataTransfer.setData('text/plain', tab.dataset.game);
            tab.classList.add('dragging');
        });
        tab.addEventListener('dragend', () => tab.classList.remove('dragging'));
    });

    document.querySelectorAll('.game-tab').forEach(tab => {
        tab.addEventListener('dragover', (e) => { e.preventDefault(); });
        tab.addEventListener('drop', async (e) => {
            e.preventDefault();
            const fromName = e.dataTransfer.getData('text/plain');
            const toName = tab.dataset.game;
            if (fromName === toName) return;
            await handleGameReorder(fromName, toName);
        });
    });

    document.querySelectorAll('.tab-close[data-action="delete-game"]').forEach(btn => {
        btn.addEventListener('click', async (e) => {
            e.stopPropagation();
            const name = btn.dataset.game;
            if (!confirm(`确定删除游戏「${name}」及其所有存档位吗？`)) return;
            currentConfig.games = currentConfig.games.filter(g => g.name !== name);
            if (selectedGame === name) { selectedGame = ''; selectedSlot = ''; }
            await saveConfigToBackend();
            renderGameTabs();
            renderSlotTabs();
            refreshBackupList();
        });
    });

    const addBtn = document.getElementById('addGameBtn');
    if (addBtn) {
        addBtn.addEventListener('click', async () => {
            const n = currentConfig.games.length + 1;
            const name = `游戏${n}`;
            currentConfig.games.push({
                name, slots: [{ name: '存档1', next_backup_number: 1, key_file_patterns: [] }],
                pinned: false, sort_order: currentConfig.games.length
            });
            await saveConfigToBackend();
            selectedGame = name;
            selectedSlot = '存档1';
            renderGameTabs();
            renderSlotTabs();
            refreshBackupList();
            setTimeout(() => {
                const newTab = document.querySelector(`.game-tab[data-game="${escapeHtml(name)}"]`);
                if (newTab) startInlineEditGame(newTab);
            }, 50);
        });
    }
}

function startInlineEditGame(tab) {
    const name = tab.dataset.game;
    const span = tab.querySelector('span') || tab.childNodes[0];
    const input = document.createElement('input');
    input.value = name;
    input.addEventListener('keydown', async (e) => {
        if (e.key === 'Enter') {
            const newName = input.value.trim();
            if (newName && newName !== name) await renameGame(name, newName);
        } else if (e.key === 'Escape') {
            renderGameTabs();
            if (selectedGame) renderSlotTabs();
        }
    });
    input.addEventListener('blur', async () => {
        const newName = input.value.trim();
        if (newName && newName !== name) await renameGame(name, newName);
        else { renderGameTabs(); if (selectedGame) renderSlotTabs(); }
    });
    // Replace the text content but keep the close button
    while (tab.firstChild) tab.removeChild(tab.firstChild);
    tab.appendChild(input);
    // Add close button back
    const closeBtn = document.createElement('span');
    closeBtn.className = 'tab-close';
    closeBtn.dataset.action = 'delete-game';
    closeBtn.dataset.game = name;
    closeBtn.innerHTML = '&times;';
    tab.appendChild(closeBtn);
    input.focus();
    input.select();
}

async function renameGame(oldName, newName) {
    if (currentConfig.games.some(g => g.name === newName)) {
        alert('该游戏名已存在');
        renderGameTabs(); renderSlotTabs();
        return;
    }
    const game = currentConfig.games.find(g => g.name === oldName);
    if (game) game.name = newName;
    if (selectedGame === oldName) selectedGame = newName;
    updateSlotKey(oldName, newName);
    await saveConfigToBackend();
    renderGameTabs();
    renderSlotTabs();
    refreshBackupList();
}

async function handleGameReorder(fromName, toName) {
    const sorted = getSortedGames();
    const fromIdx = sorted.findIndex(g => g.name === fromName);
    const toIdx = sorted.findIndex(g => g.name === toName);
    sorted.splice(toIdx, 0, sorted.splice(fromIdx, 1)[0]);
    const names = sorted.map(g => g.name);
    await invoke('reorder_games', { gameNames: names });
    names.forEach((n, i) => {
        const g = currentConfig.games.find(g => g.name === n);
        if (g) g.sort_order = i;
    });
    renderGameTabs();
}

function updateSlotKey(oldGameName, newGameName) {
    const newFilePath = {};
    const newHash = {};
    for (const [key, val] of Object.entries(filePathBySlot)) {
        if (key.startsWith(oldGameName + ':')) {
            newFilePath[newGameName + ':' + key.slice(oldGameName.length + 1)] = val;
        } else { newFilePath[key] = val; }
    }
    for (const [key, val] of Object.entries(currentHashBySlot)) {
        if (key.startsWith(oldGameName + ':')) {
            newHash[newGameName + ':' + key.slice(oldGameName.length + 1)] = val;
        } else { newHash[key] = val; }
    }
    filePathBySlot = newFilePath;
    currentHashBySlot = newHash;
}

// ==================== 存档位标签渲染 ====================

function renderSlotTabs() {
    if (!selectedGame) { slotTabs.innerHTML = ''; return; }
    const game = currentConfig.games.find(g => g.name === selectedGame);
    if (!game || game.slots.length === 0) {
        slotTabs.innerHTML = '<span class="slot-tabs-label">存档位</span>';
        return;
    }

    slotTabs.innerHTML = '<span class="slot-tabs-label">存档位</span>' +
        game.slots.map(s => {
            const activeClass = s.name === selectedSlot ? ' active' : '';
            return `<button class="slot-tag${activeClass}" data-slot="${escapeHtml(s.name)}">
                      ${escapeHtml(s.name)}
                      <span class="tag-close" data-action="delete-slot" data-slot="${escapeHtml(s.name)}">&times;</span>
                    </button>`;
        }).join('') +
        `<button class="slot-tag-add" id="addSlotBtn" title="新增存档位">+</button>`;

    bindSlotTagEvents(game);
}

function bindSlotTagEvents(game) {
    document.querySelectorAll('.slot-tag').forEach(tag => {
        tag.addEventListener('click', (e) => {
            if (e.target.dataset.action === 'delete-slot') return;
            const name = tag.dataset.slot;
            if (name !== selectedSlot) {
                selectedSlot = name;
                restoreFilePath();
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
            const name = btn.dataset.slot;
            if (game.slots.length <= 1) { alert('至少保留一个存档位'); return; }
            if (!confirm(`确定删除存档位「${name}」及其所有备份吗？`)) return;
            game.slots = game.slots.filter(s => s.name !== name);
            if (selectedSlot === name) selectedSlot = game.slots[0].name;
            await saveConfigToBackend();
            renderSlotTabs();
            refreshBackupList();
        });
    });

    const addBtn = document.getElementById('addSlotBtn');
    if (addBtn) {
        addBtn.addEventListener('click', async () => {
            const n = game.slots.length + 1;
            const name = `存档${n}`;
            game.slots.push({ name, next_backup_number: 1, key_file_patterns: [] });
            await saveConfigToBackend();
            selectedSlot = name;
            renderSlotTabs();
            refreshBackupList();
            setTimeout(() => {
                const newTag = document.querySelector(`.slot-tag[data-slot="${escapeHtml(name)}"]`);
                if (newTag) startInlineEditSlot(newTag);
            }, 50);
        });
    }
}

function startInlineEditSlot(tag) {
    const name = tag.dataset.slot;
    const input = document.createElement('input');
    input.value = name;
    input.addEventListener('keydown', async (e) => {
        if (e.key === 'Enter') {
            const newName = input.value.trim();
            if (newName && newName !== name) await renameSlot(name, newName);
        } else if (e.key === 'Escape') { renderSlotTabs(); }
    });
    input.addEventListener('blur', async () => {
        const newName = input.value.trim();
        if (newName && newName !== name) await renameSlot(name, newName);
        else renderSlotTabs();
    });
    while (tag.firstChild) tag.removeChild(tag.firstChild);
    tag.appendChild(input);
    const closeBtn = document.createElement('span');
    closeBtn.className = 'tag-close';
    closeBtn.dataset.action = 'delete-slot';
    closeBtn.dataset.slot = name;
    closeBtn.innerHTML = '&times;';
    tag.appendChild(closeBtn);
    input.focus();
    input.select();
}

async function renameSlot(oldName, newName) {
    const game = currentConfig.games.find(g => g.name === selectedGame);
    if (!game) return;
    if (game.slots.some(s => s.name === newName)) { alert('该存档位名已存在'); renderSlotTabs(); return; }
    const slot = game.slots.find(s => s.name === oldName);
    if (slot) slot.name = newName;
    if (selectedSlot === oldName) selectedSlot = newName;
    const oldKey = selectedGame + ':' + oldName;
    const newKey = selectedGame + ':' + newName;
    if (filePathBySlot[oldKey]) { filePathBySlot[newKey] = filePathBySlot[oldKey]; delete filePathBySlot[oldKey]; }
    if (currentHashBySlot[oldKey]) { currentHashBySlot[newKey] = currentHashBySlot[oldKey]; delete currentHashBySlot[oldKey]; }
    await saveConfigToBackend();
    renderSlotTabs();
    refreshBackupList();
}

function restoreFilePath() {
    const key = selectedGame + ':' + selectedSlot;
    filePathInput.value = filePathBySlot[key] || '';
}

// ==================== 哈希 ====================

async function refreshCurrentHash() {
    if (!selectedGame || !selectedSlot) return;
    const key = selectedGame + ':' + selectedSlot;
    const fp = filePathBySlot[key];
    if (!fp) return;
    const game = currentConfig.games.find(g => g.name === selectedGame);
    const slot = game ? game.slots.find(s => s.name === selectedSlot) : null;
    const patterns = slot ? slot.key_file_patterns : [];
    try {
        const hash = await invoke('compute_hash', { filePath: fp, patterns: patterns });
        currentHashBySlot[key] = hash;
    } catch (e) { /* source might not exist, ignore */ }
}

// ==================== 文件选择 ====================

browseFileBtn.addEventListener('click', async () => {
    const path = await invoke('pick_file');
    if (path) {
        filePathInput.value = path;
        const key = selectedGame + ':' + selectedSlot;
        filePathBySlot[key] = path;
        await refreshCurrentHash();
        refreshBackupList();
    }
});

filePathInput.addEventListener('change', async () => {
    const key = selectedGame + ':' + selectedSlot;
    filePathBySlot[key] = filePathInput.value.trim();
    await refreshCurrentHash();
    refreshBackupList();
});

// ==================== 备份操作 ====================

saveBackupBtn.addEventListener('click', async () => {
    hideMessages();
    const gameName = selectedGame;
    const slotName = selectedSlot;
    const filePath = filePathInput.value.trim();

    if (!gameName) { showBackupError('请先选择游戏'); return; }
    if (!slotName) { showBackupError('请先选择存档位'); return; }
    if (!filePath) { showBackupError('请输入或选择存档文件路径'); return; }
    if (!currentConfig.backup_root) { showBackupError('请先在设置中配置备份根目录'); return; }

    setButtonLoading(saveBackupBtn, '保存中...');
    try {
        await refreshCurrentHash();
        const key = gameName + ':' + slotName;
        filePathBySlot[key] = filePath;

        const result = await invoke('create_backup', {
            gameName: gameName,
            slotName: slotName,
            filePath: filePath
        });
        if (result.success) {
            showBackupSuccess(result.message);
            await refreshCurrentHash();
            refreshBackupList();
        } else {
            showBackupError(result.message);
        }
    } catch (err) {
        showBackupError(`备份失败: ${err}`);
    } finally {
        resetButton(saveBackupBtn, '保存存档');
    }
});

// ==================== 备份列表 ====================

async function refreshBackupList() {
    if (!selectedGame || !selectedSlot) {
        backupList.innerHTML = '<div class="empty-hint">请先选择游戏和存档位</div>';
        backupListTitle.textContent = '备份记录';
        return;
    }

    backupListTitle.textContent = `备份记录 — ${selectedGame} / ${selectedSlot}`;

    try {
        const backups = await invoke('list_backups', {
            gameName: selectedGame,
            slotName: selectedSlot
        });

        if (backups.length === 0) {
            backupList.innerHTML = '<div class="empty-hint">暂无备份</div>';
            return;
        }

        const currentHash = currentHashBySlot[selectedGame + ':' + selectedSlot] || '';
        const hashCounts = {};
        backups.forEach(b => { if (b.content_hash) hashCounts[b.content_hash] = (hashCounts[b.content_hash] || 0) + 1; });

        backupList.innerHTML = backups.map(b => {
            let extraClass = '';
            let badgeHtml = '';
            const isCurrentMatch = currentHash && b.content_hash === currentHash;
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
        });
    });
}

async function handleRestore(folderName) {
    try {
        const result = await invoke('restore_backup', {
            gameName: selectedGame,
            slotName: selectedSlot,
            folderName: folderName,
            skipBackup: false
        });
        if (result.success) {
            alert(result.message);
            await refreshCurrentHash();
            refreshBackupList();
        } else if (result.message.startsWith('NEED_BACKUP_CONFIRM:')) {
            const originalPath = result.message.split(':').slice(1).join(':');
            if (confirm(`当前存档「${originalPath}」未备份，是否需要先备份再恢复？\n\n确定 = 先备份再恢复\n取消 = 直接覆盖恢复`)) {
                const result2 = await invoke('restore_backup', {
                    gameName: selectedGame, slotName: selectedSlot,
                    folderName: folderName, skipBackup: true
                });
                alert(result2.message);
            } else {
                const result2 = await invoke('restore_backup', {
                    gameName: selectedGame, slotName: selectedSlot,
                    folderName: folderName, skipBackup: true
                });
                alert(result2.message);
            }
            await refreshCurrentHash();
            refreshBackupList();
        } else {
            alert('恢复失败: ' + result.message);
        }
    } catch (err) {
        alert('恢复失败: ' + err);
    }
}

async function handleRenameBackup(folderName, currentDesc) {
    const newDesc = prompt('修改备份描述（时间戳不可改）:', currentDesc || '');
    if (newDesc === null) return;
    const result = await invoke('rename_backup', {
        gameName: selectedGame,
        slotName: selectedSlot,
        folderName: folderName,
        newDescription: newDesc.trim()
    });
    if (result.success) { refreshBackupList(); }
    else { alert('重命名失败: ' + result.message); }
}

async function handleDeleteBackup(folderName) {
    if (!confirm('确定要删除此备份吗？此操作不可恢复。')) return;
    setButtonLoading(saveBackupBtn, '删除中...');
    try {
        const result = await invoke('delete_backup', {
            gameName: selectedGame,
            slotName: selectedSlot,
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
            gameName: selectedGame,
            slotName: selectedSlot,
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

settingsSetDirBtn.addEventListener('click', async () => {
    const dir = await invoke('pick_directory');
    if (dir) {
        currentConfig.backup_root = dir;
        await saveConfigToBackend();
        updateSettingsDisplay();
    }
});

function updateSettingsDisplay() {
    if (currentConfig.backup_root) {
        settingsBackupRoot.textContent = currentConfig.backup_root;
        settingsBackupRoot.style.color = 'rgba(255,255,255,0.7)';
    } else {
        settingsBackupRoot.textContent = '未设置';
        settingsBackupRoot.style.color = 'rgba(255,255,255,0.3)';
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
    if (selectedGame && selectedSlot) {
        restoreFilePath();
        refreshCurrentHash();
        refreshBackupList();
    }
}

// ==================== 启动 ====================

resetToCurrentTime();
loadConfig();
