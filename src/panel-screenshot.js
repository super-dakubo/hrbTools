// ==================== 截图面板 ====================

function renderScreenshotPanel() {
    var wrapper = document.getElementById('screenshotApp');
    if (!wrapper) return;

    if (currentConfig.screenshot_sources) {
        _ssSources = currentConfig.screenshot_sources;
    }

    // No sources → empty state
    if (!_ssSources.length) {
        wrapper.innerHTML =
            '<div class="ss-empty">'
            + '<div class="ss-empty-icon">📷</div>'
            + '<p>还没有添加截图来源</p>'
            + '<button class="btn btn-primary" data-action="ss-add-source">添加第一个来源</button>'
            + '<div class="ss-empty-sub">支持 Steam、原神、星穹铁道、绝区零截图目录</div>'
            + '</div>';
        return;
    }

    // Select first source if none selected
    if (!_ssCurrentSourceId || !_ssSources.some(function(s) { return s.id === _ssCurrentSourceId; })) {
        _ssCurrentSourceId = _ssSources[0].id;
    }

    var currentSource = _ssSources.find(function(s) { return s.id === _ssCurrentSourceId; });
    if (!currentSource) { wrapper.innerHTML = ''; return; }

    // Build toolbar + content containers on first render
    var toolbar = wrapper.querySelector('#ssToolbar');
    if (!toolbar) {
        wrapper.innerHTML = '<div id="ssToolbar"></div><div id="ssContent"></div>';
    }

    // Re-render toolbar only when sources list changed (add/remove) vs just switching
    var needsToolbarRender = !toolbar || toolbar.querySelectorAll('option').length !== _ssSources.length;
    if (needsToolbarRender) {
        renderToolbar();
    } else {
        var select = toolbar.querySelector('select');
        if (select) select.value = _ssCurrentSourceId;
    }

    // Check cache (30 second TTL)
    var cached = _ssCache[_ssCurrentSourceId];
    var now = Date.now();
    if (!cached || now - cached.fetchedAt > 30000) {
        renderSkeleton();
        scanScreenshots(currentSource);
        return;
    }

    _ssEntries = cached.entries;
    renderGrid();
}

function renderToolbar() {
    var toolbar = document.getElementById('ssToolbar');
    if (!toolbar) return;
    var options = _ssSources.map(function(s) {
        var selected = s.id === _ssCurrentSourceId ? ' selected' : '';
        return '<option value="' + s.id + '"' + selected + '>' + escapeHtml(s.name) + '</option>';
    }).join('');

    toolbar.innerHTML = '<div class="ss-toolbar">'
        + '<select data-action="ss-select-source">' + options + '</select>'
        + '<input type="search" placeholder="搜索截图文件名..." value="' + escapeHtml(_ssSearchQuery) + '" data-action="ss-search">'
        + '<button class="btn btn-primary" data-action="ss-add-source">+ 添加</button>'
        + '<button class="btn btn-ghost" data-action="ss-refresh">🔄</button>'
        + '</div>';
}

function renderSkeleton() {
    var content = document.getElementById('ssContent');
    if (!content) return;
    var cards = '';
    for (var i = 0; i < 6; i++) {
        cards += '<div class="ss-card ss-skeleton"><div class="ss-thumb-placeholder"></div><div class="ss-info"></div></div>';
    }
    content.innerHTML = '<div class="ss-grid-container"><div class="ss-grid">' + cards + '</div></div>';
}

