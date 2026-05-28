// ==================== 横幅通知系统 ====================

var _notificationTimers = {};

var DISMISS_TIMES = {
    Success: 30000,
    Info: 300000,
    Warning: 7200000,
    Error: Infinity,
};

function pushNotification(level, source, title, message) {
    var banner = {
        id: 'notif_' + Date.now() + '_' + Math.random().toString(36).slice(2, 8),
        level: level,
        source: source,
        title: title,
        message: message || '',
        created_at: Date.now(),
        auto_dismiss: level !== 'Error',
        read: false,
    };
    currentConfig.banners = currentConfig.banners || [];
    currentConfig.banners.push(banner);
    saveConfigToBackend();
    renderBanners();
    return banner.id;
}

function startDismissTimer(banner) {
    if (!banner.auto_dismiss) return;
    var timeoutMs = DISMISS_TIMES[banner.level] || 300000;
    if (_notificationTimers[banner.id]) clearTimeout(_notificationTimers[banner.id]);
    _notificationTimers[banner.id] = setTimeout(function() {
        dismissNotification(banner.id);
    }, timeoutMs);
}

function dismissNotification(bannerId) {
    currentConfig.banners = (currentConfig.banners || []).filter(function(b) { return b.id !== bannerId; });
    delete _notificationTimers[bannerId];
    saveConfigToBackend();
    renderBanners();
}

function clearAllTimers() {
    Object.keys(_notificationTimers).forEach(function(id) {
        clearTimeout(_notificationTimers[id]);
    });
    _notificationTimers = {};
}

function renderBanners() {
    var banners = currentConfig.banners || [];
    var container = document.getElementById('bannerArea');
    if (!container) return;

    // 清理已消失横幅的定时器
    var activeIds = {};
    banners.forEach(function(b) { activeIds[b.id] = true; });
    Object.keys(_notificationTimers).forEach(function(id) {
        if (!activeIds[id]) {
            clearTimeout(_notificationTimers[id]);
            delete _notificationTimers[id];
        }
    });

    // 移除已超时的 auto_dismiss 横幅
    var now = Date.now();
    var changed = false;
    banners = banners.filter(function(b) {
        if (!b.auto_dismiss) return true;
        if (b.level === 'Success' && now - b.created_at > 30000) { changed = true; return false; }
        if (b.level === 'Info' && now - b.created_at > 300000) { changed = true; return false; }
        if (b.level === 'Warning' && now - b.created_at > 7200000) { changed = true; return false; }
        return true;
    });
    if (changed) {
        currentConfig.banners = banners;
        saveConfigToBackend();
    }

    // 去重合并：同 source + 同 title 合并
    var merged = {};
    banners.forEach(function(b) {
        var key = b.source + '|' + b.title;
        if (merged[key]) {
            merged[key].count = (merged[key].count || 1) + 1;
        } else {
            merged[key] = { banner: b, count: 1 };
        }
    });
    var deduped = [];
    for (var k in merged) { deduped.push(merged[k]); }

    // 最多显示 3 条 Toast
    var maxShow = 3;
    var visible = deduped.slice(0, maxShow);
    var hiddenCount = deduped.length - maxShow;

    container.innerHTML = '';
    if (deduped.length === 0) {
        container.style.display = 'none';
        return;
    }
    container.style.display = 'flex';

    // 超出 3 条的汇总提示
    if (hiddenCount > 0) {
        var summary = document.createElement('div');
        summary.className = 'toast-summary';
        summary.textContent = '还有 ' + hiddenCount + ' 条通知';
        summary.addEventListener('click', function() {
            var bell = document.getElementById('notificationBell');
            if (bell) bell.click();
        });
        container.appendChild(summary);
    }

    visible.forEach(function(item) {
        var b = item.banner;
        var el = document.createElement('div');
        el.className = 'toast-item toast-' + b.level.toLowerCase();
        el.dataset.bannerId = b.id;

        // 来源标签
        var sourceBadge = document.createElement('span');
        sourceBadge.className = 'toast-source';
        sourceBadge.textContent = b.source;
        el.appendChild(sourceBadge);

        // 标题
        var titleEl = document.createElement('span');
        titleEl.className = 'toast-title';
        titleEl.textContent = b.title + (item.count > 1 ? ' (×' + item.count + ')' : '');
        el.appendChild(titleEl);

        // 关闭按钮
        var closeBtn = document.createElement('button');
        closeBtn.className = 'toast-close';
        closeBtn.innerHTML = '&times;';
        closeBtn.addEventListener('click', function(e) {
            e.stopPropagation();
            dismissNotification(b.id);
        });
        el.appendChild(closeBtn);

        // 自动消失倒计时提示
        if (b.auto_dismiss && b.level !== 'Error') {
            var timeEl = document.createElement('div');
            timeEl.className = 'toast-timer';
            var remaining = getRemainingSec(b);
            if (remaining > 0) {
                timeEl.textContent = remaining + ' 秒后自动消失';
            }
            el.appendChild(timeEl);
        }

        // hover 暂停倒计时
        el.addEventListener('mouseenter', function() {
            if (_notificationTimers[b.id]) {
                clearTimeout(_notificationTimers[b.id]);
                delete _notificationTimers[b.id];
            }
        });
        el.addEventListener('mouseleave', function() {
            startDismissTimer(b);
        });

        container.appendChild(el);

        // 新通知启动定时器
        if (!_notificationTimers[b.id]) {
            startDismissTimer(b);
        }
    });
    updateBellBadge();
}

