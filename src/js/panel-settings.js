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

    editor.style.display = 'flex';
    editor.innerHTML = ''
        + '<div class="modal" style="width:520px;">'
        + '<div class="modal-header">'
        + '<span class="modal-title">' + year + '年 节假日配置</span>'
        + '<div style="display:flex;gap:6px;">'
        + '<button class="btn-small" id="holidayCopyTemplate">复制模板</button>'
        + '<button class="modal-close" id="holidayCancelBtn">&times;</button>'
        + '</div>'
        + '</div>'
        + '<div class="modal-body">'
        + '<textarea id="holidayJsonInput" class="holiday-json-input" placeholder="编辑 JSON 配置">'
        + escapeHtml(defaultText) + '</textarea>'
        + '<div id="holidayPreview" style="margin-top:12px;"></div>'
        + '<div style="margin-top:12px;display:flex;gap:8px;">'
        + '<button class="btn-small btn-primary" id="holidaySaveBtn" style="display:none;">确认保存</button>'
        + '</div>'
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