function renderGrid() {
    var content = document.getElementById('ssContent');
    if (!content) return;

    // Filter by search query
    var filtered = _ssEntries;
    if (_ssSearchQuery) {
        var q = _ssSearchQuery.toLowerCase();
        filtered = _ssEntries.filter(function(e) {
            return e.file_name.toLowerCase().indexOf(q) !== -1;
        });
    }

    var totalPages = Math.max(1, Math.ceil(filtered.length / _ssPageSize));
    if (_ssPage >= totalPages) _ssPage = 0;
    var start = _ssPage * _ssPageSize;
    var pageItems = filtered.slice(start, start + _ssPageSize);

    // Pagination HTML
    var paginationHtml = '<div class="ss-pagination">'
        + '<span>第 ' + (_ssPage + 1) + ' 页，共 ' + totalPages + ' 页（' + filtered.length + ' 张）</span>'
        + '<button class="btn-small" data-action="ss-prev-page"' + (_ssPage <= 0 ? ' disabled' : '') + '>‹ 上一页</button>'
        + '<button class="btn-small" data-action="ss-next-page"' + (_ssPage >= totalPages - 1 ? ' disabled' : '') + '>下一页 ›</button>'
        + '</div>';

    // No matches
    if (pageItems.length === 0) {
        content.innerHTML = paginationHtml + '<div class="ss-empty"><p>没有找到匹配的截图</p></div>';
        return;
    }

    var cards = pageItems.map(function(entry, idx) {
        var absIdx = start + idx;
        var tagHtml = entry.game_name
            ? '<span class="ss-game-tag">' + escapeHtml(entry.game_name) + '</span>'
            : '';
        return '<div class="ss-card" data-action="ss-open" data-index="' + absIdx + '">'
            + tagHtml
            + '<div class="ss-thumb-wrap"><div class="ss-thumb-placeholder">⏳</div></div>'
            + '<div class="ss-hover-actions">'
            + '<button class="ss-folder" data-action="ss-open-folder" data-path="' + escapeHtml(entry.path) + '" title="打开所在文件夹">📂</button>'
            + '<button class="ss-del" data-action="ss-delete-file" data-path="' + escapeHtml(entry.path) + '" data-name="' + escapeHtml(entry.file_name) + '" title="删除">🗑</button>'
            + '</div>'
            + '<div class="ss-info">'
            + '<span class="ss-name">' + escapeHtml(entry.file_name) + '</span>'
            + '<span class="ss-date">' + escapeHtml(entry.modified.substring(5, 10)) + '</span>'
            + '</div>'
            + '</div>';
    }).join('');

    content.innerHTML = paginationHtml + '<div class="ss-grid-container"><div class="ss-grid">' + cards + '</div></div>';

    // Load thumbnails after rendering
    loadThumbnails(pageItems, content, start);
}

function loadThumbnails(pageItems, wrapper, start) {
    var paths = pageItems.map(function(e) { return e.path; });
    invoke('get_screenshot_base64_batch', { paths: paths }).then(function(dataUris) {
        var cards = wrapper.querySelectorAll('.ss-card');
        dataUris.forEach(function(uri, i) {
            var card = cards[i];
            if (!card || !uri) return;
            var wrap = card.querySelector('.ss-thumb-wrap');
            if (!wrap) return;
            var placeholder = wrap.querySelector('.ss-thumb-placeholder');
            if (placeholder) {
                var img = document.createElement('img');
                img.className = 'ss-thumb';
                img.src = uri;
                img.decoding = 'async';
                img.loading = 'lazy';
                img.alt = pageItems[i].file_name;
                img.addEventListener('load', function() { this.classList.add('loaded'); });
                if (img.complete) img.classList.add('loaded');
                wrap.replaceChild(img, placeholder);
            }
        });
    });
}

function scanScreenshots(source) {
    invoke('scan_screenshots', { sourcePath: source.path }).then(function(entries) {
        entries.forEach(function(e) {
            e.source_id = source.id;
            e.game_name = source.game_id ? getGameName(source.game_id) : null;
        });
        _ssCache[_ssCurrentSourceId] = { entries: entries, fetchedAt: Date.now() };
        _ssEntries = entries;
        _ssPage = 0;

        // Trigger fade-in animation
        var container = document.querySelector('.ss-grid-container');
        if (container) {
            var grid = container.querySelector('.ss-grid');
            if (grid) grid.classList.add('switching');
        }

        renderGrid();

        requestAnimationFrame(function() {
            requestAnimationFrame(function() {
                if (container) {
                    var g = container.querySelector('.ss-grid');
                    if (g) g.classList.remove('switching');
                }
            });
        });
    }).catch(function() {
        var wrapper = document.getElementById('screenshotApp');
        if (wrapper) {
            var toolbar = wrapper.querySelector('#ssToolbar');
            if (!toolbar) {
                wrapper.innerHTML = '<div id="ssToolbar"></div><div id="ssContent"></div>';
            }
            renderToolbar();
            var content = document.getElementById('ssContent');
            if (content) content.innerHTML = '<div class="ss-empty"><p>⚠️ 无法读取目录，请检查路径是否存在</p></div>';
        }
    });
}

