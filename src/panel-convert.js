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
        btn.disabled = true;
        tsInput.value = getCurrentTimestampMs();
        try {
            const response = await invoke('convert_to_datetime', { request: { timestamp_ms: parseInt(tsInput.value, 10), timezone: set.timezone } });
            if (response.success) dtInput.value = formatDatetimeStr(response.datetime_str, set.datetime_format);
        } catch (err) { /* ignore */ }
        btn.disabled = false;
    } else if (action === 'delete-tz') {
        btn.disabled = true;
        const saved = saveTimezoneValues();
        await invoke('remove_timezone_set', { setId });
        currentConfig = await invoke('get_config');
        renderTimezoneSets();
        restoreTimezoneValues(saved);
    } else if (action === 'to-ts') {
        const dtStr = dtInput.value.trim();
        if (!dtStr) return;
        btn.disabled = true;
        try {
            const response = await invoke('convert_to_timestamp', { request: { datetime_str: dtStr, timezone: set.timezone } });
            tsInput.value = response.success ? String(response.timestamp) : 'error';
        } catch (err) {
            tsInput.value = 'error';
        }
        btn.disabled = false;
    } else if (action === 'to-dt') {
        const tsStr = tsInput.value.trim();
        if (!tsStr) return;
        const ts = parseInt(tsStr, 10);
        if (isNaN(ts)) return;
        btn.disabled = true;
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
        btn.disabled = false;
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

