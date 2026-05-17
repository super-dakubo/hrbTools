# sync-profile 实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 新建 `.claude/skills/sync-profile/` skill 目录，包含目录结构、SKILL.md 指令、profile/config/knowledge/scaffolds/scripts 全部文件，实现 init/pull/refresh 三个操作。

**Architecture:** Skill 目录即种子包，SKILL.md 定义 AI 执行步骤，PowerShell 脚本辅助文件合并/生成操作，.hbs 模板文件用于生成项目文档骨架。

**Tech Stack:** Markdown, JSON, PowerShell (Win10 自带), Claude Code Skill 机制

**Spec:** [docs/superpowers/specs/2026-05-10-sync-profile-design.md](../specs/2026-05-10-sync-profile-design.md)

---

### Task 1: 创建目录结构和 seed.yaml

**Files:**
- Create: `.claude/skills/sync-profile/seed.yaml`
- Create: `.claude/skills/sync-profile/.gitkeep` (保留空目录占位)

- [ ] **Step 1: 创建目录层级**

Run:
```bash
mkdir -p .claude/skills/sync-profile/profile
mkdir -p .claude/skills/sync-profile/config
mkdir -p .claude/skills/sync-profile/knowledge/common
mkdir -p .claude/skills/sync-profile/knowledge/rust
mkdir -p .claude/skills/sync-profile/knowledge/java/spring-boot
mkdir -p .claude/skills/sync-profile/scaffolds/rust-tauri
mkdir -p .claude/skills/sync-profile/scaffolds/generic
mkdir -p .claude/skills/sync-profile/scripts
```

- [ ] **Step 2: 创建 seed.yaml**

```yaml
# sync-profile 种子包版本
version: 1
created: 2026-05-10
updated: 2026-05-10
changelog:
  - version: 1
    what: "初始版本"
    files:
      - "SKILL.md"
      - "profile/personal.md"
      - "profile/coding.md"
      - "profile/workflow.md"
      - "config/global-settings.json"
      - "config/permissions.md"
      - "knowledge/common/debugging.md"
      - "knowledge/rust/tauri-pitfalls.md"
      - "scaffolds/rust-tauri/*"
      - "scaffolds/generic/*"
      - "scripts/*"
```

- [ ] **Step 3: 提交**

```bash
git add .claude/skills/sync-profile/seed.yaml
git commit -m "chore: init sync-profile directory structure"
```

---

### Task 2: 创建 profile/ 文件

**Files:**
- Create: `.claude/skills/sync-profile/profile/personal.md`
- Create: `.claude/skills/sync-profile/profile/coding.md`
- Create: `.claude/skills/sync-profile/profile/workflow.md`

**Source:** 从全局 `~/.claude/CLAUDE.md` 提取已有内容 + 补充结构

- [ ] **Step 1: 创建 personal.md**

```markdown
# 个人侧写

> 技术栈、经验、习惯、优劣势。供 AI 快速了解"你是谁"。

## 技术栈

- **主力语言：** Rust, Java, JavaScript
- **框架：** Tauri 2.0 (Rust), Spring Boot (Java)
- **桌面端：** Tauri 2.0 (Windows-only), 原生 HTML/CSS/JS
- **工具：** Claude Code, Git, VS Code, PowerShell

## 编码习惯

- 函数式优先，避免 class（除非框架要求）
- 变量命名语义化，不用缩写
- 提前返回减少嵌套，不写多余的 else
- 注释解释"为什么"，不解释"是什么"

## 工作习惯

- 修改前先看计划，确认了再动手
- 每次修改范围尽量小，不顺手改不相关的东西
- 遇到不确定的决策先问，不自己猜
- 完成后列出边缘情况

## 沟通偏好

- 使用中文思考和回答
- 简洁直接，不需要客套
- 复杂问题分步展示，不要一次性全抛过来
```

- [ ] **Step 2: 创建 coding.md**

