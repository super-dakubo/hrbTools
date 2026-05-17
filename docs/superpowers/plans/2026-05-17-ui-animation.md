# UI 微动画实现计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 删除待办时条目淡出 + 上移离场，再移除 DOM

**Architecture:** CSS `@keyframes` 定义离场动画 → `deleteTodo()` 先加 `.leaving` 类触发动画 → setTimeout 200ms 后执行数据移除 + re-render

**Tech Stack:** 原生 CSS + JS（无框架）

---

### Task 1: CSS — 新增 todoLeave 关键帧动画

**Files:**
- Modify: `src/styles.css:1422`（`.todo-delete-btn` 之后）

- [ ] **Step 1: 添加 @keyframes 和 .leaving 类**

在 `styles.css` 的待办样式区末尾（`.todo-delete-btn:hover` 规则之后），新增：

```css
@keyframes todoLeave {
    from { opacity: 1; transform: translateY(0); }
    to   { opacity: 0; transform: translateY(-6px); }
}
.todo-item.leaving {
    animation: todoLeave 0.2s ease-in forwards;
    overflow: hidden;
}
```

- `forwards`：保持动画结束状态（opacity: 0），防止消失前闪烁
- `ease-in`：先快后慢
- `opacity + transform`：GPU 合成层属性，不触发重排

---

### Task 2: JS — deleteTodo 加离场动画

**Files:**
- Modify: `src/main.js:1619-1625`（`deleteTodo` 函数）

- [ ] **Step 1: 修改 deleteTodo 函数**

当前代码（line 1619-1625）：
```javascript
function deleteTodo(id) {
    var todo = currentConfig.todos.find(function(t) { return t.id === id; });
    if (todo) window.__log.info('Todo', '删除待办: ' + todo.text);
    currentConfig.todos = currentConfig.todos.filter(function(t) { return t.id !== id; });
    saveConfigToBackend();
    renderTodos();
}
```

替换为：
```javascript
function deleteTodo(id) {
    var item = document.querySelector('.todo-item[data-id="' + id + '"]');
    if (item) {
        item.classList.add('leaving');
        setTimeout(function() {
            var todo = currentConfig.todos.find(function(t) { return t.id === id; });
            if (todo) window.__log.info('Todo', '删除待办: ' + todo.text);
            currentConfig.todos = currentConfig.todos.filter(function(t) { return t.id !== id; });
            saveConfigToBackend();
            renderTodos();
        }, 200);
    } else {
        var todo = currentConfig.todos.find(function(t) { return t.id === id; });
        if (todo) window.__log.info('Todo', '删除待办: ' + todo.text);
        currentConfig.todos = currentConfig.todos.filter(function(t) { return t.id !== id; });
        saveConfigToBackend();
        renderTodos();
    }
}
```

- 优先通过 `[data-id]` 定位 DOM 元素
- 找不到 DOM 时降级为无动画操作（边缘情况兜底）
- `setTimeout 200ms` 与 CSS `animation-duration: 0.2s` 一致
- `saveConfigToBackend()` 和 `renderTodos()` 在动画完成后执行

---

### Task 3: 验证

- [ ] **Step 1: 检查 JS 语法**

Run: `node --check src/main.js`
Expected: 无输出（语法正确）

- [ ] **Step 2: 功能验证**

手动测试：
1. 打开待办面板
2. 添加几条待办
3. 点击某条待办的 × 按钮
4. 在确认弹框点"确定"
5. 观察：条目应在 200ms 内淡出 + 上移 → 然后从列表中消失
6. 确认列表其他条目无闪烁
7. 确认删除后配置已持久化（重启 app 后条目不重现）
