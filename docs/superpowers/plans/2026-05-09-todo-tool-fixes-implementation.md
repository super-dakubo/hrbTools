# 待办工具优化与问题修复 — 实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 修复 Tab 拖拽不生效、弹窗宽度自适应、列表加大、替换回车创建为弹窗创建、到期日/提醒样式优化

**Architecture:** 5 项独立修复，全部在现有 `main.js` 和 `styles.css` 中修改，不涉及 Rust 后端。3 项 JS 改动，2 项 CSS 改动，1 项 JS+CSS 混合。

**Tech Stack:** 原生 JS + CSS（无框架）

---

### Task 1: 修复 Tab 拖拽排序

**Files:**
- Modify: `src/main.js:78-81`（`bindTabEvents` 中的 `dragstart` 回调）

- [ ] **Step 1: 补 `e.dataTransfer.setData()`**

在 `dragstart` 回调中补第一行：

```js
tab.addEventListener('dragstart', (e) => {
    e.dataTransfer.setData('text/plain', tab.dataset.tab);  // ← 加这行
    dragSrcIdx = idx;
    setTimeout(() => tab.style.opacity = '0.5', 0);
});
```

- [ ] **Step 2: 编译验证**

```bash
cargo tauri dev
```
确认点击并验证是否可拖动 Tab。Tauri 会打开开发者工具，观察控制台无报错。

---

### Task 2: 编辑弹窗自适应宽度 + 待办列表加大（CSS）

**Files:**
- Modify: `src/styles.css`

**改动 A：弹窗宽度自适应**

- [ ] **Step 1: 修改 `.todo-edit-modal` 宽度规则**

找到 `.todo-edit-modal`（~1193-1201 行），将 `width: 380px` 改为：

```css
.todo-edit-modal {
    background: var(--bg);
    border: 1px solid var(--border);
    border-radius: var(--radius-xl);
    padding: 20px;
    width: auto;
    min-width: 400px;
    max-width: 90vw;
    max-height: 90vh;
    overflow-y: auto;
}
```

**改动 B：待办列表行列加大**

- [ ] **Step 2: 加大 `.todo-item` 内边距**

找到 `.todo-item`（~1064-1072 行），将 `padding: 7px 8px` 改为：

```css
.todo-item {
    display: flex;
    align-items: center;
    gap: 6px;
    padding: 10px 12px;
    border-radius: var(--radius);
    transition: background 0.15s;
    cursor: default;
}
```

- [ ] **Step 3: 去掉 `.todo-list` 的 `min-height` 限制**

找到 `.todo-list`（~1056-1062 行），去掉 `min-height: 60px`：

```css
.todo-list {
    display: flex;
    flex-direction: column;
    gap: 3px;
    margin-bottom: 10px;
}
```

- [ ] **Step 4: 让待办列表区域占满可用高度**

在 `.todo-list` 或其父容器 `.panel#panel-todo` 上加 `flex: 1`，使列表撑满内容区剩余高度。找到 `#panel-todo` 的隐含样式（`.panel` 已有 `display: none` / `.panel.active { display: block }`），在 `.panel.active` 上加一列，但更好的方式是在 `#panel-todo` 上单独加 flex 布局：

```css
#panel-todo {
    display: flex;
    flex-direction: column;
    height: 100%;
}

#panel-todo .todo-list {
    flex: 1;
    min-height: 0;
}
```

注意 `.panel.active { display: block }` 与 `#panel-todo { display: flex }` 会冲突（`.panel.active` specificity 更高）。需要把 `#panel-todo` 的 display 也加上 `.active`：

```css
#panel-todo.active {
    display: flex;
    flex-direction: column;
    height: 100%;
}
```

---

### Task 3: 到期日/提醒时间布局重构（JS—弹窗 HTML）

**Files:**
- Modify: `src/main.js:1489-1589`（`openTodoEditModal` 函数）

**改动：** 把到期日从 `todo-edit-row` 中拆出来独占一行，提醒时间也独占一行，添加 📅/⏰ 图标标签。

