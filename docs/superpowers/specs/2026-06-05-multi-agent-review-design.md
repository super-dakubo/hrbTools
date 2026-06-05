# 多子代理审查系统设计

> 日期：2026-06-05
> 状态：定稿
> 目标：为个人 Tauri 桌面项目（~9K LOC）建立 token 高效、可扩展的多子代理审查系统

## 1. 概述

基于 `Worflow` 工具实现的多子代理审查系统。个人 Windows 工具，token 消耗必须可控，扩展性要跟上项目增长。

### 核心约束

| 约束         | 说明                                                 |
| ------------ | ---------------------------------------------------- |
| 项目规模     | ~9K LOC（Rust 2800 + JS 3700 + CSS 2400 + HTML 200） |
| 平台         | Windows 仅限，Tauri 2.0 无边框桌面应用               |
| Token 优先级 | 个人项目，能省则省                                   |
| 扩展性       | 新文件类型/审查维度应一行路由规则搞定                |

## 2. 架构

### 拓扑

```text
入口 Workflow (.claude/workflows/review-entry)
    │
    ├── Router Agent ← 分析 git diff（增量）或文件列表（全量）
    │       │
    │       ├── 匹配 .rs  → rust-correctness, arch-check
    │       ├── 匹配 .js  → js-correctness, arch-check
    │       ├── 匹配 .css → css-stability
    │       └── 匹配 .html→ html-structure
    │
    └── 并行 spawn 维度 Agent（互不等待，失败不阻断）
            │
            └── Synthesizer → 合并去重 → docs/reviews/ 写文件
```

### 路由规则表

路由规则在 Workflow 脚本中以配置对象存在，扩展加一行即可：

```javascript
const ROUTE_MAP = {
  ".rs": ["rust-correctness", "arch-check"],
  ".js": ["js-correctness", "arch-check"],
  ".css": ["css-stability"],
  ".html": ["html-structure"],
};
```

### 两种模式对比

| 特性       | 增量审查               | 全量审计                           |
| ---------- | ---------------------- | ---------------------------------- |
| 触发       | `/review`              | `/audit`                           |
| 输入       | git diff HEAD          | 全部源文件                         |
| 路由逻辑   | 按 diff 文件后缀匹配   | 按全部文件后缀匹配                 |
| 维度       | 仅匹配的维度           | 全部维度 + 低优先级（死代码/安全） |
| 分批       | 不需要（diff 小）      | 大文件组分批（防 token 爆炸）      |
| Token 预计 | ~8K-20K                | ~30K-60K                           |
| 频率       | 每次修改后             | 每周/按需                          |
| 结果文件   | `review-YYYY-MM-DD.md` | `audit-YYYY-WW.md`                 |

## 3. 审查维度优先级

### 高（增量审查必做）

| 维度        | 覆盖文件       | 审查要点                                 |
| ----------- | -------------- | ---------------------------------------- |
| Rust 正确性 | `*.rs`         | unwrap/panic 路径、错误传播、所有权泄露  |
| JS 正确性   | `*.js`         | DOM 操作错误、事件委托违规、全局状态污染 |
| 架构一致性  | `*.rs`, `*.js` | 分层违规、cmd/svc 边界、面板隔离         |

### 中（全量审计含，增量看情况）

| 维度      | 覆盖文件 | 审查要点                                           |
| --------- | -------- | -------------------------------------------------- |
| Rust 安全 | `*.rs`   | 路径穿越、`sanitize_path_component` 遗漏、IPC 边界 |
| 死代码    | 全部     | 未使用函数、重复模块、遗留 import                  |

### 低（全量审计才跑）

| 维度       | 覆盖文件 | 审查要点                             |
| ---------- | -------- | ------------------------------------ |
| CSS 稳定性 | `*.css`  | 选择器冲突、类名不一致、主题变量覆盖 |
| Rust 性能  | `*.rs`   | 不必要 clone/allocation、热点路径    |
| 安全审计   | 全部     | 跨层注入、XSS 面                     |

## 4. 增量审查流程

```
1. git diff HEAD（合并 staged + unstaged）
2. Router Agent 接收 diff 摘要（前 2000 字符）
3. Router 输出 JSON：{"dimensions": [...], "files_to_check": [...]}
4. 按维度并行 spawn Agent（互不等待）
   - 各 Agent 只收到相关文件完整内容
   - Agent 输出结构化 JSON（严格 Schema）
5. Synthesizer 合并结果、去重、排序
6. 写入 docs/reviews/review-YYYY-MM-DD.md
```

### Token 优化点

- Router 只看 diff 摘要，不传完整 diff
- 各维度 Agent 只收到**相关文件内容**，不传无关文件
- Agent 输出用 JSON Schema 约束，减少自由生成 token
- Synthesizer 用结构化输出做合并，不用重新读全部文件

## 5. 全量审计流程

```
1. 收集 src/ 下全部文件
2. 按类型分组
3. 大文件组分批（防单次 token 爆炸）
4. 每批一个 Agent，并发跑
5. 包含完整维度（含低优先级）
6. 聚合 → 写入 docs/reviews/audit-YYYY-WW.md
```

### 分批策略

| 文件类型 | 总行数 | 分批策略                   | 每批预计 Token |
| -------- | ------ | -------------------------- | -------------- |
| .rs      | ~2800  | 2 批（cmd + svc/main）     | ~15K/批        |
| .js      | ~3700  | 2 批（core/init + panels） | ~15K/批        |
| .css     | ~2400  | 1 批                       | ~8K            |

## 6. 存储结构

```
docs/reviews/
├── review-2026-06-05.md    # 增量审查
├── review-2026-06-04.md
├── audit-2026-W23.md        # 全量审计
└── ...
```

### 单文件格式

```markdown
# Review: 2026-06-05

> 模式: incremental / audit
> 触发: 手动
> 耗时: 45s | Token: ~12K

## Rust 正确性

- ⚠️ [medium] src/cmd/backup.rs:142 — IO 路径未处理错误

## JS 正确性

- ✅ 所有改动符合事件委托模式

## 架构一致性

- ⚠️ [low] src/init.js — 新函数未加面板隔离注释

## 总结

- 严重: 0 | 警告: 2 | 信息: 1
```

## 7. 边界情况处理

| 场景              | 行为                                                    |
| ----------------- | ------------------------------------------------------- |
| 无改动时调用      | Router 检测 diff 为空 → "无变更" 直接退出，不启动 Agent |
| Agent 超时/失败   | 该维度标记 `[failed]`，不影响其他维度继续               |
| 全量审计中断      | 已完成维度写入文件，未完成标记 `[skipped]`              |
| 只改了一个文件    | 只触发匹配维度的 Agent，不启动无关维度                  |
| diff 涉及多种文件 | Router 合并所有匹配维度，去重后调度                     |

## 8. 扩展指南

### 加一个新审查维度

1. 在 Router prompt 的 ROUTE_MAP 加一条映射
2. 定义 Agent prompt 模板和输出 Schema
3. 在入口 Workflow 的维度列表中注册

示例：加 `.toml` 配置审查

```javascript
'.toml': ['config-consistency'],
```

### 加一种新文件类型

同上，只需映射到已有维度或新维度。

## 9. 不做的范围

- 不做自动 fix（审查只报告、不修复）
- 不做 CI 集成（个人项目纯手动触发）
- 不做 web UI（终端 + 文件存档即可）
- 不做与其他工具的联动