```markdown
# 编码规范

> 通用编码约束，适用于任何语言/项目。项目特有规范放在项目 CLAUDE.md 中。

## 通用

- 函数式优先，避免 class（除非框架要求）
- 变量命名语义化，不用缩写
- 提前返回减少嵌套，不写多余的 else
- 注释解释"为什么"，不解释"是什么"

## 禁止行为（任何项目）

- 不要用 console.log 调试（用项目的 logger）
- 不要安装新依赖，先告知
- 不要修改 .env 或 secrets 文件

## AI 协作

- 做任何修改前先展示计划
- 修改范围尽量小，不碰不相关的东西
- 完成后列出边缘情况
```

- [ ] **Step 3: 创建 workflow.md**

```markdown
# AI 协作规则

> 涉及用户可见行为的设计决策必须确认。见 [LESSONS.md 相关章节]


## 必须确认的场景

以下场景 AI 容易不自觉替用户做决定，必须停下来问清楚再实现：

- **数据持久化** — 存什么内容、保留多久、清理策略
- **默认值** — 什么功能默认开启/关闭
- **错误处理** — 静默忽略、重试、还是弹窗提示
- **性能取舍** — 节流、采样、降级对用户是否透明

## 调试规则

### 一次只改一个变量

一次只改一个属性/变量，确认效果后再继续。同时改多个变量会导致不知道哪个生效、哪个破坏。遇到问题时先回退到已知正常状态，再逐个变量测试。

### 性能问题：先测量，不要猜

遇到性能问题（卡顿、慢），第一原则是先加计时埋点，用数据说话：

1. **加测量再问问题** — 在怀疑的路径上加 performance.now()（前端）或 std::time::Instant（后端）
2. **问对问题** — "什么操作慢？所有操作还是特定操作？" 而不是 "是不是 X 的问题？"
3. **拒绝接受未验证的理论** — 任何理论必须在有数据支撑时才能接受
4. **从最底层开始查** — 前端 JS 问题通常不会导致秒级延迟；如果是后端命令慢，直接在那加计时

## 权限配置原则

- **分层管理** — 通用权限放全局 settings.json，项目特有命令放项目 .claude/settings.local.json
- **通配优先** — 能用 `Bash(git *)` 就别逐条加
- **defaultMode** — 始终设为 acceptEdits，减少不必要的弹窗
- **复合命令**（&& 串联）按完整字符串匹配，建议分步执行
```

- [ ] **Step 4: 提交**

```bash
git add .claude/skills/sync-profile/profile/
git commit -m "feat(sync-profile): add profile/ files (personal, coding, workflow)"
```

---

### Task 3: 创建 config/ 文件

**Files:**
- Create: `.claude/skills/sync-profile/config/global-settings.json`
- Create: `.claude/skills/sync-profile/config/permissions.md`

**Source:** 从现有 `~/.claude/settings.json` 提取通用部分

- [ ] **Step 1: 创建 global-settings.json**

```json
{
  "permissions": {
    "allow": [
      "Read",
      "Grep",
      "Glob",
      "Bash(cargo *)",
      "Bash(git *)",
      "Bash(ls *)",
      "Bash(tail *)",
      "Bash(wc *)",
      "Bash(grep *)",
      "Bash(find *)",
      "Bash(mkdir *)",
      "WebSearch"
    ],
    "deny": [
      "Bash(rm -rf /)",
      "Bash(git push --force)",
      "Bash(git reset --hard)",
      "Bash(curl * | sh)",
      "Bash(sudo *)",
      "Bash(npm install -g *)",
      "Bash(chmod 777 *)"
    ],
    "defaultMode": "acceptEdits"
  }
}
```

- [ ] **Step 2: 创建 permissions.md**

```markdown
# 权限配置设计原则

## 分层管理

| 层级 | 文件 | 放什么 |
|------|------|--------|
| 全局 | `~/.claude/settings.json` | 通用命令：cargo/git/ls/tail 等 |
| 项目 | `.claude/settings.local.json` | 项目特有命令：taskkill、部署脚本 |

## 规则

- **通配优先**：能用 `Bash(git *)` 就别逐条加 `git status/diff/log`
- **破坏性操作放 deny**：rm -rf、force push、sudo、全局 npm install
- **defaultMode**：始终设为 `acceptEdits`
- **定期清理**：自动累积的一次性权限条目要及时清理
- **项目类型决定条目**：Rust 项目加 cargo 命令，Node 项目加 npm 命令，不混用

## 复合命令

权限系统按完整字符串匹配，不拆分 `&&` 或 `||`。
建议分步执行（每条命令各自匹配），不要写 `cmd1 && cmd2` 这种复合形式。
```

