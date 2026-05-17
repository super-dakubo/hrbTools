# UI 微动画设计

## 问题描述

部分操作"很慢、不太符合直觉"。审查结果表明实际性能瓶颈不存在（IPC ~1-5ms），问题在于**视觉反馈缺失**：操作触发后界面变化过于生硬（条目瞬间消失），用户无法感知"操作已被系统接收并执行"。

## 范围

只做一项：**删除待办的离场动画**。其他操作要么已有 CSS 过渡（开关）、要么在 modal 内不可见（新增/修改/编辑）、要么不适合动画（搜索/筛选每键触发）。

## 涉及文件

| 文件 | 变更 |
|------|------|
| `src/styles.css` | 新增 `@keyframes todoLeave`（~8 行）|
| `src/main.js` | `deleteTodo()` 函数加 ~5 行（leaving 类 + setTimeout）|

## 方案

### CSS — styles.css

在待办样式区末尾（~line 1422 附近）新增：

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

- `forwards`：动画结束后保持 end 状态（opacity: 0），避免短暂闪烁
- `ease-in`：先快后慢，模拟物体消失的自然感觉
- `0.2s`：足够短不觉得拖沓，足够长让人感知到

### JS — main.js

在 `deleteTodo()`（line 1619）中将立即移除改为先播动画再移除：

```javascript
function deleteTodo(id) {
    var item = document.querySelector('.todo-item[data-id="' + id + '"]');
    if (item) {
        item.classList.add('leaving');
        setTimeout(function() {
            currentConfig.todos = currentConfig.todos.filter(function(t) { return t.id !== id; });
            saveConfigToBackend();
            renderTodos();
        }, 200);
    } else {
        currentConfig.todos = currentConfig.todos.filter(function(t) { return t.id !== id; });
        saveConfigToBackend();
        renderTodos();
    }
}
```

- 优先通过 DOM 元素的 `data-id` 定位条目（比 `querySelector` 加上层 `closest` 更可靠，因为行内已有 `data-id`）
- 找不到 DOM 时（极边缘情况）降级为无动画操作
- setTimeout 200ms 与 CSS `animation-duration` 保持一致

## 不动的内容

- **开关过渡**：CSS 已有，不变
- **新增待办入场**：操作在 modal 内完成，用户关闭 modal 时条目已在 DOM 中，没有"出现"的视觉瞬间
- **修改待办动画**：同上，modal 内编辑
- **待办勾选（done/undone）**：全量 re-render 时 CSS transition 不跨 DOM 重建生效，需额外 post-render 逻辑。收益小于成本，不做
- **搜索/筛选动画**：每次按键触发 re-render，动画会导致列表持续闪烁
- **备份/游戏/存档等操作**：已有 confirm 弹框或 loading 状态提供反馈
- **Tab 切换**：已有 opacity transition + 执行锁，不能碰

## 成功标准

1. 点击待办的 × 按钮 → 确认 → 条目在 200ms 内淡出 + 上移 → 消失后列表无闪烁
2. 动画期间页面其他部分正常可交互（不阻塞 UI）
3. 条目较多的列表（20+）删除时依然流畅（动画使用 GPU 合成层属性 opacity + transform）
