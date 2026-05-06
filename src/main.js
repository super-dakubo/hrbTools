import { invoke } from '@tauri-apps/api/core';

// ==================== DOM 引用 ====================

// Tab 切换
const tabs = document.querySelectorAll('.tab');
const panels = document.querySelectorAll('.panel');

// 时间转换面板
const datetimeInput = document.getElementById('datetimeInput');
const timezoneSelect = document.getElementById('timezoneSelect');
const convertBtn = document.getElementById('convertBtn');
const timestampResult = document.getElementById('timestampResult');
const errorMsgDiv = document.getElementById('errorMsg');

// 存档管理面板
const gameSelect = document.getElementById('gameSelect');
const addGameBtn = document.getElementById('addGameBtn');
const filePathInput = document.getElementById('filePath');
const browseFileBtn = document.getElementById('browseFileBtn');
const backupRootDisplay = document.getElementById('backupRootDisplay');
const setBackupDirBtn = document.getElementById('setBackupDirBtn');
const saveBackupBtn = document.getElementById('saveBackupBtn');
const backupError = document.getElementById('backupError');
const backupSuccess = document.getElementById('backupSuccess');
const backupList = document.getElementById('backupList');

// ==================== Tab 切换 ====================

tabs.forEach(tab => {
    tab.addEventListener('click', () => {
        tabs.forEach(t => t.classList.remove('active'));
        panels.forEach(p => p.classList.remove('active'));
        tab.classList.add('active');
        const target = tab.dataset.tab;
        document.getElementById(`panel-${target}`).classList.add('active');
        if (target === 'backup') {
            refreshBackupList();
        }
    });
});

// ==================== 时间转换 ====================

async function convert() {
    errorMsgDiv.style.display = 'none';
    timestampResult.innerText = '转换中...';

    const datetimeStr = datetimeInput.value.trim();
    const timezone = timezoneSelect.value;

    if (!datetimeStr) {
        showConvertError('请输入时间字符串');
        return;
    }

    try {
        const response = await invoke('convert_to_timestamp', {
            request: {
                datetime_str: datetimeStr,
                timezone: timezone
            }
        });

        if (response.success) {
            timestampResult.innerText = response.timestamp;
        } else {
            showConvertError(response.error);
            timestampResult.innerText = '—';
        }
    } catch (err) {
        showConvertError(`调用失败: ${err}`);
        timestampResult.innerText = '—';
    }
}

function showConvertError(msg) {
    errorMsgDiv.innerText = msg;
    errorMsgDiv.style.display = 'block';
}

convertBtn.addEventListener('click', convert);
datetimeInput.addEventListener('keypress', (e) => {
    if (e.key === 'Enter') convert();
});

// ==================== 配置管理 ====================

let currentConfig = { backup_root: '', game_names: [] };

async function loadConfig() {
    currentConfig = await invoke('get_config');
    updateBackupRootDisplay();
    updateGameSelect();
}

async function saveConfig() {
    await invoke('set_config', { config: currentConfig });
}

function updateBackupRootDisplay() {
    if (currentConfig.backup_root) {
        backupRootDisplay.textContent = currentConfig.backup_root;
        backupRootDisplay.style.color = '#374151';
    } else {
        backupRootDisplay.textContent = '未设置';
        backupRootDisplay.style.color = '#9ca3af';
    }
}

// ==================== 游戏管理 ====================

function updateGameSelect() {
    gameSelect.innerHTML = '';
    if (currentConfig.game_names.length === 0) {
        const opt = document.createElement('option');
        opt.value = '';
        opt.textContent = '— 请先新增游戏 —';
        gameSelect.appendChild(opt);
    } else {
        currentConfig.game_names.forEach(name => {
            const opt = document.createElement('option');
            opt.value = name;
            opt.textContent = name;
            gameSelect.appendChild(opt);
        });
    }
    // 恢复之前的选中
    const saved = gameSelect.dataset.selected;
    if (saved && currentConfig.game_names.includes(saved)) {
        gameSelect.value = saved;
    }
}

addGameBtn.addEventListener('click', async () => {
    const name = prompt('输入游戏名称:');
    if (!name || !name.trim()) return;
    const trimmed = name.trim();
    if (currentConfig.game_names.includes(trimmed)) {
        alert('该游戏名已存在');
        return;
    }
    currentConfig.game_names.push(trimmed);
    await saveConfig();
    updateGameSelect();
    gameSelect.value = trimmed;
    gameSelect.dataset.selected = trimmed;
    refreshBackupList();
});