function getGameName(gameId) {
    if (!currentConfig.games) return null;
    var game = currentConfig.games.find(function(g) { return g.id === gameId; });
    return game ? game.name : null;
}

// ─── Lightbox ───

function openLightbox(index) {
    if (!_ssEntries || index < 0 || index >= _ssEntries.length) return;
    _ssLbIndex = index;
    var entry = _ssEntries[index];

    var lb = document.getElementById('ssLightbox');
    if (!lb) {
        lb = document.createElement('div');
        lb.id = 'ssLightbox';
        lb.className = 'ss-lightbox';
        lb.innerHTML = '<button class="ss-lb-close">✕</button>'
            + '<button class="ss-lb-nav ss-lb-prev">‹</button>'
            + '<button class="ss-lb-nav ss-lb-next">›</button>'
            + '<img class="ss-lb-image" id="ssLbImg" alt="">'
            + '<div class="ss-lb-footer" id="ssLbFooter"></div>';
        lb.querySelector('.ss-lb-close').addEventListener('click', closeLightbox);
        lb.querySelector('.ss-lb-prev').addEventListener('click', function() { navigateLightbox(-1); });
        lb.querySelector('.ss-lb-next').addEventListener('click', function() { navigateLightbox(1); });
        lb.addEventListener('click', function(e) {
            if (e.target === lb) closeLightbox();
        });
        document.body.appendChild(lb);
    }

    var img = document.getElementById('ssLbImg');
    img.style.display = 'none';
    lb.classList.add('open');

    invoke('get_screenshot_base64_batch', { paths: [entry.path] }).then(function(dataUris) {
        if (dataUris[0]) {
            img.src = dataUris[0];
            img.classList.remove('loaded');
            img.addEventListener('load', function() { this.classList.add('loaded'); }, { once: true });
            if (img.complete) img.classList.add('loaded');
            img.style.display = '';
        }
    });

    updateLightboxFooter();
}

function closeLightbox() {
    var lb = document.getElementById('ssLightbox');
    if (lb) {
        lb.classList.remove('open');
        _ssLbIndex = -1;
    }
}

function navigateLightbox(dir) {
    var newIdx = _ssLbIndex + dir;
    if (newIdx < 0 || newIdx >= _ssEntries.length) return;
    openLightbox(newIdx);
}

function updateLightboxFooter() {
    var footer = document.getElementById('ssLbFooter');
    if (footer) {
        footer.textContent = (_ssLbIndex + 1) + ' / ' + _ssEntries.length + ' 张';
    }
}

// ─── Add Source Dialog ───

