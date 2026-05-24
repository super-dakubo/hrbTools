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

## 方案：Registry 加固

### 设计约束

交互规则：
- **手动启动** → 始终显示窗口（不读 `auto_start` 配置）
- **开机自启**（注册表带 `--minimized`）→ 隐藏到托盘
- `auto_start` 开关仅控制是否写注册表，不控制启动行为

### 改动 1：setup() — 保持原 `--minimized` 检查

不引入 config 兜底。仅依赖 `--minimized` 参数区分手动/开机。窗口默认 `visible: false`，
有 `--minimized` 时不调 `window.show()`，无此参数时正常显示。

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