- [ ] **Step 3: 提交**

```bash
git add .claude/skills/sync-profile/config/
git commit -m "feat(sync-profile): add config/ files (settings template, permissions guide)"
```

---

### Task 4: 创建 knowledge/ 文件

**Files:**
- Create: `.claude/skills/sync-profile/knowledge/common/debugging.md`
- Create: `.claude/skills/sync-profile/knowledge/rust/tauri-pitfalls.md`

**Source:** 从项目 `docs/LESSONS.md` 提取通用调试经验 + Rust/Tauri 踩坑

- [ ] **Step 1: 创建 common/debugging.md（通用调试方法论）**

```markdown
# 调试方法论

> 适用于所有语言和项目。

## 性能问题：先测量，不要猜

遇到性能问题，第一原则是**先加计时埋点，用数据说话**。

1. **加测量再问问题** — 在怀疑的路径上加 performance.now()（前端）或 std::time::Instant（后端）
2. **问对问题** — "什么操作慢？所有操作还是特定操作？" 而不是 "是不是 X 的问题？"
3. **拒绝接受未验证的理论** — 任何理论必须在有数据支撑时才能接受
4. **从最底层开始查** — 前端 JS 问题通常不会导致秒级延迟；如果是后端命令慢，直接在那加计时

## 调试时一次只改一个变量

不管是 CSS 样式、业务逻辑还是配置，一次只改一个属性/变量，确认效果后再继续。同时改多个变量会导致不知道哪个生效、哪个破坏。遇到问题时先回退到已知正常状态，再逐个变量测试。

## 不猜根因，先定位

1. 加耗时埋点
2. 看数据确认瓶颈位置
3. 针对瓶颈修
4. 验证修复
```

- [ ] **Step 2: 创建 rust/tauri-pitfalls.md（Rust/Tauri 踩坑手册）**

```markdown
# Rust / Tauri 踩坑手册

> 适用于 Rust + Tauri 2.0 桌面应用开发。其他语言项目不需要此文件。

## Tauri 命名约定：命令参数 ≠ 结构体字段

Tauri 2.0 对两个层级的命名处理不同：

| 层级 | 格式 | 谁负责 | 示例 |
|------|------|--------|------|
| 命令参数名（invoke 顶层 key） | camelCase | Tauri 宏 | `game_name` → `invoke('xxx', { gameName: ... })` |
| 结构体字段（嵌套对象 / 返回值） | snake_case | serde 默认 | `AppConfig.backup_root` → `{ config: { backup_root: ... } }` |

**常见错误：**
- 把结构体字段也改成 camelCase → 前端读到 undefined
- 把命令参数写成 snake_case → Tauri 报 missing required key

## `#[tauri::command]` 缺失

**适用：** Tauri 2.x

每个 Tauri 命令函数必须有 `#[tauri::command]` 属性宏。漏掉会导致编译错误 `cannot find macro '__cmd__xxx'`。

## `load_*` 函数必须是只读的

名称为 `load_*` / `get_*` / `read_*` 的函数不能有副作用。

**反面案例：** `load_config()` 内部调用 `set_auto_start()`，后者执行 `reg.exe` 命令。
在无控制台窗口的 Tauri GUI 应用中，创建子进程有约 3.3 秒额外开销。
由于几乎所有操作都调 `load_config`，导致全互联通卡顿。

**修复：** 只读路径中移除写操作，只放在明确的写操作中执行。

## `window.__TAURI__` 不存在

**适用：** Tauri 2.10+

Tauri 2.10 已移除 `window.__TAURI__`，只有 `window.__TAURI_INTERNALS__`。

```js
// ❌ 错误
window.__TAURI__.core.invoke();

// ✅ 正确
const invoke = (cmd, args) => window.__TAURI_INTERNALS__.invoke(cmd, args);
```

