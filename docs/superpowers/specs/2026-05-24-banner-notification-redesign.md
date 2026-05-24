# 横幅通知系统重新设计

## 问题

当前横幅仅用于待办提醒，存在三个问题：

1. **紧耦合**：`BannerEntry` 包含 `todo_id`，其他模块无法推送通知
2. **样式单一**：全部使用红色危险色，无法区分通知类型
3. **位置占用**：内联在标题栏与内容区之间，挤压内容空间
4. **无自动清理**：横幅永久存在，直到用户手动关闭

## 设计目标

- 解耦为通用通知系统，任意模块可推送通知
- 按类型区分视觉样式（信息/成功/警告/错误）
- 右上角浮动 Toast，不占内容布局空间
- 自动消失机制，减少用户操作负担
- 通知中心收纳历史通知，可回溯

## 数据模型

```rust
// Rust 端 — 通用通知条目
enum NotificationLevel {
    Info,
    Success,
    Warning,
    Error,
}

struct BannerEntry {
    id: String,               // 唯一标识
    level: NotificationLevel, // 通知级别，决定颜色和自动消失时长
    source: String,           // 来源模块："提醒"、"备份"、"截图"、"系统"
    title: String,            // 标题
    message: String,          // 完整内容
    created_at: i64,          // 创建时间戳（毫秒）
    auto_dismiss: bool,       // false = 错误级别不自动消失
    read: bool,               // 是否已读（通知中心标记）
}
```

对比当前模型：

| 字段 | 当前 | 新设计 |
|------|------|--------|
| `id` | ✅ | ✅ |
| `todo_id` | ✅ 紧耦合 | ❌ 删除 |
| `text` | ✅ 纯文本 | ❌ 拆为 title + message |
| `created_at` | ✅ | ✅ |
| `level` | ❌ 无 | ✅ 新增 |
| `source` | ❌ 无 | ✅ 新增 |
| `auto_dismiss` | ❌ 无 | ✅ 新增 |
| `read` | ❌ 无 | ✅ 新增 |

## 推送接口

```rust
// Rust 端 — 全局函数，任意模块调用
fn push_notification(
    app: &tauri::AppHandle,
    level: NotificationLevel,
    source: &str,
    title: &str,
    message: &str,
);
```

```js
// JS 端 — 供无法走 Rust 推送到前端场景
function pushNotification(level, source, title, message);
```

Rust 端推入 `config.banners` 并持久化；JS 端推入 `currentConfig.banners` + `saveConfigToBackend()`。两路最终都经过 `renderBanners()` 渲染。

## 自动消失规则

| 级别 | 自动消失时长 | 备注 |
|------|-------------|------|
| `Success` | 30 秒 | 如"备份完成" |
| `Info` | 5 分钟 | 如"检测到新截图" |
| `Warning` | 2 小时 | 如"磁盘空间不足" |
| `Error` | 不消失 | 如"备份失败"，必须手动关闭 |

实现机制：

- `renderBanners()` 启动时，遍历 `currentConfig.banners`，对每条 `auto_dismiss = true` 且已超时的条目自动移除并保存
- 新推送的横幅在 JS 端设置 `setTimeout`，到期后自动移除。`setTimeout` 之前清除同 `id` 的旧定时器
- 同一个横幅的定时器 ID 存储在 `Map<bannerId, timerId>`，防止 `loadConfig()` 重新拉取配置时重复设置
- 用户鼠标悬停在 Toast 上时，`clearTimeout` 暂停倒计时；鼠标离开后重新设置
- 自动消失前 3 秒显示"即将消失"提示（在 Toast 底部显示剩余秒数）

## UI 布局

