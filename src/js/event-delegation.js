// ==================== 事件委托（一次性设置，替代每次渲染后重新绑定） ====================

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

    // ─── 截图面板 ───
    var ssPanel = document.getElementById('panel-screenshot');
    if (ssPanel) {
        ssPanel.addEventListener('click', function(e) {
            var target = e.target.closest('[data-action]');
            if (!target) return;
            var action = target.dataset.action;

            if (action === 'ss-select-source') {
                _ssCurrentSourceId = target.value;
                _ssPage = 0;
                renderScreenshotPanel();
            }
            else if (action === 'ss-search') {
                var value = target.value;
                clearTimeout(_ssSearchTimer);
                _ssSearchTimer = setTimeout(function() {
                    _ssSearchQuery = value;
                    _ssPage = 0;
                    renderScreenshotPanel();
                }, 300);
            }
            else if (action === 'ss-refresh') {
                delete _ssCache[_ssCurrentSourceId];
                _ssPage = 0;
                renderScreenshotPanel();
            }
            else if (action === 'ss-add-source') {
                openAddSourceDialog();
            }
            else if (action === 'ss-prev-page') {
                if (_ssPage > 0) { _ssPage--; renderScreenshotPanel(); }
            }
            else if (action === 'ss-next-page') {
                var totalPages = Math.ceil(_ssEntries.length / _ssPageSize);
                if (_ssPage < totalPages - 1) { _ssPage++; renderScreenshotPanel(); }
            }
            else if (action === 'ss-open') {
                var idx = parseInt(target.dataset.index);
                openLightbox(idx);
            }
            else if (action === 'ss-open-folder') {
                var path = target.dataset.path;
                invoke('open_folder', { path: path });
            }
            else if (action === 'ss-delete-file') {
                var path = target.dataset.path;
                var name = target.dataset.name;
                if (confirm('确定删除截图 "' + name + '"？')) {
                    invoke('delete_screenshot', { path: path }).then(function(res) {
                        if (res.success) {
                            var cached = _ssCache[_ssCurrentSourceId];
                            if (cached) {
                                cached.entries = cached.entries.filter(function(e) { return e.path !== path; });
                            }
                            renderScreenshotPanel();
                        } else {
                            alert('删除失败: ' + res.message);
                        }
                    });
                }
            }
            else if (action === 'ss-lb-close' || action === 'ss-close-dialog') {
                closeLightbox();
                closeAddDialog();
            }
            else if (action === 'ss-lb-prev') {
                navigateLightbox(-1);
            }
            else if (action === 'ss-lb-next') {
                navigateLightbox(1);
            }
            else if (action === 'ss-pick-folder') {
                invoke('pick_directory').then(function(dir) {
                    if (dir) {
                        var name = dir.split(/[/\\]/).pop() || '截图';
                        invoke('add_screenshot_source', { name: name, path: dir, gameId: null }).then(function(res) {
                            if (res.success) {
                                refreshScreenshotConfig();
                            } else {
                                alert('添加失败: ' + res.message);
                            }
                        });
                    }
                });
            }
            else if (action === 'ss-add-detected') {
                addDetectedSources();
            }
        });
    }
}

// ─── 截图 Lightbox 键盘导航 ───
document.addEventListener('keydown', function(e) {
    var lb = document.getElementById('ssLightbox');
    if (!lb || !lb.classList.contains('open')) return;
    if (e.key === 'Escape') { closeLightbox(); }
    else if (e.key === 'ArrowLeft') { e.preventDefault(); navigateLightbox(-1); }
    else if (e.key === 'ArrowRight') { e.preventDefault(); navigateLightbox(1); }
});