## 禁止 ES 模块 import

项目无 package.json / 无打包器，前端是原生 HTML/JS/CSS。

```js
// ❌ 禁止
import { invoke } from '@tauri-apps/api/core';

// ✅ 必须
const invoke = (cmd, args) => window.__TAURI_INTERNALS__.invoke(cmd, args);
```

import 失败时整个 JS 不执行，表现为"所有按钮都没反应"。

## 不要配 devUrl

**适用：** 无外部 dev server 的项目

tauri.conf.json 中的 devUrl 会让 Tauri 尝试连接外部 dev server。
当前项目没有 dev server，配了会导致 cargo tauri dev 卡住。
删掉 devUrl，Tauri 会直接从 frontendDist（./src）提供文件。

## 实体关联用 ID，不要用名称

**适用：** 任何用户可改名的实体

任何可改名的实体，关联关系必须用不可变 ID（UUID），不能用名称。

| 场景 | 错误做法 | 正确做法 |
|------|---------|---------|
| 游戏/存档位标识 | selectedGame = "塞尔达" | selectedGameId = "uuid-xxx" |
| 备份目录路径 | backup_root/塞尔达/ | backup_root/{game_id}/ |
| 前端键 | filePathBySlot["塞尔达:存档1"] | filePathBySlot["uuid:uuid"] |

**为什么：** 名称可改，一旦改名→磁盘目录找不到、内存键对不上、数据断裂。

## crono-tz 内嵌全量时区数据库

**适用：** Release 构建中贡献约 2-3MB 静态数据。如果只用少数几个时区，全量时区库不值得。

**替代：** 用固定偏移 + 手动 DST 规则替代。美国/欧盟/澳洲的夏令时规则固定可算，几十行代码就能省 2-3MB。

## tab 切换性能：四条规则

**适用：** opacity 合成层切换 + innerHTML 渲染的面板式 UI

1. switchTab 必须有执行锁（_switchLock + 5 秒超时兜底）
2. will-change: opacity 只能加在 .panel.active（避免常驻 GPU 合成层）
3. escapeHtml 必须用纯字符串替换（不用 DOM 版，避免 GC 暂停）
4. Tab click handler 必须有防抖（300ms 内重复点击忽略）

**注意：** 开发机（独立显卡）可能掩盖问题，release 在用户集成显卡上才暴露。
```

- [ ] **Step 3: 提交**

```bash
git add .claude/skills/sync-profile/knowledge/
git commit -m "feat(sync-profile): add knowledge/ files (debugging common, tauri pitfalls)"
```

---

### Task 5: 创建 scaffolds/ 模板文件

**Files:**
- Create: `.claude/skills/sync-profile/scaffolds/rust-tauri/CLAUDE.md.hbs`
- Create: `.claude/skills/sync-profile/scaffolds/rust-tauri/LESSONS.md.hbs`
- Create: `.claude/skills/sync-profile/scaffolds/rust-tauri/settings.local.json.hbs`
- Create: `.claude/skills/sync-profile/scaffolds/generic/CLAUDE.md.hbs`

- [ ] **Step 1: 创建 rust-tauri/CLAUDE.md.hbs**

```markdown
# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

> **代码开发前必须阅读 [docs/LESSONS.md](./docs/LESSONS.md)** — 踩坑记录和硬性约束。
> **UI/样式修改前阅读 [docs/design-system.md](./docs/design-system.md)**（如存在）。
> **处理特定功能时阅读 [docs/ARCHITECTURE.md](./docs/ARCHITECTURE.md) 对应章节**（如存在）。
>
> ## 个人侧写
>
> 此项目已接入 sync-profile。你的个人侧写和协作规则来自：
> - `.claude/skills/sync-profile/profile/` — 编码规范、工作习惯
> - 全局 `~/.claude/settings.json` — 权限配置
> - `docs/LESSONS.md` — 跨项目经验沉淀

## 常用命令

