# Tab 切换卡顿修复设计

## 背景

用户反馈 release 版本在快速点击 tab 切换时界面卡死几秒。此前已做过一轮渲染优化（`display:none` → `position:absolute` + `opacity`），但卡顿未彻底消除。

## 根因分析

### 问题 1：`switchTab` 无执行锁

`switchTab()` 没有任何并发防护，快速点击时：

1. 每次点击立即调用 `switchTab()`
2. 每次调用触发全量 `innerHTML` 重建面板 DOM
3. 多个渲染任务排队同步执行 → 主线程阻塞数秒
4. 同时 `currentTab` 被反复覆盖，可能出现状态不一致

### 问题 2：`will-change: opacity` 滥用 → GPU 合成层爆炸

CSS 第 235 行 `.panel { will-change: opacity; }` 让所有 4 个面板永久拥有独立 GPU 合成层。

**后果：**
- 4 个合成层常驻 GPU 内存
- 根据合成层"重叠传染"规则，互相重叠的层会导致更多元素被隐式提升
- 用户设备若使用集成显卡 → 合成线程争抢 → 界面卡顿
- 可见的需求只有 1 个合成层（当前活动面板），却分配了 4 个

**现代 Chromium（WebView2）行为：** 对 `transition: opacity` 声明，浏览器在动画开始时自动提升元素到合成层，动画完成后自动释放。提前声明 `will-change` 已无必要。

### 问题 3：`escapeHtml` 每次创建临时 DOM

```js
function escapeHtml(str) {
    const div = document.createElement('div');  // ← 每次调用创建 DOM 元素
    div.textContent = str;
    return div.innerHTML;
}
```

每次 tab 切换被调用数百次（每个备份项、待办项、日志项），创建大量临时 DOM 节点 → GC 频繁触发 → 主线程暂停。

### 问题 4：tab click 无防抖

```js
tabBar.addEventListener('click', function(e) {
    var tab = e.target.closest('.tab');
    if (!tab || tabWasDragged) return;
    var tabId = tab.dataset.tab;
    if (tabId !== currentTab) switchTab(tabId);  // ← 无防抖
});
```

在 300ms 内的多次点击都会通过。

## 改动范围

### src/main.js

| 位置 | 改动 | 行数 |
|------|------|------|
| `switchTab` 开头 | 加 `_switching` 锁，渲染中忽略后续调用 | +4 行 |
| `switchTab` 末尾 | 解锁（含异常情况兜底） | +2 行 |
| tab click handler | 加 300ms throttle/debounce | +3 行 |
| `escapeHtml` 函数 | 替换为纯字符串替换实现 | 全替换 ~6 行 |
| `switchTab` 末尾 | rAF 日志测量加 `finally` 式解锁 | +1 行 |

### src/styles.css

| 位置 | 改动 |
|------|------|
| `.panel` | 删除 `will-change: opacity` |
| `.panel.active` | 新增 `will-change: opacity` |

### 不动的内容

- 所有功能逻辑（时间转换、存档备份、待办、日志）— 不改
- 面板 HTML 结构 — 不改
- Rust 后端 — 如需加 WebView2 参数，另议

## 验证方案

1. `cargo tauri build` 构建 release 版本
2. 快速连点不同 tab 20 次 → 不卡顿
3. 在日志面板查看 TabSwitch PERF 记录，确认无重叠调用
4. 回归测试各面板功能正常
5. Chrome DevTools 附加 WebView2 → Layers 面板确认只有 1 个合成层

## 约束记录（实施后纳入 LESSONS.md）

详见 LESSONS.md 新增章节。