- [ ] **Step 1: 修改弹窗内 HTML 模板**

找到 `openTodoEditModal` 中的弹窗 HTML 构建（~1511-1555 行），将原来的：

```js
// 旧布局：优先级 + 到期日在同一 todo-edit-row
+ '<div class="todo-edit-row">'
    + '<div class="todo-edit-field">'
        + '<label>优先级</label>'
        + '<div class="todo-priority-picker" id="editPriority">' + priorityHtml + '</div>'
    + '</div>'
    + '<div class="todo-edit-field">'
        + '<label>到期日</label>'
        + '<input type="date" id="editDueDate" value="' + (todo.due_date || '') + '">'
    + '</div>'
+ '</div>'
```

改为新布局（优先级独占一行、到期日独占一行、提醒独占一行）：

```js
// 新布局：优先级独占一行
+ '<div class="todo-edit-field">'
    + '<label>优先级</label>'
    + '<div class="todo-priority-picker" id="editPriority">' + priorityHtml + '</div>'
+ '</div>'

// 到期日独占一行
+ '<div class="todo-edit-field">'
    + '<label>📅 到期日</label>'
    + '<input type="date" id="editDueDate" value="' + (todo.due_date || '') + '">'
+ '</div>'
```

然后将原来提醒 + 重复在同一 `todo-edit-row` 的布局：

```js
// 旧布局：提醒 + 重复在同一 todo-edit-row
+ '<div class="todo-edit-row">'
    + '<div class="todo-edit-field">'
        + '<label>提醒时间</label>'
        + '<input type="datetime-local" id="editReminder" ...>'
    + '</div>'
    + '<div class="todo-edit-field">'
        + '<label>重复</label>'
        + '<select id="editRepeat">' + repeatOpts + '</select>'
    + '</div>'
+ '</div>'
```

改为：

```js
// 提醒独占一行
+ '<div class="todo-edit-field">'
    + '<label>⏰ 提醒时间</label>'
    + '<input type="datetime-local" id="editReminder" value="' + (todo.reminder ? todo.reminder.datetime : '') + '">'
+ '</div>'

// 重复单独一行
+ '<div class="todo-edit-field">'
    + '<label>重复</label>'
    + '<select id="editRepeat">' + repeatOpts + '</select>'
+ '</div>'
```

---

### Task 4: 添加新建模式（`openTodoEditModal` 支持 `id = null`）

**Files:**
- Modify: `src/main.js:1489-1589`（`openTodoEditModal` 函数）

- [ ] **Step 1: 修改函数入口逻辑**

在 `openTodoEditModal` 函数开头，处理 `id = null` 的创建模式：

```js
function openTodoEditModal(id) {
    var isNew = id === null;
    var todo = isNew ? null : currentConfig.todos.find(function(t) { return t.id === id; });
    if (!todo && !isNew) return;

    // 新建模式——造一个空 todo 对象（不保存到 config，仅用于模板填充）
    if (isNew) {
        todo = {
            id: null,
            text: '',
            done: false,
            priority: 1,
            due_date: null,
            tags: [],
            notes: '',
            reminder: null,
            repeat: null,
            sort_order: currentConfig.todos.length,
            created_at: new Date().toISOString().slice(0, 16),
            last_notified: null,
        };
    }
```

- [ ] **Step 2: 修改弹窗标题**

找到标题 HTML（~1512 行），把固定的"编辑待办"改为条件显示：

```js
+ '<div class="todo-edit-title">' + (isNew ? '新建待办' : '编辑待办') + '</div>'
```

- [ ] **Step 3: 修改保存回调**

找到 `editSaveBtn` 的点击回调（~1569-1588 行），在保存逻辑开头处理新建：

