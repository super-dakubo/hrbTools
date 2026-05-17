# 极简玻璃风格重设计

## 概述

对 HRB Tools 进行 UI 重构，采用「极简玻璃」（Glass Minimal）设计语言。本次改造为纯 CSS + HTML 结构调整，**不改动任何功能逻辑**。

## 设计原则

1. **毛玻璃质感** — 用 `backdrop-filter: blur()` 和半透明背景营造层次
2. **减少视觉噪音** — 去除不必要的边框和背景色块
3. **浮动卡片化** — 面板内容包在统一卡片容器中，新增面板自动继承
4. **更大呼吸感** — 增加间距、圆角，降低信息密度
5. **风格统一** — 通过 CSS 变量体系保证所有组件一致，后续功能直接套用

## 具体变更

### 1. 颜色令牌（CSS 变量）

**新增/修改的变量：**

| 变量 | 暗色新值 | 亮色新值 | 说明 |
|------|---------|---------|------|
| `--bg` | `#1a1e2e` | `#f0f2f5` | 主背景加深/提亮 |
| `--surface` | `rgba(255,255,255,0.06)` | `rgba(255,255,255,0.7)` | 卡片底，带透明度用于 blur |
| `--glass-bg` | `rgba(255,255,255,0.04)` | `rgba(255,255,255,0.6)` | **新增** 毛玻璃面板背景 |
| `--glass-border` | `rgba(255,255,255,0.08)` | `rgba(0,0,0,0.06)` | **新增** 玻璃面板边框 |
| `--radius-xl` | `12px` → `16px` | 同左 | 弹窗增大 |
| `--radius-glass` | `14px` | `14px` | **新增** 玻璃卡片圆角 |

### 2. 标题栏

```
当前:
┌──────────────────────────────────────┐
│  HRB Tools              ⚙ ─ □ ✕     │

改造后:
┌──────────────────────────────────────┐
│  ● ● ●               HRB Tools      │  ← Mac 风格红黄绿圆点
│  红黄绿圆点(仅视觉效果)             │  ← 圆点仅装饰，窗口控制按钮保留文字
```

变更：
- 标题栏高度从 `8px 14px` padding → `6px 16px`
- 窗口控制按钮（最小化/最大化/关闭）仿 Mac 风格：红黄绿圆点 + 悬停显示图标
  - 关闭：红底（`#ff5f57`），悬停显示 ✕
  - 最小化：黄底（`#febc2e`），悬停显示 —
  - 最大化：绿底（`#28c840`），悬停显示 □
- `-webkit-app-region: drag` 移到标题栏空白区域，避开控制按钮

### 3. Tab 栏（左侧导航）

```
当前:                         改造后:
┌────────┐                   ┌──────┐
│  🕑    │                   │  🕑  │  ← 图标放大 1.8rem
│ 时间转 │                   │      │  ← 去掉文字标签
│  换    │                   │      │
│  💾    │                   │  💾  │  ← 激活态: 半透明白底 + 模糊
│ 存档管 │                   │      │
│  理    │                   │      │
│  ✅    │                   │  ✅  │
│ 待办工 │                   │      │
│  具    │                   │      │
│  📋    │                   │  📋  │
│  日志  │                   │      │
└────────┘                   └──────┘
```

变更：
- 宽度从 `80px` → `64px`
- 去掉 `.tab-label` 文字（hover 时用 `title` 属性显示 tooltip）
- 图标 `.tab-icon` 从 `1.5rem` → `1.8rem`
- Tab 圆角从 `10px` → `12px`
- 激活态：`background: rgba(255,255,255,0.08)` + `backdrop-filter: blur(4px)`
- 间距加大：`gap: 6px` → `gap: 10px`
- `.tab-bar` padding 从 `20px 12px` → `24px 8px`

### 4. 面板 → 玻璃卡片容器

新增 `.panel-inner` 包装层，每个面板内容包在其中：

```html
<div class="panel active" id="panel-convert">
  <div class="panel-inner">
    <!-- 原有内容 -->
  </div>
</div>
```

```css
.panel-inner {
  background: var(--glass-bg);
  border: 1px solid var(--glass-border);
  border-radius: var(--radius-glass);
  padding: 24px 28px;
  backdrop-filter: blur(12px);
  -webkit-backdrop-filter: blur(12px);
  height: 100%;
  overflow-y: auto;
}
```

此容器将所有面板内容统一包裹，确保：
- 一致的圆角、背景、内边距
- 毛玻璃效果
- 新增面板自动获得统一外观

`.panel` 本身的 `position: absolute` 定位保持不变（Tab 切换机制不动）。

**特殊处理：待办面板（`#panel-todo`）和日志面板（`#panel-log`）** 使用 flex 布局让列表占满剩余空间。`.panel-inner` 需要透传 flex 属性：