- `cargo tauri dev` – 启动 Tauri 开发
- `cargo tauri build` – 生产构建
- `cargo build` – 仅编译 Rust 后端
- `cargo test` – 运行测试
- `taskkill /im tauri_dev.exe /f` – 强制终止 dev 进程

## 架构概述

<!-- 项目初始化后由 AI 填充架构概要，包括：-->
<!-- - 技术栈和框架版本 -->
<!-- - 源文件一览和各自职责 -->
<!-- - 核心数据流 -->
```

- [ ] **Step 2: 创建 rust-tauri/LESSONS.md.hbs**

```markdown
# 踩坑记录

> 本文件记录项目开发中遇到的 bug 和解决方案。**每次修改代码前先读一遍。**

<!-- sync-profile 在 init 时会根据语言和版本插入匹配的 knowledge 条目 -->
<!-- 项目特有的踩坑记录加在这个文件底部 -->

---

## 项目特有记录

<!-- 在此添加本项目独有的踩坑经历 -->
```

- [ ] **Step 3: 创建 rust-tauri/settings.local.json.hbs**

```json
{
  "permissions": {
    "allow": [
      "Bash(git push *)",
      "Bash(taskkill *)"
    ],
    "deny": [
      "Bash(rm -rf /)",
      "Bash(git push --force)",
      "Bash(git reset --hard)"
    ],
    "defaultMode": "acceptEdits"
  }
}
```

- [ ] **Step 4: 创建 generic/CLAUDE.md.hbs**

```markdown
# CLAUDE.md

This file provides guidance to Claude Code when working with code in this repository.

> **代码开发前必须阅读 [docs/LESSONS.md](./docs/LESSONS.md)** — 踩坑记录和硬性约束。
>
> ## 个人侧写
>
> 此项目已接入 sync-profile。你的个人侧写和协作规则来自：
> - `.claude/skills/sync-profile/profile/` — 编码规范、工作习惯
> - 全局 `~/.claude/settings.json` — 权限配置
> - `docs/LESSONS.md` — 跨项目经验沉淀

## 常用命令

<!-- 项目初始化后由 AI 填充构建/测试命令 -->

## 架构概述

<!-- 项目初始化后由 AI 填充 -->
```

- [ ] **Step 5: 提交**

```bash
git add .claude/skills/sync-profile/scaffolds/
git commit -m "feat(sync-profile): add scaffolds/ templates (rust-tauri, generic)"
```

---

### Task 6: 创建 PowerShell 辅助脚本

**Files:**
- Create: `.claude/skills/sync-profile/scripts/merge-settings.ps1`
- Create: `.claude/skills/sync-profile/scripts/generate-scaffold.ps1`

- [ ] **Step 1: 创建 merge-settings.ps1**

**功能：** 读取种子包的 global-settings.json，将其 permissions.allow/deny 数组追加到目标 ~/.claude/settings.json，不覆盖已有条目。

```powershell
param(
    [Parameter(Mandatory=$true)]
    [string]$SeedPath,
    [Parameter(Mandatory=$true)]
    [string]$TargetPath
)

# 读取种子包配置和当前用户配置
$seedJson = Get-Content "$SeedPath/config/global-settings.json" | ConvertFrom-Json
$currentJson = @{}
if (Test-Path $TargetPath) {
    $currentJson = Get-Content $TargetPath | ConvertFrom-Json
}

# 合并 allow 数组
$currentAllow = @()
if ($currentJson.permissions.allow) {
    $currentAllow = @($currentJson.permissions.allow)
}
$seedAllow = @($seedJson.permissions.allow)
$mergedAllow = $currentAllow + $seedAllow | Select-Object -Unique

# 合并 deny 数组
$currentDeny = @()
if ($currentJson.permissions.deny) {
    $currentDeny = @($currentJson.permissions.deny)
}
$seedDeny = @($seedJson.permissions.deny)
$mergedDeny = $currentDeny + $seedDeny | Select-Object -Unique

# 更新配置
if ($currentJson.permissions) {
    $currentJson.permissions.allow = $mergedAllow
    $currentJson.permissions.deny = $mergedDeny
} else {
    $currentJson | Add-Member -Name "permissions" -Value @{
        allow = $mergedAllow
        deny = $mergedDeny
        defaultMode = "acceptEdits"
    } -MemberType NoteProperty
}

