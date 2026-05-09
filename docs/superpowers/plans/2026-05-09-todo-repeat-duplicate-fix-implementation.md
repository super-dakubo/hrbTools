# 周期性任务取消完成重复数据修复 — 实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 修复周期性待办完成后再取消完成出现重复数据的问题

**Architecture:** 在 `TodoItem` 中新增 `parent_id` 字段，克隆时标记父子关系；取消完成时按 `parent_id` 删除克隆项并重置原任务时间。

**Tech Stack:** Rust + Tauri 2.0 + 原生 JS

---

### Task 1: Rust 端 — TodoItem 新增 parent_id 字段

**Files:**
- Modify: `src/main.rs:200-228`

- [ ] **Step 1: 在 TodoItem 中插入 parent_id 字段**

在 `src/main.rs` 的 `TodoItem` 结构体中，在 `last_notified` 之后新增一行：

```rust
    #[serde(default)]
    last_notified: Option<i64>,
    #[serde(default)]
    parent_id: Option<String>,   // ← 新增：记录克隆来源任务的 id
}
```

注意：`paused` 字段之后没有逗号的那个位置，是在 `last_notified` 之后加。

- [ ] **Step 2: 验证编译**

```bash
cd d:/code/hello_world && cargo build 2>&1 | tail -20
```

Expected: 编译成功，无 warning（新字段有 `#[serde(default)]`，旧数据反序列化时自动 `None`）。

---

### Task 2: JS 端 — toggleTodoDone 增加取消完成分支

**Files:**
- Modify: `src/main.js:1524-1537`

- [ ] **Step 1: 重写 toggleTodoDone**

当前代码（1524-1537 行）：

```javascript
function toggleTodoDone(id) {
    var todo = currentConfig.todos.find(function(t) { return t.id === id; });
    if (!todo) return;
    todo.done = !todo.done;

    // 重复任务完成时自动创建下一周期
    if (todo.done && todo.repeat) {
        var newTodo = createNextRepeat(todo);
        if (newTodo) currentConfig.todos.push(newTodo);
    }

    saveConfigToBackend();
    renderTodos();
}
```

改为：

```javascript
function toggleTodoDone(id) {
    var todo = currentConfig.todos.find(function(t) { return t.id === id; });
    if (!todo) return;

    if (!todo.done) {
        // 完成 — 翻转 done 并生成克隆
        todo.done = true;
        if (todo.repeat) {
            var newTodo = createNextRepeat(todo);
            if (newTodo) currentConfig.todos.push(newTodo);
        }
    } else {
        // 取消完成 — 删除克隆项，翻转 done，重置时间
        var childIndex = currentConfig.todos.findIndex(function(t) { return t.parent_id === todo.id; });
        if (childIndex !== -1) currentConfig.todos.splice(childIndex, 1);
        todo.done = false;
        if (todo.repeat) recalculateNextDue(todo);
    }

    saveConfigToBackend();
    renderTodos();
}
```

---

### Task 3: JS 端 — createNextRepeat 增加 parent_id 赋值

**Files:**
- Modify: `src/main.js:1545-1576`

- [ ] **Step 1: 在克隆返回前加 parent_id 赋值**

当前 `createNextRepeat` 末尾（约 1574-1576 行）：

```javascript
    }
    return newTodo;
}
```

改为：

```javascript
    }
    newTodo.parent_id = todo.id;   // 记录关联，供取消完成时查找删除
    return newTodo;
}
```

---

### Task 4: JS 端 — 新增 recalculateNextDue 函数

**Files:**
- Modify: `src/main.js`，紧接在 `createNextRepeat` 之后（1577 行前）

- [ ] **Step 1: 在 createNextRepeat 后添加新函数**

在 `createNextRepeat` 函数之后（`return newTodo;}` 闭括号后）、`// 添加待办按钮` 注释之前插入：

```javascript
function recalculateNextDue(todo) {
    if (!todo.due_date) return;
    var due = new Date(todo.due_date);
    var now = new Date();
    // 仅当到期日已过期时重置到下一周期
    if (due <= now) {
        var next = new Date(now.getFullYear(), now.getMonth(), now.getDate());
        if (todo.repeat === 'daily') next.setDate(next.getDate() + 1);
        else if (todo.repeat === 'weekly') next.setDate(next.getDate() + 7);
        else if (todo.repeat === 'monthly') next.setMonth(next.getMonth() + 1);
        todo.due_date = next.toISOString().slice(0, 10);
        if (todo.reminder && todo.reminder.datetime) {
            var r = new Date(todo.reminder.datetime);
            if (todo.repeat === 'daily') r.setDate(r.getDate() + 1);
            else if (todo.repeat === 'weekly') r.setDate(r.getDate() + 7);
            else if (todo.repeat === 'monthly') r.setMonth(r.getMonth() + 1);
            todo.reminder.datetime = r.toISOString().slice(0, 16);
        }
    }
    // 到期日未过期 → 不动
}
```

---

### Task 5: 编译验证

- [ ] **Step 1: 确认完整编译通过**

```bash
cd d:/code/hello_world && cargo build 2>&1 | tail -20
```

Expected: 编译成功，无错误。

---

## 自审

- **Spec 覆盖** — Rust 字段、JS `toggleTodoDone` 分支、`createNextRepeat` 单行赋值、`recalculateNextDue` 新函数，全部覆盖
- **占位符** — 全部展开，无 TBD/TODO
- **类型一致性** — `parent_id` 在 Rust 是 `Option<String>`，在 JS 是 `string | undefined`，一致