```
┌─────────────────────────────────────────────────┐
│ HRB Tools              🔔(3)  ═══  ───  ✕     │ ← 标题栏右上角铃铛图标
│                               ┌────────────────┐│
│                               │ ✅ 备份完成     ││ ← Toast 堆叠区
│                               │ 30秒后自动消失  ││    (右上角，最多3条)
│                               ├────────────────┤│
│                               │ ⚠️ 磁盘空间不足 ││
│                               │ 请及时清理      ││
│                               └────────────────┘│
│ ┌────────┐ ┌───────────────────────────────────  │
│ │ Tab 栏  │ │ 内容面板                         │
│ │         │ │                                   │
│ └────────┘ │                                    │
└─────────────────────────────────────────────────┘
```

### Toast 样式

- 浮动定位：`position: fixed` 或 `absolute`，`top: 44px`（标题栏下方），`right: 16px`
- 玻璃背景：`backdrop-filter: blur(12px)`，跟随暗色/亮色主题
- 左边框颜色按级别区分：Info 蓝色 / Success 绿色 / Warning 黄色 / Error 红色
- 来源标签：小圆角 badge，如 `备份`、`提醒`、`截图`
- 单条高度紧凑：约 44px（含 padding），标题一行，自动消失倒计时一小行
- 进场动画：从右侧滑入 `translateX(20px) → translateX(0)`，`opacity: 0 → 1`
- 消失动画：淡出 + 上移收缩

### Toast 去重合并

同一 `source` + 同一 `title` 的内容合并为一条，显示的 `message` 追加计数后缀（如 "备份完成 (×2)"）。

最多同时显示 3 条 Toast。超出 3 条时：

- 顶部显示一条"还有 N 条通知"的汇总条（浅灰色，点击展开通知中心）
- 超出部分仅存在 `config.banners` 中，在通知中心可查看

### 通知中心（铃铛下拉面板）

标题栏右上角铃铛图标：

- 未读数 = `banners.filter(b => !b.read).length`
- 点击展开下拉面板（位于铃铛下方）
- 面板宽度 340px，最大高度 300px，内部可滚动
- 按 `created_at` 倒序排列
- 每条显示：图标 + 来源名 + 标题 + 时间（相对时间，如"5 分钟前"）
- 点击"全部已读"标记所有为已读
- 每条右侧有 × 关闭按钮
- 点击面板外部区域关闭面板
- 面板本身带入场/出场动画（淡入 + 向下展开）

### 提醒线程适配

提醒线程创建横幅时，改为：

```rust
push_notification(app, NotificationLevel::Info, "提醒", "⏰ " + text, "");
```

不再手动构造 `BannerEntry`。

## 兼容与迁移

旧配置中已有的 `banners` 数组包含 `todo_id` 和 `text` 字段。JS 端 `loadConfig()` 中做一次迁移：

```js
currentConfig.banners = (currentConfig.banners || []).map(function(b) {
    if (b.todo_id !== undefined && b.level === undefined) {
        return {
            id: b.id,
            level: 'Info',
            source: '提醒',
            title: b.text,
            message: '',
            created_at: b.created_at || Date.now(),
            auto_dismiss: true,
            read: false,
        };
    }
    return b;
});
```

Rust 端 `BannerEntry` 用 `#[serde(default)]` 保证旧格式能反序列化。

## 实现步骤

1. Rust：修改 `BannerEntry` 结构体，添加新字段，`#[serde(default)]` 保证向后兼容。添加 `push_notification()` 函数
2. Rust：适配提醒线程调用 `push_notification()` 替代手动构造
3. JS：`loadConfig()` 中旧格式迁移
4. JS：`renderBanners()` 重写为右上角 Toast 浮层
5. JS：标题栏添加铃铛图标 + 通知中心下拉面板
6. JS：自动消失定时器逻辑（含 hover 暂停）
7. CSS：Toast 新样式（玻璃背景、按级别分色、动画）、通知中心下拉面板

## 未纳入范围

- 通知偏好设置（每个模块/级别可选开关）— 后续扩展
- 系统通知与横幅通知同步 — 提醒线程已有独立系统通知（notify-rust），维持现状
- 通知历史持久化清理策略 — 暂不限制历史条数，后续按数量或天数清理
