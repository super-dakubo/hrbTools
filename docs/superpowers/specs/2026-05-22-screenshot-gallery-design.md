# 截图画廊面板 — 设计规格

> 新 Tab「截图」 — 第 6 面板，浏览和管理游戏截图。
> 基于 Steam 截图目录结构和米哈游（原神/星穹铁道/绝区零）固定截图路径做深度检测。

---

## 1. 面板位置

新增第 6 个 Tab **「截图」**，放在 Tab 栏**待办之后、日志之前**：

```
[时间转换] [存档管理] [待办] [截图] [日志] [设置]
```

切换机制复用现有 `.panel` 的 `position: absolute` + `opacity` 系统，不需要任何架构改动。

---

## 2. 数据结构

### 2.1 ScreenshotSource（AppConfig 新增）

```rust
struct ScreenshotSource {
    id: String,                // UUID
    name: String,              // 显示名，如 "Steam - 艾尔登法环"
    path: String,              // 文件夹路径
    game_id: Option<String>,   // 可选关联到备份系统中的游戏
    sort_order: i32,           // 排序
}
```

- `path` 是唯一真相来源，不建数据库/缓存
- `game_id` 可选，关联后来源采用游戏名，卡片显示游戏徽标
- 删除来源仅移除配置，不删文件

### 2.2 ScreenshotEntry（运行时数据，不持久化）

```rust
struct ScreenshotEntry {
    file_name: String,         // 文件名
    path: String,              // 完整路径
    modified: String,          // 修改时间 "YYYY-MM-DD HH:mm"
    size: u64,                 // 文件大小（字节）
    source_id: String,         // 所属来源 ID
    game_name: Option<String>, // 关联的游戏名（前端展示用）
}
```

每次进入面板或切换来源时实时扫描返回，不存配置。

---

## 3. Rust 端命令

### 3.1 `scan_screenshots`

```
命令: scan_screenshots(sourcePath: string) → Vec<ScreenshotEntry>
```

- 递归扫描指定目录
- 过滤图片格式：`png`, `jpg`, `jpeg`, `webp`, `bmp`, `gif`
- 返回文件名、路径、修改时间、大小
- 按修改时间降序排列（最新在前）
- 大目录（>500 文件）限时 2 秒返回前 N 条，避免主线程卡顿

### 3.2 `get_screenshot_base64`

```
命令: get_screenshot_base64(path: string) → string
```

- 读取图片文件，编码为 base64
- 不做缩放（WebView 自动处理显示大小）
- 返回 `data:image/png;base64,...` 格式字符串
- 单次调用缓存 5 秒避免频繁大文件读取

### 3.3 `detect_screenshot_sources`

```
命令: detect_screenshot_sources() → Vec<DetectedSource>
```

- 扫描已知平台的截图来源
- **Steam**: 检测 `Steam/userdata/*/760/remote/*/screenshots/`，尝试读取 `screenshots.vdf` / `libraryfolders.vdf` 解析 appid → 游戏名；或通过 `steamapps/common/*.acf`  获取已安装游戏名。回退时用 `appid` 自身。
- **米哈游**: 检测三个游戏文档目录是否存在，统计图片数量
- 返回检测结果供前端渲染快速添加对话框

```rust
struct DetectedSource {
    name: String,          // 自动识别的名称
    path: String,          // 目录路径
    count: u32,            // 图片数量
    source_type: String,   // "steam" / "mihoyo" / "custom"
}
```

### 3.4 `add_screenshot_source`

```
命令: add_screenshot_source(name: string, path: string, gameId?: string) → OpResult
```

### 3.5 `remove_screenshot_source`

```
命令: remove_screenshot_source(id: string) → OpResult
```

### 3.6 `delete_screenshot`

```
命令: delete_screenshot(path: string) → OpResult
```

- 调用 `std::fs::remove_file`
- 失败返回错误消息

---

## 4. 前端 UI

### 4.1 面板布局

```
┌─ 顶部信息栏 ──────────────────────────────────────┐
│  📷 游戏截图          共 42 张 · 占用 128 MB       │
├─ 工具栏 ───────────────────────────────────────────┤
│  [▼ 选择来源]  [‹ ›]  [🔍 搜索...]  [+ 添加]  [🔄]│
├─ 缩略图网格 (auto-fill, minmax(200px, 1fr)) ──────┤
│  ┌──────┐ ┌──────┐ ┌──────┐ ┌──────┐              │
│  │ 缩略  │ │ 缩略  │ │ 缩略  │ │ 缩略  │            │
│  │ 图 1  │ │ 图 2  │ │ 图 3  │ │ 图 4  │            │
│  ├──────┤ ├──────┤ ├──────┤ ├──────┤              │
│  │ 文件名│ │ 文件名│ │ 文件名│ │ 文件名│            │
│  │ 日期  │ │ 日期  │ │ 日期  │ │ 日期  │            │
│  └──────┘ └──────┘ └──────┘ └──────┘              │
│  ┌──────┐ ┌──────┐ ┌──────┐                        │
│  │ ...  │ │ ...  │ │ ...  │                        │
│  └──────┘ └──────┘ └──────┘                        │
└────────────────────────────────────────────────────┘
```

### 4.2 卡片交互