function getRemainingSec(banner) {
    var timeoutMs = DISMISS_TIMES[banner.level] || 300000;
    var elapsed = Date.now() - banner.created_at;
    var remaining = Math.max(0, Math.ceil((timeoutMs - elapsed) / 1000));
    return remaining;
}

function renderNotificationCenter() {
    var old = document.getElementById('notificationCenter');
    if (old) old.remove();

    var banners = currentConfig.banners || [];
    var sorted = banners.slice().sort(function(a, b) { return b.created_at - a.created_at; });

    var panel = document.createElement('div');
    panel.id = 'notificationCenter';
    panel.className = 'notif-center open';

    // 根据铃铛按钮位置动态定位
    var bell = document.getElementById('notificationBell');
    if (bell) {
        var rect = bell.getBoundingClientRect();
        panel.style.top = (rect.bottom + 4) + 'px';
        panel.style.right = (window.innerWidth - rect.right) + 'px';
    }

    // 头部
    var header = document.createElement('div');
    header.className = 'notif-center-header';
    header.textContent = '通知中心';
    panel.appendChild(header);

    // 列表
    var list = document.createElement('div');
    list.className = 'notif-center-list';
    if (sorted.length === 0) {
        list.innerHTML = '<div class="notif-empty">暂无通知</div>';
    } else {
        sorted.forEach(function(b) {
            var item = document.createElement('div');
            item.className = 'notif-item' + (b.read ? ' read' : '');
            item.innerHTML = '<span class="notif-item-source">' + escapeHtml(b.source) + '</span>'
                + '<span class="notif-item-title">' + escapeHtml(b.title) + '</span>'
                + '<span class="notif-item-time">' + formatRelativeTime(b.created_at) + '</span>'
                + '<button class="notif-item-close" data-banner-id="' + escapeHtml(b.id) + '">✕</button>';
            list.appendChild(item);
        });
    }
    panel.appendChild(list);

    document.body.appendChild(panel);

    // 单个关闭
    panel.querySelectorAll('.notif-item-close').forEach(function(btn) {
        btn.addEventListener('click', function(e) {
            e.stopPropagation();
            var id = this.dataset.bannerId;
            dismissNotification(id);
            var itemEl = this.closest('.notif-item');
            if (itemEl) {
                itemEl.classList.add('removing');
            }
            setTimeout(function() {
                var p = document.getElementById('notificationCenter');
                if (p) { renderNotificationCenter(); }
                renderBanners();
            }, 200);
        });
    });

    // 点击外部关闭
    setTimeout(function() {
        function closeNotif(e) {
            var notif = document.getElementById('notificationCenter');
            var bell = document.getElementById('notificationBell');
            if (!notif) { document.removeEventListener('click', closeNotif); return; }
            if (!notif.contains(e.target) && e.target !== bell) {
                notif.classList.remove('open');
                setTimeout(function() {
                    if (notif && !notif.classList.contains('open')) notif.remove();
                }, 200);
                document.removeEventListener('click', closeNotif);
            }
        }
        document.addEventListener('click', closeNotif);
    }, 0);
}

function formatRelativeTime(ts) {
    var diff = Date.now() - ts;
    if (diff < 60000) return '刚刚';
    if (diff < 3600000) return Math.floor(diff / 60000) + ' 分钟前';
    if (diff < 86400000) return Math.floor(diff / 3600000) + ' 小时前';
    return Math.floor(diff / 86400000) + ' 天前';
}

function updateBellBadge() {
    var bell = document.getElementById('notificationBell');
    if (!bell) return;
    bell.innerHTML = '<span class="bell-icon">🔔</span>';
}

