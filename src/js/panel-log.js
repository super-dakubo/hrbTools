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
    if (logSearch) logSearch.addEventListener('input', function() { clearTimeout(this._t); this._t = setTimeout(renderLogPanel, 100); });
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
