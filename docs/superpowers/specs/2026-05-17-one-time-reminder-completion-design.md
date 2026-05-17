# 一次性提醒自动完成修复设计

## 问题

一次性待办到期后，窗口能正常置顶，但：
1. 应用内横幅没出现
2. 待办没标记为已完成
3. 待办列表没刷新

## 根因

`main.rs:1795-1797` 一次性提醒分支注释"由前端标记完成"，但前端 `__onReminderFired` 已在之前的可靠性修复中设为 `null`（`main.js:2330`），两端均未处理完成逻辑。

## 方案

### 核心原则

Rust 线程处理配置持久化（同步写入可靠），前端只读刷新（消除写竞争）。

### Rust 端改动（main.rs）

一次性提醒触发分支（`main.rs:1795` 附近）：

```rust
} else {
    // 一次性提醒：直接标记完成并持久化
    todo.done = true;
    todo.last_notified = Some(now);
    if let Err(e) = save_config(&app_handle, &config) {
        write_log(&app_handle, &format!("一次性提醒标记完成保存失败: {:?}", e));
    }
}
```

修改 eval payload：取消 JSON payload（不再需要 `__onReminderFired`），改为调用轻量函数 `__onOneTimeReminderDone(id, text)`。

### 前端改动（main.js）

替换 `window.__onReminderFired = null` 为：

```javascript
window.__onOneTimeReminderDone = function(id, text) {
    window.__bannerQueue.push({ text: '⏰ ' + text, id: ++window.__bannerIdSeq, todoId: id });
    window.__renderBanners();
    invoke('get_config').then(function(fresh) {
        currentConfig.todos = fresh.todos;
        renderTodos();
    }).catch(function() {});
};
```

**只读不写**：只调 `get_config` 刷新列表，不做 `saveConfigToBackend`。

### 启动扫描改动（main.js:2332-2355）

启动时检测到已过期的一次性待办，除了显示横幅外，也标记为已完成：

```javascript
(function() {
    var now = new Date();
    var items = [];
    var needSave = false;
    (currentConfig.todos || []).forEach(function(t) {
        if (t.done || !t.reminder || !t.reminder.datetime) return;
        if (t.last_notified) return;
        var rt = new Date(t.reminder.datetime);
        if (!isNaN(rt) && rt <= now) {
            items.push({ text: '⏰ ' + t.text, todoId: t.id });
            // 一次性待办启动时自动标记完成
            if (!t.repeat && t.reminder.datetime && t.reminder.datetime.includes('T')) {
                t.done = true;
                t.last_notified = Date.now();
                needSave = true;
            }
        }
    });
    items.forEach(function(item) {
        window.__bannerQueue.push({ text: item.text, id: ++window.__bannerIdSeq, todoId: item.todoId });
    });
    window.__renderBanners();

    // 先保存再刷新，避免竞态
    var refreshPromise;
    if (needSave) {
        refreshPromise = saveConfigToBackend().catch(function(e) {
            window.__log.error('启动扫描保存失败: ' + e);
        }).then(function() {
            return invoke('get_config');
        });
    } else if (items.length > 0) {
        refreshPromise = invoke('get_config');
    }
    if (refreshPromise) {
        refreshPromise.then(function(fresh) {
            currentConfig.todos = fresh.todos;
            renderTodos();
        }).catch(function() {});
    }
})();
```

### 变更文件

| 文件 | 变更 |
|------|------|
| `src/main.rs` | 一次性提醒分支配置持久化；eval payload 简化 |
| `src/main.js` | 新增 `__onOneTimeReminderDone`；启动扫描标记完成 |

### 成功标准

1. 一次性待办到期 → 窗口置顶 + 应用内横幅出现 + 列表自动刷新
2. 一次性待办到期后 → 自动标记为已完成（勾选状态）
3. 应用重启后，已触发的一次性待办不重复弹横幅
4. 重复待办不受影响，保持原有推期逻辑

### 不需要做的事

- 不改动重复提醒逻辑
- 不改动 `notify-rust` 调用
- 不改动 Rust 窗口操作
- 不改动 `__onReminderFired`（完全废弃）
- 不改动事件委托结构
