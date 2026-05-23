# 自动启动合并到托盘展示 — 设计规格

> 2026-05-23

## 背景

当前设置面板中 `auto_start` 和 `minimize_to_tray` 是两个独立开关，但实际行为上：
- `auto_start` 开启 → 注册表写入 `--minimized` 参数
- `--minimized` 启动 → 窗口隐藏，托盘展示
- `minimize_to_tray` 开关在代码中**不实际控制任何行为**（`window_minimize` 始终隐藏到托盘，未检查此字段）

两个开关冗余且造成用户困惑。

## 目标

将 `auto_start` 作为唯一开关：开启后开机自启到托盘，不弹出窗口。删除 `minimize_to_tray` 及相关 UI。

## 改动范围

### src/main.rs — AppConfig 结构体

```diff
-   minimize_to_tray: bool,
```

- 从 `AppConfig` 删除 `minimize_to_tray` 字段
- 从 `Default` 实现中删除 `minimize_to_tray: true`
- serde 反序列化对旧 config.json 中残留字段静默忽略，无需迁移

### src/index.html — 设置面板

```diff
-   <div class="row" style="justify-content:space-between;margin-top:8px;">
-       <label style="margin:0;">最小化到托盘</label>
-       <span class="toggle-switch" id="trayToggle" data-state="on"><span class="toggle-thumb"></span></span>
-   </div>
```

删除「最小化到托盘」开关行（autoStartToggle 所在行保留不动）。

### src/main.js — 前端逻辑

- 删除 `trayToggle` 的 DOM 查询引用
- 删除 `trayToggle` 的 `click` 事件监听器及其回调
- 从 `updateSettingsDisplay()` 中删除 `trayToggle.dataset.state` 的同步代码

## 不动的逻辑

| 代码 | 理由 |
|------|------|
| `set_auto_start()` / `--minimized` | 机制不变，auto_start 开启仍写入 `--minimized` |
| `window_minimize` 命令 | 始终隐藏到托盘，符合用户预期 |
| 托盘创建/菜单/点击事件 | 行为不变 |
| autoStartToggle 事件绑定 | 继续控制 `currentConfig.auto_start` |
| `saveConfigToBackend()` | 仅移除 `minimize_to_tray` 不再写回，不影响其他字段 |

## 向后兼容

serde 默认忽略未知字段，旧 config.json 含 `minimize_to_tray` 字段不影响读取。

## 最终行为矩阵

| 启动方式 | 行为 |
|---------|------|
| 开机自启（auto_start = true） | 隐藏窗口，仅托盘展示 |
| 手动启动 exe | 正常显示窗口 |
| 点最小化按钮 | 隐藏到托盘 |
| 点托盘图标/菜单「显示」 | 恢复窗口 |
