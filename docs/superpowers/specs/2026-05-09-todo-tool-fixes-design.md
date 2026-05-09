# 待办工具优化与问题修复 — 设计文档

## 概述

对现有待办面板进行 5 项优化/修复，不涉及新功能。

## Fix 1：Tab 拖拽排序不生效

**问题**：`dragstart` 事件中缺少 `e.dataTransfer.setData()` 调用，HTML5 Drag & Drop API 要求至少设置一次 data 才能启动拖拽。

**改动**：在 `dragstart` 回调中加一行：

```js
tab.addEventListener('dragstart', (e) => {
    e.dataTransfer.setData('text/plain', tab.dataset.tab);
    dragSrcIdx = idx;
    setTimeout(() => tab.style.opacity = '0.5', 0);
});
```

**文件**：`src/main.js`，`bindTabEvents()` 函数

## Fix 2：编辑弹窗自适应宽度

**问题**：`.todo-edit-modal` 固定 `width: 380px`，下拉列表（select）文字展示不全。

**改动**：

- 宽度改为 `min-width: 400px` + `width: auto` + `max-width: 90vw`
- `todo-edit-row` 保持 flex 布局，确保内部元素不溢出

## Fix 3：待办列表加大

**问题**：列表行高和整体区域都偏小。

**改动**：

- 每条待办 `.todo-item` 的 `padding` 从 `7px 8px` → `10px 12px`
- `.todo-list` 容器 `min-height: 60px` → 不设下限，由内容撑开
- 面板区域 `.content` 子元素底部用 flex 伸展，使列表尽可能占满可用空间

## Fix 4：替换回车创建为弹窗创建

**问题**：底部输入框回车直接创建不理想。

**改动**：

- 删除 `todoAddInput` 的 `keydown` 回车事件
- 底部输入框改为"添加待办"按钮
- 点击按钮 → 打开编辑弹窗（复用 `openTodoEditModal`，新建时 `id = null` 表示创建模式）
- 编辑弹窗中「内容」字段留空，保存时校验必填

**新建 vs 编辑弹窗复用逻辑**：

`openTodoEditModal(id)` 增加处理 `id = null` 的情况：
- 标题显示"新建待办"（vs "编辑待办"）
- 所有字段初始化为空/默认值
- 保存时 `crypto.randomUUID()` 生成新 ID
- 保存时将新项 push 到 `currentConfig.todos`

## Fix 5：到期日/提醒时间样式优化

**问题**：原生 `<input type="date">` 和 `<input type="datetime-local">` 样式丑陋，且与优先级挤在一行。

**改动**：

- 到期日从 `todo-edit-row` 中分离，**独占一行**，左侧加 📅 图标
- 提醒时间**独占一行**，左侧加 ⏰ 图标
- 用 CSS 美化原生 input（边框 `--border-strong`、圆角 `--radius-lg`、背景 `--input-bg`）
- 重复下拉保持单独一行

**弹窗布局变化**：

```
┌──── 编辑待办 (自适应 min-width: 400px) ────┐
│ 内容 [_____________________________]       │
│                                            │
│ 优先级  [低][中][高]                        │
│                                            │
│ 📅 到期日 [___________]                     │
│                                            │
│ 标签 [_____________________________]        │
│                                            │
│ 备注 [_____________________________]        │
│                                            │
│ ⏰ 提醒时间 [______________________]        │
│                                            │
│ 重复 [不重复 ▾]                            │
│                                            │
│           [取消]       [保存]              │
└────────────────────────────────────────────┘
```

## 修改文件清单

| 文件 | 改动 |
|------|------|
| `src/main.js` | `bindTabEvents()` 补 `setData`；`todoAddInput` 替换为按钮+弹窗；`openTodoEditModal` 支持新建模式 |
| `src/styles.css` | 编辑弹窗宽度自适应；待办列表行高加大；到期日/提醒独占一行；美化原生输入框 |
