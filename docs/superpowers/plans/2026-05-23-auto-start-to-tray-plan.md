# 自动启动合并到托盘展示 — 实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 将 auto_start 作为唯一开关，删除冗余的 minimize_to_tray 字段及相关 UI。

**Architecture:** 纯删除改动——Rust 结构体移除字段、HTML 移除开关行、JS 移除引用和事件绑定。同时更新 CLAUDE.md 和 ARCHITECTURE.md 中的相关文档引用。

**Tech Stack:** Rust (Tauri 2.0) + 原生 HTML/CSS/JS

---

### Task 1: 从 Rust AppConfig 移除 minimize_to_tray

**Files:**
- Modify: `src/main.rs:196`（struct 字段）
- Modify: `src/main.rs:262`（Default 实现）

- [ ] **Step 1: 删除 struct 字段**

```rust
// 删除第 195-196 行：
//     #[serde(default)]
//     minimize_to_tray: bool,
```

Edit: 删除 `src/main.rs` 第 195-196 行（`#[serde(default)]` 和 `minimize_to_tray: bool,`）。

- [ ] **Step 2: 删除 Default 实现中的字段初始化**

```rust
// 删除第 262 行：
//             minimize_to_tray: true,
```

Edit: 删除 `src/main.rs` 第 262 行（`minimize_to_tray: true,`）。

- [ ] **Step 3: cargo check 验证编译通过**

Run: `cargo check`
Expected: 编译成功，无 warning。

- [ ] **Step 4: Commit**

```bash
git add src/main.rs
git commit -m "refactor: remove minimize_to_tray field from AppConfig

auto_start is now the sole toggle — enabling it always starts to tray.
The minimize_to_tray field was redundant since window_minimize always
hides to tray regardless of the setting.

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>"
```

---

### Task 2: 从 HTML 移除托盘开关

**Files:**
- Modify: `src/index.html:184-187`

- [ ] **Step 1: 删除「最小化到托盘」开关行**

Edit: 删除 `src/index.html` 第 184-187 行：
```html
                        <div class="row" style="justify-content:space-between;margin-top:8px;">
                            <label style="margin:0;">最小化到托盘</label>
                            <span class="toggle-switch" id="trayToggle" data-state="on"><span class="toggle-thumb"></span></span>
                        </div>
```

删除后第 188 行（「启用提醒」行）的 `margin-top:8px;` 会自动与 autoStartToggle 行相邻，保持间距一致。

- [ ] **Step 2: Commit**

```bash
git add src/index.html
git commit -m "refactor(ui): remove minimize-to-tray toggle from settings panel

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>"
```

---

### Task 3: 从 JS 移除托盘开关逻辑

**Files:**
- Modify: `src/main.js:53`（变量声明）
- Modify: `src/main.js:1179-1184`（事件绑定）
- Modify: `src/main.js:1239-1241`（状态同步）

- [ ] **Step 1: 删除 trayToggle DOM 查询**

Edit: 删除 `src/main.js` 第 53 行（`const trayToggle = document.getElementById('trayToggle');`）。

- [ ] **Step 2: 删除 trayToggle 事件监听器**

Edit: 删除 `src/main.js` 第 1179-1184 行：
```js
// 托盘开关
trayToggle.addEventListener('click', function() {
    currentConfig.minimize_to_tray = !currentConfig.minimize_to_tray;
    updateSettingsDisplay();
    saveConfigToBackend();
});
```

- [ ] **Step 3: 从 updateSettingsDisplay 删除 trayToggle 状态同步**

Edit: 删除 `src/main.js` 第 1239-1241 行：
```js
    if (trayToggle) {
        trayToggle.dataset.state = currentConfig.minimize_to_tray ? 'on' : 'off';
    }
```

验证：确保删除后 `updateSettingsDisplay()` 中 `autoStartToggle` 和 `reminderToggle` 的代码块保持完整、缩进正确。

- [ ] **Step 4: 验证无残留引用**

Run: `grep -n "trayToggle\|minimize_to_tray" src/main.js`
Expected: 无匹配输出。

- [ ] **Step 5: Commit**

```bash
git add src/main.js
git commit -m "refactor(js): remove trayToggle references and event handler

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>"
```

---

### Task 4: 更新文档

**Files:**
- Modify: `CLAUDE.md:64`（AppConfig struct 速查）
- Modify: `CLAUDE.md:201`（minimize_to_tray 控制说明）
- Modify: `docs/ARCHITECTURE.md:109`（struct 字段文档）
- Modify: `docs/ARCHITECTURE.md:606`（行为说明）

- [ ] **Step 1: 更新 CLAUDE.md AppConfig 速查**

Edit: `CLAUDE.md:64` — 从 `AppConfig { ... auto_start, minimize_to_tray, reminder_enabled }` 中删除 `minimize_to_tray,`。

- [ ] **Step 2: 更新 CLAUDE.md 窗口说明**

Edit: `CLAUDE.md:201` — 将 `config.minimize_to_tray` 控制开关 更新为说明「最小化始终隐藏到托盘（开机自启到托盘由 auto_start 控制）」。

- [ ] **Step 3: 更新 ARCHITECTURE.md struct 字段**

Edit: `docs/ARCHITECTURE.md:109` — 删除 `minimize_to_tray: bool,` 行及其注释。

- [ ] **Step 4: 更新 ARCHITECTURE.md 行为说明**

Edit: `docs/ARCHITECTURE.md:606` — 将 `config.minimize_to_tray` 相关说明更新为「最小化按钮始终隐藏窗口到托盘（auto_start 开启时开机自启到托盘）」。

- [ ] **Step 5: 提交文档更新**

```bash
git add CLAUDE.md docs/ARCHITECTURE.md
git commit -m "docs: update references after removing minimize_to_tray

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>"
```