```css
#panel-todo.active .panel-inner,
#panel-log .panel-inner {
    display: flex;
    flex-direction: column;
    height: 100%;
}
#panel-todo .todo-list,
#panel-log .log-entries {
    flex: 1;
    min-height: 0;
}
```

`.panel` 本身保持 `overflow-y: auto`，`.panel-inner` 不设 overflow 避免嵌套滚动条。

### 5. 按钮

| 属性 | 当前 | 改造后 |
|------|------|--------|
| 主按钮 border-radius | `8px` | `24px`（胶囊） |
| 主按钮 padding | `0.65rem` | `0.55rem 1.8rem` |
| 小按钮 border-radius | `6px` | `16px` |
| 所有按钮 `:active` | `transform: scale(0.98)` | **去掉**，改为 `opacity: 0.9` |
| 按钮 hover 过渡 | `0.2s` | `0.15s` |

### 6. 输入框 + 选择框

| 属性 | 当前 | 改造后 |
|------|------|--------|
| border-radius | `8px` | `10px` |
| padding | `0.6rem 0.8rem` | `0.55rem 0.9rem` |
| focus 阴影 | `0 0 0 3px rgba(...)` | `0 0 0 2px rgba(...)` 更细 |

### 7. 弹窗（Modal）

| 属性 | 当前 | 改造后 |
|------|------|--------|
| border-radius | `12px` | `16px` |
| 背景 | `var(--bg)` | `var(--glass-bg)` |
| 添加 | — | `backdrop-filter: blur(16px)` |
| box-shadow | `0 12px 40px` | `0 24px 60px` 更重的阴影提升层次 |
| width | `400px` | `420px` 稍宽 |

### 8. 待办组件微调

- 待办项 `.todo-item` 圆角 `var(--radius)` → `10px`
- `todo-check` 圆圈略增大 `20px` → `22px`
- 已完成态勾选圆圈保留当前样式（accent 填充 + 白色勾）
- 优先级 badge 圆角加大

### 9. 开关（Toggle）

- 滑块从方改圆已具备
- 开启态背景改为带微透明，配合毛玻璃风格
- 过渡曲线保持 `cubic-bezier(0.34, 1.56, 0.64, 1)` 弹性效果

### 10. 加载遮罩

- spinner 尺寸 `44px` → `48px`
- 边框加粗 `4px` → `5px`
- 增加 `backdrop-filter: blur(4px)` 在遮罩上，透过模糊看到已加载的内容

### 11. 提醒横幅

- 红色背景保留（醒目），但圆角从 `0` → `6px`
- 左侧加 4px 彩色竖条代替全红背景
- 关闭按钮样式统一

## 不修改的内容

- Tab 切换机制（`_switchLock`、双重 rAF、300ms 防抖）
- 事件委托模式（`setupEventDelegation`）
- 所有功能逻辑（备份、待办、日志、时间转换、节假日）
- Rust 后端代码（main.rs）
- HTML 结构不变（仅添加 `.panel-inner` 包裹层）
- 启动加载流程

## 迁移策略

### 第 1 步：更新 CSS 变量表
- 修改 `styles.css` 的 `:root` 和 `body.light` 中的变量值
- 新增 `--glass-bg`、`--glass-border`、`--radius-glass` 变量
- 验证暗色/亮色切换

### 第 2 步：改造标题栏
- `index.html` 中替换窗口控制按钮为圆点样式
- 调整 `styles.css` 中 `.title-bar`、`.title-bar-btn` 样式
- 验证拖拽区域无冲突

### 第 3 步：改造 Tab 栏
- `styles.css` 更新 `.tab-bar`、`.tab`、`.tab-icon`、`.tab-label`
- `main.js` 的 `renderTabBar()` 中移除 `.tab-label` 渲染，添加 `title` 属性
- 验证拖拽排序正常

### 第 4 步：添加 `.panel-inner` 容器
- `styles.css` 新增 `.panel-inner` 类
- `index.html` 中 4 个面板各添加 `<div class="panel-inner">` 包裹
- 验证面板切换动画正常，无遮挡问题

### 第 5 步：组件样式微调
- 更新按钮、输入框、弹窗的圆角和间距
- 更新加载遮罩、横幅提醒
- 验证待办编辑弹窗、设置弹窗、恢复文件弹窗

### 第 6 步：全量验证
- 暗色/亮色切换
- 4 个面板内容无错位
- 所有按钮/输入框 hover/focus/active 状态
- 拖拽排序
- 窗口控制按钮 hover 效果

## 测试验证

1. 视觉对比：截图改造前后，确保每个面板内容无遗漏
2. 功能回归：备份、待办 CRUD、提醒、日志搜索、时间转换
3. 主题切换：暗色/亮色下所有组件样式正确
4. 极端情况：面板内容过长时滚动条样式、弹窗滚动

## 后续扩展（本 spec 不涉及）

- 动画过渡增强（面板切换、弹窗出现、提醒横幅滑入等动画进一步润色）
- 图标替换为 inline SVG 以获得更好的缩放和主题适配
