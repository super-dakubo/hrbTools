# Screenshot Toolbar Optimization Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Optimize screenshot panel toolbar — single-row layout, glass-style dropdown with emoji, source-switching animation.

**Architecture:** CSS-only layout fix (`flex-wrap: nowrap` + glass background on select) plus minor JS additions (emoji helper function, rAF animation trigger). No backend changes, no new files.

**Tech Stack:** Pure CSS + vanilla JS (Tauri 2 WebView2)

**Files touched:**
- Modify: `src/styles.css` (lines 1955-1970, ~2000-2010)
- Modify: `src/main.js` (lines 2501-2515 renderToolbar, lines 2608-2630 scanScreenshots)

---

### Task 1: CSS — Force single-row layout & glass dropdown

**Files:**
- Modify: `src/styles.css` lines 1955-1970 (`.ss-toolbar` and `.ss-toolbar select`)
- Modify: `src/styles.css` around lines 2001-2005 (`.ss-grid` add transition)

- [ ] **Step 1: Change `.ss-toolbar` to `flex-wrap: nowrap`**

In `src/styles.css`, find `.ss-toolbar` block (line 1955):

```css
.ss-toolbar {
    display: flex; gap: 8px; align-items: center;
    margin-bottom: 16px; flex-wrap: wrap;
    background: var(--glass-bg); border: 1px solid var(--glass-border);
    border-radius: 12px; padding: 10px 14px;
    backdrop-filter: blur(8px);
}
```

Change `flex-wrap: wrap` → `flex-wrap: nowrap`.

- [ ] **Step 2: Update select background and border-radius**

Find `.ss-toolbar select` block (line 1962):

```css
.ss-toolbar select {
    background: var(--surface); color: var(--text);
    border: 1px solid var(--border); border-radius: 8px;
    padding: 7px 32px 7px 12px; font-size: 13px;
    appearance: none;
    background-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='12' height='12' viewBox='0 0 24 24' fill='none' stroke='%23888' stroke-width='2'%3E%3Cpath d='M6 9l6 6 6-6'/%3E%3C/svg%3E");
    background-repeat: no-repeat; background-position: right 8px center;
    cursor: pointer; min-width: 160px;
}
```

Change:
- `background: var(--surface)` → `background: var(--glass-bg)`
- Add `backdrop-filter: blur(8px)` after the background line
- `border-radius: 8px` → `border-radius: 10px`
- `min-width: 160px` → `min-width: 120px`

Result:

```css
.ss-toolbar select {
    background: var(--glass-bg); color: var(--text);
    backdrop-filter: blur(8px);
    border: 1px solid var(--border); border-radius: 10px;
    padding: 7px 32px 7px 12px; font-size: 13px;
    appearance: none;
    background-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='12' height='12' viewBox='0 0 24 24' fill='none' stroke='%23888' stroke-width='2'%3E%3Cpath d='M6 9l6 6 6-6'/%3E%3C/svg%3E");
    background-repeat: no-repeat; background-position: right 8px center;
    cursor: pointer; min-width: 120px;
}
```

- [ ] **Step 3: Add switching animation CSS for grid**

Find `.ss-grid` block (line ~2001). Add transition property:

```css
.ss-grid {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(200px, 1fr));
    gap: 12px;
    transition: opacity 0.3s ease, transform 0.3s ease;
}
```

Add new `.ss-grid.switching` rule after `.ss-grid`:

```css
.ss-grid.switching {
    opacity: 0;
    transform: translateY(6px);
    transition: none;
}
```

- [ ] **Step 4: Verify CSS changes compile**

Run: `cargo check` (only checks Rust, but CSS is static — visual verification needed after launch)

---

### Task 2: JS — Emoji helper & option rendering

**Files:**
- Modify: `src/main.js` around line 2501 (renderToolbar)
- Add: `_ssEmojiForSource` helper function near other screenshot state vars (after line 16)

- [ ] **Step 1: Add `_ssEmojiForSource` function**

After the screenshot state variables (after `let _ssEntries` around line 15), add:

```javascript
// Emoji mapping for screenshot source options
function _ssEmojiForSource(name, path) {
    var lower = (name + ' ' + path).toLowerCase();
    if (lower.indexOf('genshin') !== -1 || lower.indexOf('原神') !== -1) return '📷';
    if (lower.indexOf('starrail') !== -1 || lower.indexOf('星穹') !== -1) return '🎮';
    if (lower.indexOf('zenless') !== -1 || lower.indexOf('绝区零') !== -1) return '🗺️';
    if (lower.indexOf('steam') !== -1) return '🖥️';
    return '📁';
}
```

- [ ] **Step 2: Update renderToolbar to use emoji**

In `renderToolbar()` function (line 2501), change the options mapping:

From:
```javascript
var options = _ssSources.map(function(s) {
    var selected = s.id === _ssCurrentSourceId ? ' selected' : '';
    return '<option value="' + s.id + '"' + selected + '>' + escapeHtml(s.name) + '</option>';
}).join('');
```

To:
```javascript
var options = _ssSources.map(function(s) {
    var selected = s.id === _ssCurrentSourceId ? ' selected' : '';
    var emoji = _ssEmojiForSource(s.name, s.path);
    return '<option value="' + s.id + '"' + selected + '>' + emoji + ' ' + escapeHtml(s.name) + '</option>';
}).join('');
```

- [ ] **Step 3: Add switching animation in scanScreenshots**

In `scanScreenshots` function (line 2608), find the success callback (line 2609-2617). Add the animation trigger before `renderGrid()`:

```javascript
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

        // Remove switching class after DOM update to trigger transition
        requestAnimationFrame(function() {
            requestAnimationFrame(function() {
                var grid2 = container && container.querySelector('.ss-grid');
                if (grid2) grid2.classList.remove('switching');
            });
        });
    }).catch(function() {
        // ... error handler unchanged
    });
}
```

Also add the same animation in the source-switch handler. In `setupEventDelegation` (around line 3098), find the `ss-select-source` handler:

```javascript
if (action === 'ss-select-source') {
    _ssCurrentSourceId = target.value;
    _ssPage = 0;
    renderScreenshotPanel();
}
```

This already calls `renderScreenshotPanel()` which triggers `scanScreenshots`, so the animation added in `scanScreenshots` will fire automatically.

---

### Task 3: Verify with cargo check

- [ ] **Step 1: Run cargo check**

```bash
cargo check
```

Expected: Compilation succeeds (no Rust changes, so this should be instant).

- [ ] **Step 2: Launch dev and visually verify**

```bash
cargo tauri dev
```

After launch:
1. Open screenshot panel — verify toolbar is single row
2. Switch sources — verify dropdown has emoji prefix and matches glass style
3. Observe fade-in animation on source switch
4. Resize window — verify single row holds at various widths

---

### Scope edges

- If a source name is very long and causes the select to exceed available width: the `min-width: 120px` and `max-width: 200px` (not specified in CSS but browsers auto-clamp) should prevent this. If wrapping still occurs, add `max-width: 200px` to `.ss-toolbar select` and add `text-overflow: ellipsis` to handle truncation.