function openAddSourceDialog() {
    var existing = document.getElementById('ssAddDialog');
    if (existing) { existing.classList.add('open'); return; }

    var dialog = document.createElement('div');
    dialog.id = 'ssAddDialog';
    dialog.className = 'ss-add-dialog dialog-overlay';
    dialog.innerHTML = '<div class="ss-dialog-box dialog-box">'
        + '<div class="ss-dialog-header">'
            + '<span class="ss-dialog-header-icon">📁</span>'
            + '<span class="ss-dialog-header-title">添加截图来源</span>'
            + '<button class="ss-dialog-header-close" id="ssCloseBtn">&times;</button>'
        + '</div>'
        + '<div class="ss-dialog-card">'
            + '<div class="ss-dialog-card-hd">✏️ 手动添加</div>'
            + '<div class="ss-dialog-field">'
                + '<label>来源名称 <span class="ss-field-opt">可选</span></label>'
                + '<input type="text" id="ssSourceNameInput" placeholder="留空则使用文件夹名...">'
            + '</div>'
            + '<button class="btn btn-primary" id="ssBrowseBtn" style="margin-top:2px">📁 选择文件夹</button>'
        + '</div>'
        + '<div class="ss-dialog-divider"><span>或</span></div>'
        + '<div class="ss-dialog-card" id="ssDetectedSection">'
            + '<div class="ss-dialog-card-hd">🔍 快速添加</div>'
            + '<div id="ssDetectedBody"><p class="ss-dialog-muted">正在检测...</p></div>'
        + '</div>'
        + '<div class="ss-dialog-actions">'
            + '<button class="btn btn-ghost" id="ssCancelBtn">取消</button>'
        + '</div>'
    + '</div>';

    dialog.querySelector('#ssCloseBtn').addEventListener('click', function() { dialog.classList.remove('open'); });
    dialog.querySelector('#ssCancelBtn').addEventListener('click', function() { dialog.classList.remove('open'); });

    dialog.querySelector('#ssBrowseBtn').addEventListener('click', function() {
        var nameInput = document.getElementById('ssSourceNameInput');
        var customName = nameInput ? nameInput.value.trim() : '';
        invoke('pick_directory').then(function(dir) {
            if (dir) {
                var name = customName || (dir.split(/[/\\]/).pop() || '截图');
                invoke('add_screenshot_source', { name: name, path: dir, gameId: null }).then(function(res) {
                    if (res.success) {
                        refreshScreenshotConfig();
                        dialog.classList.remove('open');
                    } else {
                        alert('添加失败: ' + res.message);
                    }
                });
            }
        });
    });

    dialog.addEventListener('click', function(e) {
        if (e.target === dialog) dialog.classList.remove('open');
    });

    document.body.appendChild(dialog);
    dialog.classList.add('open');

    invoke('detect_screenshot_sources').then(function(sources) {
        var body = document.getElementById('ssDetectedBody');
        if (!body) return;
        if (!sources || sources.length === 0) {
            body.innerHTML = '<p class="ss-dialog-muted">未检测到已知截图来源，请使用浏览按钮手动添加</p>';
            return;
        }

        var html = '<div class="ss-detect-list">';
        sources.forEach(function(s, i) {
            html += '<label class="ss-detected-item">'
                + '<input type="checkbox" class="ss-source-checkbox" data-index="' + i + '" checked>'
                + '<span>' + escapeHtml(s.name) + '</span>'
                + '<span class="ss-count">' + s.count + ' 张</span>'
                + '</label>';
        });
        html += '</div>';

        window._ssDetectedSources = sources;

        html += '<button class="btn btn-primary" id="ssAddDetectedBtn" style="margin-top:10px">添加所选</button>';
        body.innerHTML = html;

        var addBtn = document.getElementById('ssAddDetectedBtn');
        if (addBtn) {
            addBtn.addEventListener('click', function() { addDetectedSources(dialog); });
        }
    }).catch(function() {
        var body = document.getElementById('ssDetectedBody');
        if (body) {
            body.innerHTML = '<p class="ss-dialog-muted">检测失败，请使用浏览按钮手动添加</p>';
        }
    });
}

function closeAddDialog() {
    var dialog = document.getElementById('ssAddDialog');
    if (dialog) dialog.classList.remove('open');
}

function addDetectedSources(dialog) {
    var sources = window._ssDetectedSources || [];
    var checks = dialog.querySelectorAll('.ss-source-checkbox:checked');
    var promises = [];

    checks.forEach(function(cb) {
        var idx = parseInt(cb.dataset.index);
        var src = sources[idx];
        if (!src) return;
        promises.push(invoke('add_screenshot_source', { name: src.name, path: src.path, gameId: null }));
    });

    if (promises.length > 0) {
        Promise.all(promises).then(function() {
            refreshScreenshotConfig();
            dialog.classList.remove('open');
        });
    }
}

function refreshScreenshotConfig() {
    invoke('get_config').then(function(config) {
        currentConfig = config;
        _ssSources = config.screenshot_sources || [];
        renderScreenshotPanel();
    });
}