# 写回
$currentJson | ConvertTo-Json -Depth 10 | Set-Content $TargetPath -Encoding UTF8

Write-Host "Merged permissions: $($mergedAllow.Count) allow, $($mergedDeny.Count) deny items"
```

- [ ] **Step 2: 创建 generate-scaffold.ps1**

**功能：** 读取 scaffolds/ 模板，替换占位符，写入目标项目目录。

```powershell
param(
    [Parameter(Mandatory=$true)]
    [string]$SeedPath,
    [Parameter(Mandatory=$true)]
    [string]$ProjectPath,
    [Parameter(Mandatory=$true)]
    [string]$ScaffoldType
)

$scaffoldDir = "$SeedPath/scaffolds/$ScaffoldType"
if (-not (Test-Path $scaffoldDir)) {
    Write-Error "Scaffold type '$ScaffoldType' not found at $scaffoldDir"
    exit 1
}

# 复制每个模板文件，去掉 .hbs 后缀
Get-ChildItem $scaffoldDir -Filter "*.hbs" | ForEach-Object {
    $targetName = $_.Name -replace '\.hbs$', ''
    $targetPath = "$ProjectPath/$targetName"
    $content = Get-Content $_.FullName -Raw
    
    # 确保目标目录存在
    $targetDir = Split-Path $targetPath -Parent
    if (-not (Test-Path $targetDir)) {
        New-Item -ItemType Directory -Path $targetDir -Force | Out-Null
    }
    
    Set-Content -Path $targetPath -Value $content -Encoding UTF8
    Write-Host "Generated: $targetPath"
}

Write-Host "Scaffold '$ScaffoldType' applied to $ProjectPath"
```

- [ ] **Step 3: 提交**

```bash
git add .claude/skills/sync-profile/scripts/
git commit -m "feat(sync-profile): add PowerShell scripts (merge-settings, generate-scaffold)"
```

---

### Task 7: 创建 SKILL.md（核心指令文件）

**Files:**
- Create: `.claude/skills/sync-profile/SKILL.md`

**SKILL.md 是整个 sync-profile 的核心**——它定义了 AI 在执行 `/sync-profile` 时的全部步骤。

- [ ] **Step 1: 创建 SKILL.md**

```markdown
# sync-profile — 可复制的开发者知识系统

> 把你的个人侧写、AI 协作规则、踩坑记录打包成可跨环境复制的种子包。
>
> 推荐先看使用说明（浏览器打开）：`docs/superpowers/specs/sync-profile-intro.html`（如存在）

## 目录结构

```
sync-profile/
├── SKILL.md                    ← 本文件
├── seed.yaml                   ← 版本号 + changelog
├── profile/                    ← 个人侧写（跨环境通用）
├── config/                     ← 全局配置模板
├── knowledge/                  ← 踩坑记录（按语言/版本分层）
├── scaffolds/                  ← 项目骨架模板
└── scripts/                    ← PowerShell 辅助脚本
```

## 通用流程

1. 每个操作执行前，先确认种子包路径（默认是自身所在 `.claude/skills/sync-profile/`）
2. 涉及文件写入时，先展示差异再执行
3. 操作完成后更新 seed.yaml 的 changelog

---

## 操作一：init — 新项目初始化

**触发：** 用户输入 `/sync-profile init`

**步骤：**

1. 确认种子包路径（默认即可）
2. 问用户：项目语言类型（rust / java / node / other）
3. 问用户：框架/版本（如 spring-boot-1.5、tauri 2.0）
4. 读取 `knowledge/`，按语言和版本过滤，生成 `docs/LESSONS.md`：
   - 只复制匹配语言的知识目录
   - 从匹配的条目中，按 `**适用：**` 标签过滤当前版本适用的条目
   - 不匹配版本的条目在 LESSONS.md 中用引用块标注"仅供参考"
   - 开头添加版本警告：
     ```
     > ⚠️ 此项目使用 {框架/版本}。标注了其他版本的条目仅供参考，以 `**适用：**` 标签为准。
     ```
