# 开机自启最小化到托盘 — 修复设计

## 背景

上一个迭代移除了冗余的 `minimize_to_tray` 字段，将 `auto_start` 作为唯一开关。
开机自启通过 `reg.exe` 写入注册表 Run 键，值中附带 `--minimized` 参数，
`setup()` 检查该参数决定是否显示窗口。

**用户反馈：** 虽然设置中开启了 `auto_start`，但重启电脑后窗口仍然弹出。

## 根因分析

当前链路：

```
auto_start=true
  → set_auto_start() → reg.exe 写注册表(带 "--minimized")
  → 下次开机 → app 收到 --minimized 参数
  → setup() 检查参数 → 有则跳过 window.show()
```

潜在断点：

| 环节 | 风险 |
|------|------|
| `set_auto_start()` | `reg.exe` 返回值被 `let _ = ` 丢弃，写入失败不知情 |
| 注册表传参 | Rust 的 Windows 参数编码 vs `reg.exe` 解析，路径含空格时可能错位 |
| `visible: false` | Tauri 2.10.3 中初始隐藏状态可能被 webview 初始化覆盖 |

## 方案：双重保障（Config 直读 + Registry 加固）

### 改动 1：setup() — config 直读兜底

`setup()` 中除检查 `--minimized` arg 外，额外读取 `config.auto_start` 字段。
任一为 true 则确保窗口隐藏。

```rust
let is_minimized = std::env::args().any(|a| a == "--minimized");
let config = load_config(app);
let should_minimize = is_minimized || config.auto_start;

if !should_minimize {
    // 手动启动 → 正常显示
    window.show();
    window.set_focus();
} else {
    // 防御性隐藏
    window.hide();
}
```

- `load_config` 在 setup 中可用（纯读文件，无副作用）
- 首次运行无 config 时返回 `default()` → `auto_start: false` → 不影响手动启动
- `window.hide()` 对已隐藏的 window 是 no-op

### 改动 2：set_auto_start() — 错误处理

`set_auto_start()` 添加 match 检查 `reg.exe` 执行结果：

```rust
match std::process::Command::new("reg").args([...]).output() {
    Ok(o) => {
        if !o.status.success() {
            eprintln!("[set_auto_start] reg.exe failed: {}",
                      String::from_utf8_lossy(&o.stderr));
        }
    }
    Err(e) => eprintln!("[set_auto_start] reg.exe error: {}", e),
}
```

### 向后兼容

- 旧 config.json 含 `minimize_to_tray` 字段 → serde 忽略未知字段
- 手动启动（无 `--minimized`, `auto_start: false`）→ 行为不变
- 开机自启（`auto_start: true`）→ 无论 `--minimized` 是否生效都隐藏

### 影响范围

| 文件 | 改动 | 行数 |
|------|------|------|
| `src/main.rs setup()` | 加 config 读取 + 条件 hide | ~6 |
| `src/main.rs set_auto_start()` | 加 reg.exe 错误处理 | ~10 |

无新增依赖，无前端改动。