gameSelect.addEventListener('change', () => {
    gameSelect.dataset.selected = gameSelect.value;
    refreshBackupList();
});

// ==================== 文件选择 ====================

browseFileBtn.addEventListener('click', async () => {
    const path = await invoke('pick_file');
    if (path) {
        filePathInput.value = path;
    }
});

// ==================== 备份目录设置 ====================

setBackupDirBtn.addEventListener('click', async () => {
    const dir = await invoke('pick_directory');
    if (dir) {
        currentConfig.backup_root = dir;
        await saveConfig();
        updateBackupRootDisplay();
    }
});

// ==================== 备份操作 ====================

saveBackupBtn.addEventListener('click', async () => {
    hideMessages();
    const gameName = gameSelect.value;
    const filePath = filePathInput.value.trim();

    if (!gameName) {
        showBackupError('请先选择或新增游戏');
        return;
    }
    if (!filePath) {
        showBackupError('请输入或选择存档文件路径');
        return;
    }
    if (!currentConfig.backup_root) {
        showBackupError('请先设置备份目录');
        return;
    }

    saveBackupBtn.disabled = true;
    saveBackupBtn.textContent = '保存中...';

    try {
        const result = await invoke('create_backup', {
            game_name: gameName,
            file_path: filePath
        });
        if (result.success) {
            showBackupSuccess(result.message);
            filePathInput.value = '';
            refreshBackupList();
        } else {
            showBackupError(result.message);
        }
    } catch (err) {
        showBackupError(`备份失败: ${err}`);
    } finally {
        saveBackupBtn.disabled = false;
        saveBackupBtn.textContent = '保存存档';
    }
});

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

// ==================== 存档列表 ====================

async function refreshBackupList() {
    const gameName = gameSelect.value;
    if (!gameName) {
        backupList.innerHTML = '<div class="empty-hint">请先选择游戏</div>';
        return;
    }

    try {
        const backups = await invoke('list_backups', { game_name: gameName });
        if (backups.length === 0) {
            backupList.innerHTML = '<div class="empty-hint">暂无备份</div>';
            return;
        }

        backupList.innerHTML = backups.map(b => `
            <div class="backup-item">
                <span class="name">${escapeHtml(b.display_name)}</span>
                <span class="original-path" title="${escapeHtml(b.original_file_path)}">${escapeHtml(shortenPath(b.original_file_path))}</span>
                <button class="btn-small" onclick="restoreBackup('${escapeHtml(b.folder_name)}')">恢复</button>
                <button class="btn-small" onclick="renameBackup('${escapeHtml(b.folder_name)}', '${escapeHtml(b.display_name)}')">重命名</button>
                <button class="btn-danger" onclick="deleteBackup('${escapeHtml(b.folder_name)}')">删除</button>
            </div>
        `).join('');
    } catch (err) {
        backupList.innerHTML = `<div class="empty-hint">加载失败: ${err}</div>`;
    }
}

// ==================== 备份管理操作 ====================

window.restoreBackup = async function (folderName) {
    const gameName = gameSelect.value;
    if (!confirm('确定要将此备份恢复到原文件位置吗？将覆盖当前文件。')) return;

    try {
        const result = await invoke('restore_backup', {
            game_name: gameName,
            folder_name: folderName
        });
        if (result.success) {
            alert(result.message);
        } else {
            alert('恢复失败: ' + result.message);
        }
    } catch (err) {
        alert('恢复失败: ' + err);
    }
};

window.renameBackup = async function (folderName, currentName) {
    const newName = prompt('输入新名称:', currentName);
    if (!newName || !newName.trim()) return;

    const gameName = gameSelect.value;
    try {
        const result = await invoke('rename_backup', {
            game_name: gameName,
            folder_name: folderName,
            new_name: newName.trim()
        });
        if (result.success) {
            refreshBackupList();
        } else {
            alert('重命名失败: ' + result.message);
        }
    } catch (err) {
        alert('重命名失败: ' + err);
    }
};

window.deleteBackup = async function (folderName) {
    const gameName = gameSelect.value;
    if (!confirm('确定要删除此备份吗？此操作不可恢复。')) return;

    try {
        const result = await invoke('delete_backup', {
            game_name: gameName,
            folder_name: folderName
        });
        if (result.success) {
            refreshBackupList();
        } else {
            alert('删除失败: ' + result.message);
        }
    } catch (err) {
        alert('删除失败: ' + err);
    }
};

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

// ==================== 启动 ====================

loadConfig();
