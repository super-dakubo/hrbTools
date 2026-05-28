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
    if (_backupListLock) {
        return;
    }
    _backupListLock = true;
    try {
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
    } finally {
        _backupListLock = false;
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
                    return;
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
    overlay.className = 'modal-overlay dialog-overlay';
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
                    + '<span class="restore-file-path">' + escapeHtml(shortenPath(f.original_path)) + '</span>'
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

