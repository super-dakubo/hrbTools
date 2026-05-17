# 提醒线程可靠性修复设计

## 问题描述

三个长期未修复的 Bug 共享同一根因链：

| # | 现象 | 直接原因 |
|---|------|---------|
| 1 | 工具频繁自动置顶（每 5 秒一次轮询触发） | `last_notified=None` 时 60 秒防重失效(`now-0` 远大于 60000)，每次轮询都触发 `show/set_focus/request_user_attention` |
| 2 | 已关闭的置顶通知反复出现；删除时"最后一个很卡" | 配置文件写竞争 + 横幅队列被重复 `__onReminderFired` 调用打乱 |
| 3 | 待办弹框打开时卡顿 | 高频全量 `set_config` 写操作阻塞磁盘 I/O |

### 根因链

```
提醒触发 → Rust 线程 eval → 前端 __onReminderFired
  → 修改 last_notified/done/reminder.datetime
  → saveConfigToBackend() ❌ 无 await + 无 catch
  → 写入静默失败 → 磁盘 config.json 仍是旧数据
  → Rust 线程下次轮询(5s) → 以为未处理 → 再次触发
  → w.show() + w.set_focus() + w.request_user_attention() → 窗口置顶
  → 重复触发 __onReminderFired → 横幅队列混乱
```

前端 `saveConfigToBackend()` 调用了三处，全部缺少 await 和 catch：
1. `__onReminderFired`（line 2284）— 最关键路径
2. 横幅 X 按钮（line 2231）
3. 其他业务路径（`addTimezoneBtn`、游戏/存档编辑等）— 受影响较小，但同样缺少 await

---

## 方案：三层防护

### Layer 1 — Rust 线程内存级防重

在提醒线程内添加 `HashMap<String, i64>` 记录每个待办最近一次触发的时间戳。**不写入磁盘**。

- 冷却期：**5 分钟**（300,000 ms）
- 检查时机：通过 `config.last_notified` 的 60 秒防重之后，再加一道检查
- 优势：即使前端 save 完全失败、即使配置文件损坏，同一待办最多每 5 分钟触发一次

```rust
// 线程 loop 外部
let mut fired_cooldown: HashMap<String, i64> = HashMap::new();
const COOLDOWN_MS: i64 = 300_000;

// 在触发条件检查处
let last_fired = fired_cooldown.get(&todo.id).copied().unwrap_or(0);
if now - last_fired < COOLDOWN_MS {
    write_log(&app_handle, &format!("内存冷却中(5min)，跳过 '{}'", todo.text));
    continue;
}

// 触发提醒后
fired_cooldown.insert(todo.id.clone(), now);
```

影响：app 重启后 HashMap 重置，未处理的一次性/周期性提醒会通过启动扫描重新展示。

### Layer 2 — 前端 save 可靠性

将 `__onReminderFired` 改为 async，所有 `saveConfigToBackend()` 调用加 await 和 try/catch：

```javascript
invoke('get_config').then(async function(fresh) {
    // ... 修改配置 ...
    currentConfig.todos = todos;
    try {
        await saveConfigToBackend();
    } catch (e) {
        window.__log.error('提醒持久化失败(将重试): ' + e);
        try { await saveConfigToBackend(); } catch (e2) {
            window.__log.error('提醒持久化重试也失败: ' + e2);
        }
    }
    renderTodos();
}).catch(function(e) {
    window.__log.error('get_config 失败: ' + e);
});
```

横幅 X 按钮同样改为 async/await：
```javascript
btn.addEventListener('click', async function() {
    // ... 移除横幅 ...
    if (item.todoId) {
        var todo = (currentConfig.todos || []).find(t => t.id === item.todoId);
        if (todo && todo.reminder) {
            todo.last_notified = Date.now();
            try { await saveConfigToBackend(); } catch (e) {
                window.__log.error('横幅关闭持久化失败: ' + e);
            }
        }
    }
});
```

### Layer 3 — 窗口激活条件优化

当前每次触发都无条件调用 `show/set_focus/request_user_attention`。改为检查窗口状态：

```rust
if let Some(w) = app_handle.get_webview_window("main") {
    let is_visible = w.is_visible().unwrap_or(false);
    let is_focused = w.is_focused().unwrap_or(false);

    if !is_visible {
        let _ = w.show();
        let _ = w.unminimize();
    }
    if !is_focused {
        let _ = w.set_focus();
        let _ = w.request_user_attention(Some(tauri::UserAttentionType::Informational));
    }
}
```

- 窗口已显示 → 不重复 `show()/unminimize()`
- 窗口已获得焦点 → 不重复 `set_focus()/request_user_attention()`

---

## 变更文件及行数

| 文件 | 变更 |
|------|------|
| `src/main.rs` | 新增 `fired_cooldown: HashMap` + 内存冷却检查；窗口操作改为条件执行 |
| `src/main.js` | `__onReminderFired` 内 save 加 await/catch；横幅 X 按钮 save 加 await/catch |

## 成功标准

1. 关闭所有提醒后，工具不会在 1 小时内自动置顶
2. 关闭横幅后关闭 app，重新打开，横幅不重现
3. 一次性提醒触发后，待办自动标记为已完成
4. 待办弹框打开不卡顿（无高频 set_config 干扰）

## 不需要做的事

- 不重构 `main.js` 的事件架构
- 不改动 `body.light` / `styles.css` 等 UI 相关代码
- 不改动 Tauri 配置或 Cargo.toml 依赖
- 不改动启动扫描逻辑（已通过 `last_notified` 去重）