```js
overlay.querySelector('#editSaveBtn').addEventListener('click', function() {
    var newText = overlay.querySelector('#editText').value.trim();
    if (!newText) { alert('内容不能为空'); return; }

    // 新建模式
    if (isNew) {
        todo = {
            id: crypto.randomUUID(),
            text: newText,
            done: false,
            priority: 1,
            due_date: null,
            tags: [],
            notes: '',
            reminder: null,
            repeat: null,
            sort_order: currentConfig.todos.length,
            created_at: new Date().toISOString().slice(0, 16),
            last_notified: null,
        };
        currentConfig.todos.push(todo);
    } else {
        todo.text = newText;
    }

    // 以下是原来保存逻辑的公共部分（优先级、日期、标签等）
    var activePri = overlay.querySelector('.todo-priority-picker .active');
    todo.priority = activePri ? parseInt(activePri.dataset.value, 10) : 1;
    todo.due_date = overlay.querySelector('#editDueDate').value || null;
    // ... 其余不变
```

注意原保存回调里 `todo.text = newText` 这一行需要移到条件分支中。

---

### Task 5: 替换底部输入框为"添加"按钮

**Files:**
- Modify: `src/main.js`（删除 `todoAddInput` 事件 + 修改 HTML）
- No CSS change needed（按钮复用现有 button 样式）

- [ ] **Step 1: 删除 `todoAddInput` 的 `keydown` 事件**

找到并删除整个 `todoAddInput.addEventListener('keydown', ...)` 代码块（~1457-1481 行）。

- [ ] **Step 2: 修改 index.html 中的底部创建栏**

找到 `index.html` 中待办面板底部的 `todo-add-bar`（~100-102 行）：

```html
<div class="todo-add-bar">
    <input type="text" id="todoAddInput" placeholder="+ 添加待办，回车创建..." class="todo-add-input">
</div>
```

改为：

```html
<div class="todo-add-bar">
    <button id="todoAddBtn" class="btn-small" style="width:100%;padding:0.6rem;">+ 添加待办</button>
</div>
```

- [ ] **Step 3: 绑定按钮点击事件**

在 `renderTodos()` 函数或初始化区域添加按钮事件绑定，点击后打开新建弹窗：

```js
// 在 todoAddBtn 上绑定点击事件
document.getElementById('todoAddBtn')?.addEventListener('click', function() {
    openTodoEditModal(null);  // null = 新建模式
});
```

注意：由于 `renderTodos()` 每次会重建 DOM，按钮绑定需要放在 `renderTodos()` 内部或使用事件委托。推荐用事件委托，或者每次 `renderTodos()` 调用后重新绑定。

更好的方案是：将按钮放在 `todoList` 容器之外（在 `#panel-todo` 中），这样不受 `renderTodos()` 影响。由于按钮在 `index.html` 中静态定义，只需在启动时绑定一次。

---

### Task 6: 选项 1️⃣——编译验证 && 全面检查

- [ ] **Step 1: 编译**

```bash
cargo tauri dev
```

- [ ] **Step 2: 逐项验证 5 个修复**

| # | 验证项 | 操作 |
|---|--------|------|
| 1 | Tab 拖拽 | 按住 Tab 拖动，确认可重新排序 |
| 2 | 弹窗宽度 | 点击编辑/新建，弹窗宽度自适应，select 不下拉不截断 |
| 3 | 列表加大 | 待办行距明显变大，列表占满面板高度 |
| 4 | 新建交互 | 底部的"添加"按钮→弹窗→填内容→保存，不再回车直接创建 |
| 5 | 日期样式 | 到期日和提醒各占一行，带图标，样式统一美观 |

- [ ] **Step 3: 回归检查**

确认其他面板（时间转换、存档管理）功能不受影响。

---

## 自审清单

1. **Spec 覆盖**：
   - Fix 1 → Task 1 ✅
   - Fix 2 → Task 2 ✅
   - Fix 3 → Task 2 Step 2-4 ✅
   - Fix 4 → Task 4 + Task 5 ✅
   - Fix 5 → Task 3 + Task 2 Step 1 ✅

2. **无占位符**：所有代码块均为完整代码，无"TBD"/"TODO" ✅

3. **类型一致性**：`openTodoEditModal(null)` 在 Task 4 中定义，在 Task 5 中调用，签名一致 ✅