5. 选择 scaffolds/ 模板：匹配语言则用对应模板，否则用 `generic/`
6. 用 PowerShell 脚本 `scripts/generate-scaffold.ps1` 生成项目骨架：
   ```
   powershell -File .claude/skills/sync-profile/scripts/generate-scaffold.ps1 \
     -SeedPath .claude/skills/sync-profile \
     -ProjectPath . \
     -ScaffoldType rust-tauri
   ```
7. 运行 `scripts/merge-settings.ps1` 合并全局 settings.json：
   ```
   powershell -File .claude/skills/sync-profile/scripts/merge-settings.ps1 \
     -SeedPath .claude/skills/sync-profile \
     -TargetPath ~/.claude/settings.json
   ```
8. 生成 `.claude/settings.local.json`（从 scaffolds 模板）
9. 告知用户已完成，列出生成了哪些文件

---

## 操作二：pull — 回收项目经验

**触发：** 用户输入 `/sync-profile pull`

**步骤：**

1. 读取项目 `docs/LESSONS.md`，提取所有踩坑条目
2. 读取种子包 `knowledge/` 对应分类文件（根据项目语言确定分类）
3. 逐条对比，识别新增条目（内容去重）
4. 对每条新条目：
   - **确认的**（同类问题、版本范围明确，有现有文件可归入）→ 准备自动归类，记录到操作清单
   - **不确定的**（版本不匹配、跨语言、需要新建分类文件）→ 停下来问用户：
     > "检测到 1 条新教训，无法确定归入哪个文件。内容是：{内容}。建议归入 {建议路径}，确认？"
5. 展示完整的操作清单（包含自动归类的条目和用户已确认的条目），让用户过目：
   > "以下条目将追加到种子包。有问题请指出，没问题 5 秒后执行。"
6. 用户确认后，追加到对应 `knowledge/` 文件
7. 如果 pull 过程新增了文件（如新建了 `java/spring-boot/1.0.md`），提示用户同步种子包到其他环境
8. 更新 `seed.yaml` changelog

---

## 操作三：refresh — 同步种子包更新

**触发：** 用户输入 `/sync-profile refresh`

**步骤：**

1. 读取种子包 `seed.yaml`，对比项目上次记录的版本（从 `docs/LESSONS.md` 元数据获取）
2. 如果没有版本记录，则认为是首次 refresh，全量覆盖
3. 检测 scaffolds/ 模板是否变更（对比文件名列表和内容 hash）
4. 如果模板变更：
   - **新增文件**（如 scaffolds 里多了 `REFERENCE.md.hbs`）→ 直接生成
   - **删除文件**（如 `ARCHITECTURE.md.hbs` 被移除）→ 询问用户是否删除项目对应文件
   - **内容变更**（模板内容修改）→ 展示 diff，确认后覆盖
5. 保留用户自定义内容：
   - `docs/LESSONS.md` 中用户手写的条目不动（只覆盖顶部的自动生成部分）
   - `.claude/settings.local.json` 中用户自定义的权限保留（追加不覆盖）
6. 更新 seed.yaml 版本记录到项目的 CLAUDE.md 或 LESSONS.md 元数据中
7. 告知用户本次 refresh 变更了什么
```

- [ ] **Step 2: 设置 SKILL.md 为只读（防止误修改）**

Run:
```bash
git add .claude/skills/sync-profile/SKILL.md
git commit -m "feat(sync-profile): add SKILL.md with init/pull/refresh instructions"
```

---

### Task 8: 更新项目 CLAUDE.md 引用 sync-profile

**Files:**
- Modify: `CLAUDE.md`（项目根目录）

- [ ] **Step 1: 在项目 CLAUDE.md 的技能列表中添加 sync-profile**

```markdown
> - `sync-profile` — 个人侧写/知识种子包，init/pull/refresh 操作
```

添加位置：在现有 skill 列表的最后一行。

- [ ] **Step 2: 提交**

```bash
git add CLAUDE.md
git commit -m "docs: register sync-profile in project skill list"
```
