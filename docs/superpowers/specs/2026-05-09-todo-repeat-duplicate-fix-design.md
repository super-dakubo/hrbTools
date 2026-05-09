# 周期性任务取消完成重复数据修复 — 设计文档

## 问题

周期性待办完成后，生成克隆项推到下一周期。此时取消完成原任务，只翻转了 `done` 标记，克隆项未被清理，导致两条内容一致的待办同时存在。

## 根因

`toggleTodoDone` 完成时用 `createNextRepeat` 克隆（新 UUID）推入数组，取消完成时无对应的反操作。克隆使用新 UUID，无法与原始项回滚关联。

## 方案：`parent_id` 关联

克隆时在 `newTodo` 上记录原任务 ID，取消完成时按此删除克隆项并重置原任务时间。

### Rust 端

`TodoItem` 新增可选字段：

```rust
struct TodoItem {
    // ... 现有字段不变
    #[serde(default)]
    parent_id: Option<String>,
}
```

`#[serde(default)]` 使旧数据反序列化时自动 `None`，无迁移成本。

### 前端逻辑变更

#### `toggleTodoDone(id)` 新流程

```
完成 (done: false → true):
  翻转 todo.done = true
  若有 repeat:
    克隆 = createNextRepeat(todo)
    克隆.parent_id = todo.id
    todos.push(克隆)

取消完成 (done: true → false):
    查找并删除克隆:
      child = todos.find(t => t.parent_id === todo.id)
      if child: todos.remove(child)
    翻转 todo.done = false
    若有 repeat:
      重新计算 due_date/reminder（见下方）
```

#### `createNextRepeat` 变更

加一行赋值：

```javascript
function createNextRepeat(todo) {
    // ... 现有克隆逻辑不变 ...
    newTodo.parent_id = todo.id;   // ← 新增
    return newTodo;
}
```

#### `recalculateNextDue(todo)` 新函数

仅在取消完成且原 `due_date` 已过期时调用，从今天起推进到下一周期：

```javascript
function recalculateNextDue(todo) {
    if (!todo.due_date) return;
    var due = new Date(todo.due_date);
    var now = new Date();
    if (due <= now) {
        var next = new Date(now.getFullYear(), now.getMonth(), now.getDate());
        if (todo.repeat === 'daily') next.setDate(next.getDate() + 1);
        else if (todo.repeat === 'weekly') next.setDate(next.getDate() + 7);
        else if (todo.repeat === 'monthly') next.setMonth(next.getMonth() + 1);
        todo.due_date = next.toISOString().slice(0, 10);
        if (todo.reminder) {
            var rNext = new Date(/* 同样逻辑 */);
            todo.reminder.datetime = rNext.toISOString().slice(0, 16);
        }
    }
    // 未过期 → 不动
}
```

### 边界情况

| 场景 | 行为 |
|------|------|
| 连续完成/取消完成多次 | `parent_id` 唯一配对，不会累积 |
| 用户手动删除克隆项后再取消完成 | `find` 找不到，跳过删除，只翻转 `done` |
| 用户修改克隆项内容后取消完成 | 仍按 `parent_id` 删除（克隆已生成即应清理） |
| 非周期任务取消完成 | `repeat` 为 null → 跳过所有额外逻辑 |
| 旧数据 | `parent_id` 不存在 → 取消完成时 `find` 无结果，正常运行 |

### 修改文件清单

| 文件 | 改动 |
|------|------|
| `src/main.rs` | `TodoItem` 加 `parent_id: Option<String>` + `#[serde(default)]` |
| `src/main.js` | `toggleTodoDone` 增加取消完成分支；`createNextRepeat` 加 `parent_id` 赋值；新增 `recalculateNextDue` 函数 |