| 交互 | 行为 |
|------|------|
| 点击卡片 | 打开 Lightbox 大图预览 |
| 悬停 | 右上角出现操作按钮组（打开文件夹 / 删除） |
| 删除 | 弹窗确认后再删 |
| 卡片信息 | 文件名（溢出省略）+ 修改日期 |

**游戏关联徽标** — 卡片左上角显示关联游戏名标签（如"🎮 艾尔登法环"）

### 4.3 Lightbox 大图预览

- 全屏遮罩，深色半透明背景 + `backdrop-filter: blur(8px)`
- 大图居中，max 85vw/85vh
- 键盘 ← → 切换，ESC 关闭
- 底部页码显示：`3 / 12 张`
- 点击遮罩背景关闭

### 4.4 空状态

首次进入无来源时，居中显示引导文案 + "添加文件夹"按钮。

### 4.5 添加来源对话框

```
┌─ 添加截图来源 ──────────────────────────┐
│                                           │
│  ┌─ 自定义文件夹 ──────────────────────┐  │
│  │  [📁 浏览...] 选择任意截图文件夹     │  │
│  └──────────────────────────────────────┘  │
│                                           │
│  ── 快速添加 ──                            │
│                                           │
│  检测到以下截图来源：                       │
│                                           │
│  Steam (8 款游戏, 共 124 张)  [展开 ▼]    │
│    ☑ 艾尔登法环               (32 张)     │
│    ☑ 黑神话：悟空             (28 张)     │
│    ☐ 博德之门3                (18 张)     │
│                                           │
│  米哈游:                                    │
│    ☑ 原神  C:/.../ScreenShots  (42 张)   │
│    ☐ 星穹铁道  C:/.../        (18 张)     │
│    ☐ 绝区零                    未检测到   │
│                                           │
│  [添加所选]                                 │
└───────────────────────────────────────────┘
```

### 4.6 搜索

- 实时按文件名过滤（客户端，在已扫描结果中匹配）
- 不发起新扫描

---

## 5. 实现约束

### 5.1 依赖

- **新增 Rust 依赖：`base64 = "0.22"`**（读图用 `std::fs::read`，base64 编码用此 crate 的 `Engine::encode`）
- **前端无新依赖** — 缩略图直接用 `<img src="data:image/...">` 显示
- 命令返回值格式：`data:image/{ext};base64,{encoded}` 前端可直接赋值给 `<img src>`

### 5.2 安全

- `scan_screenshots`、`get_screenshot_base64`、`delete_screenshot` 的参数必须经过 `sanitize_path_component()` 防止路径穿越
- 图片文件类型通过扩展名白名单过滤（`.png`, `.jpg`, `.jpeg`, `.webp`, `.bmp`, `.gif`），不依赖 MIME 检测

### 5.3 性能

- 单来源超过 500 张时，`scan_screenshots` 设 2 秒超时返回前 N 条
- `get_screenshot_base64` 单次调用缓存 5 秒（同一文件不重复读盘）
- Lightbox 中预加载前后各 1 张（`<link rel="preload">`）

### 5.4 Tab 切换

- 截图面板完全遵循 Tab 切换的四条性能约束（执行锁、合成层、escapeHtml、防抖）
- 首次切到截图 Tab 时触发 `scan_screenshots`，后续切换只刷新已缓存数据

### 5.5 事件模型

- 新面板的全部事件绑定走 `setupEventDelegation()`
- `data-action` 属性前缀：`screenshot-*`（如 `screenshot-open`, `screenshot-delete`, `screenshot-prev`, `screenshot-next`）
- 新 action 直接在 `setupEventDelegation` 中添加，不新建 `addEventListener`

### 5.6 CSS

- 截图面板样式放在 `styles.css` 末尾，以 `.panel-screenshot` 前缀隔离
- 网格卡片、Lightbox 遮罩、工具栏样式复用现有设计令牌（`--surface`, `--glass-bg`, `--accent` 等）
- 新增语义 CSS 变量（如需）：`--lightbox-overlay`（预览遮罩色）
- 禁止硬编码色值

### 5.7 图片加载限制

由于 Tauri 安全策略限制（CSP），从文件系统加载图片不能直接用 `<img src="file:///path">`。必须通过 Rust 端读取后以 base64 `data:` URI 形式传递给前端。

小优化：`get_screenshot_base64` 返回的 base64 在内存中缓存，避免同一张图片在网格 + Lightbox 中被读取两次。

---

## 6. 文件修改清单

| 文件 | 改动量 | 说明 |
|------|--------|------|
| `src/main.rs` | +~150 行 | 新增 ScreenshotSource 结构体，6 个 Tauri 命令，config 读写扩展，`generate_handler!` 注册 |
| `src/main.js` | +~400 行 | 新增截图面板区块（渲染、交互、Lightbox），配置更新，来源管理，事件委托扩展 |
| `src/styles.css` | +~150 行 | 截图面板样式（网格、卡片、Lightbox、对话框、工具栏），`index.html` 新增 1 个面板容器 |
| `src/index.html` | +~30 行 | 新增截图面板 HTML 骨架，Tab 图标 |

---

## 7. 后续可扩展

- **多选** — 按住 Ctrl/Shift 多选截图，批量删除/导出
- **大图缩放** — Lightbox 中滚轮缩放原图
- **截图关联备份** — 在备份面板显示截图数量角标
- **子文件夹导航** — 对深目录结构支持浏览子目录
- **GIF 支持** — 动画预览（需解析 GIF 帧数）
