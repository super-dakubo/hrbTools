# 开机自启最小化到托盘 — 修复实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix auto-start behavior so window is hidden on boot (only tray icon shows)

**Architecture:** Two in-place modifications to `src/main.rs`:
- `setup()`: add config reading as fallback for the `--minimized` arg check
- `set_auto_start()`: add error handling for `reg.exe` execution

**Tech Stack:** Rust, Tauri 2.10.3, Windows Registry (reg.exe)

---

### Task 1: setup() — config 直读兜底

**Files:**
- Modify: `src/main.rs:2417-2424`

- [ ] **Step 1: Replace the window visibility logic in setup()**

Current code (lines 2417-2424):
```rust
            // 无 --minimized 参数（手动启动）时显示窗口
            let is_minimized = std::env::args().any(|a| a == "--minimized");
            if !is_minimized {
                if let Some(window) = app.get_webview_window("main") {
                    let _ = window.show();
                    let _ = window.set_focus();
                }
            }
```

Replace with:
```rust
            // Config 直读 + --minimized arg 双保险：任一指示最小化就隐藏窗口
            let is_minimized = std::env::args().any(|a| a == "--minimized");
            let cfg = load_config(app);
            let should_minimize = is_minimized || cfg.auto_start;

            if !should_minimize {
                if let Some(window) = app.get_webview_window("main") {
                    let _ = window.show();
                    let _ = window.set_focus();
                }
            } else {
                if let Some(window) = app.get_webview_window("main") {
                    let _ = window.hide();
                }
            }
```

Key design decisions:
- `load_config` is safe here: it reads `config.json` only, no side effects
- First run (no config file) returns `AppConfig::default()` → `auto_start: false` → manual start unaffected
- `window.hide()` is a no-op if window is already hidden, safe to call unconditionally

- [ ] **Step 2: Verify compilation**

Run: `cd /d/code/hello_world && cargo check 2>&1 | head -30`
Expected: `Compiling hrbTools v0.1.0` + `Finished \`dev\` profile`

---

### Task 2: set_auto_start() — reg.exe 错误处理

**Files:**
- Modify: `src/main.rs:1190-1206`

- [ ] **Step 1: Replace set_auto_start with error handling**

Current code (lines 1190-1206):
```rust
// @Setup Windows 注册表开机自启（reg.exe，仅在 set_config 中调）
fn set_auto_start(enabled: bool) {
    let exe_path = std::env::current_exe().ok();
    let app_name = "HRB Tools";

    if enabled {
        if let Some(path) = exe_path {
            let path_str = format!("\"{}\" --minimized", path.to_string_lossy());
            let _ = std::process::Command::new("reg")
                .args(["add", "HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Run", "/v", app_name, "/t", "REG_SZ", "/d", &path_str, "/f"])
                .output();
        }
    } else {
        let _ = std::process::Command::new("reg")
            .args(["delete", "HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Run", "/v", app_name, "/f"])
            .output();
    }
}
```

Replace with:
```rust
// @Setup Windows 注册表开机自启（reg.exe，仅在 set_config 中调）
fn set_auto_start(enabled: bool) {
    let exe_path = std::env::current_exe().ok();
    let app_name = "HRB Tools";

    if enabled {
        if let Some(path) = exe_path {
            let path_str = format!("\"{}\" --minimized", path.to_string_lossy());
            match std::process::Command::new("reg")
                .args(["add", "HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Run", "/v", app_name, "/t", "REG_SZ", "/d", &path_str, "/f"])
                .output()
            {
                Ok(o) => {
                    if !o.status.success() {
                        eprintln!("[set_auto_start] reg.exe add failed: {}", String::from_utf8_lossy(&o.stderr));
                    }
                }
                Err(e) => {
                    eprintln!("[set_auto_start] reg.exe add error: {}", e);
                }
            }
        }
    } else {
        match std::process::Command::new("reg")
            .args(["delete", "HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Run", "/v", app_name, "/f"])
            .output()
        {
            Ok(o) => {
                if !o.status.success() {
                    eprintln!("[set_auto_start] reg.exe delete failed: {}", String::from_utf8_lossy(&o.stderr));
                }
            }
            Err(e) => {
                eprintln!("[set_auto_start] reg.exe delete error: {}", e);
            }
        }
    }
}
```

Note: `eprintln!` goes to stderr. In a Tauri GUI app on Windows, stderr is typically visible in dev console (`cargo tauri dev`) but silent in production. This is intentional — errors here are for debugging during development.

- [ ] **Step 2: Verify compilation**

Run: `cd /d/code/hello_world && cargo check 2>&1 | head -30`
Expected: `Compiling hrbTools v0.1.0` + `Finished \`dev\` profile`

---

### Task 3: 最终验证和提交

- [ ] **Step 1: cargo check 确保两边改动一起编译通过**

Run: `cd /d/code/hello_world && cargo check 2>&1`
Expected: `Finished \`dev\` profile`

- [ ] **Step 2: git diff 审查改动**

Run: `cd /d/code/hello_world && git diff`
Expected: 只显示两个函数改动，无意外变更

- [ ] **Step 3: 提交**

```bash
cd /d/code/hello_world
git add src/main.rs
git commit -m "$(cat <<'EOF'
fix: auto-start no longer shows window on boot

Two changes for robust minimization at startup:
1. setup() now reads config.auto_start as fallback — even if
   --minimized arg is not passed, the window stays hidden when
   auto_start is enabled.
2. set_auto_start() now checks reg.exe exit status and logs
   failures via eprintln, replacing the silent let _ = pattern.

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>
EOF
)"
```
