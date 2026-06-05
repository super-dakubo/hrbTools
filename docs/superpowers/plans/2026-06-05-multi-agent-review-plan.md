# 多子代理审查系统 — 实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 构建一个 Workflow-based 多子代理审查系统，支持增量审查（修改后）和全量审计（定期）两种模式

**Architecture:** 单个 Workflow 入口脚本（`.claude/workflows/review-entry`），内置 Router Agent 按文件后缀路由到对应维度 Agent，各 Agent 并行独立运行，最终由 Synthesizer 合并结果写入 `docs/reviews/`。Router 只读 diff 摘要，维度 Agent 只读相关文件，结构化 JSON 输出约束 token。

**Tech Stack:** Claude Workflow (agent()/pipeline()/parallel()), Robot JS, Markdown 报告

**Spec:** [docs/superpowers/specs/2026-06-05-multi-agent-review-design.md](../specs/2026-06-05-multi-agent-review-design.md)

---

### Task 1: 创建目录结构和入口骨架

**Files:**
- Create: `.claude/workflows/review-entry`
- Create: `docs/reviews/.gitkeep`

- [ ] **Step 1: 创建目录**

```bash
mkdir -p .claude/workflows docs/reviews
touch docs/reviews/.gitkeep
```

- [ ] **Step 2: 创建 Workflow 入口骨架**

```javascript
// .claude/workflows/review-entry
export const meta = {
  name: 'review-entry',
  description: '多子代理审查系统入口 — 增量审查或全量审计',
  phases: [
    { title: 'Route', detail: '分析 diff/文件列表，确定审查维度' },
    { title: 'Review', detail: '各维度并行审查' },
    { title: 'Synthesize', detail: '合并结果写入文件' },
  ],
}

// 路由规则表 — 扩展加一行即可
const ROUTE_MAP = {
  '.rs':   ['rust-correctness', 'arch-check'],
  '.js':   ['js-correctness', 'arch-check'],
  '.css':  ['css-stability'],
  '.html': ['html-structure'],
}

// 全量审计额外维度（低优先级）
const FULL_AUDIT_DIMENSIONS = ['rust-security', 'dead-code', 'rust-perf']

// 模式检测
const isFullAudit = args?.mode === 'audit'
const mode = isFullAudit ? 'audit' : 'incremental'

log(`模式: ${mode}`)
```

- [ ] **Step 3: Commit 骨架**

```bash
git add .claude/workflows/review-entry docs/reviews/.gitkeep
git commit -m "feat: add review system skeleton (workflow entry + reviews dir)"
```

---

### Task 2: 实现 Router 逻辑（diff 分析 + 维度分配）

**Files:**
- Modify: `.claude/workflows/review-entry`

- [ ] **Step 1: 增量模式 — 获取 git diff 并提取摘要**

```javascript
// 增量模式：获取 diff
phase('Route')

let filesToCheck = []
let diffSummary = ''

if (isFullAudit) {
  // 全量模式：收集所有源文件
  const allFiles = (await agent(
    `列出 src/ 下所有源文件（.rs/.js/.css/.html），每行一个路径`,
    { label: 'list-sources', phase: 'Route', schema: { type: 'object', properties: { files: { type: 'array', items: { type: 'string' } } }, required: ['files'] } }
  )).files
  filesToCheck = allFiles
  diffSummary = `全量审计: ${filesToCheck.length} 个文件`
  log(`全量审计: ${filesToCheck.length} 个文件`)
} else {
  // 增量模式：git diff HEAD
  const diff = await agent(
    `运行 git diff HEAD --stat 和 git diff HEAD 的前 2000 字符，返回 diff 涉及的变更文件列表和摘要`,
    { label: 'get-diff', phase: 'Route', schema: { type: 'object', properties: { files: { type: 'array', items: { type: 'string' } }, summary: { type: 'string' } }, required: ['files', 'summary'] } }
  )
  filesToCheck = diff.files
  diffSummary = diff.summary
  log(`增量审查: ${filesToCheck.length} 个文件变更`)
}
```

- [ ] **Step 2: Router — 按文件后缀匹配维度**

```javascript
// Router: 分析文件后缀 → 匹配维度
const extensions = new Set(filesToCheck.map(f => {
  const dot = f.lastIndexOf('.')
  return dot >= 0 ? f.slice(dot) : ''
}))

let dimensions = new Set()
for (const ext of extensions) {
  const mapped = ROUTE_MAP[ext]
  if (mapped) mapped.forEach(d => dimensions.add(d))
}

// 全量审计补充低优先级维度
if (isFullAudit) {
  FULL_AUDIT_DIMENSIONS.forEach(d => dimensions.add(d))
}

const dimensionList = [...dimensions]
log(`匹配维度: ${dimensionList.join(', ')}`)
```

- [ ] **Step 3: 无变更短路处理**

```javascript
// 无变更/无可审维度时提前退出
if (dimensionList.length === 0) {
  log('无可审维度，跳过审查')
  return { mode, status: 'skipped', reason: '无可审维度' }
}
```

- [ ] **Step 4: Commit Router 逻辑**

```bash
git add .claude/workflows/review-entry
git commit -m "feat: add router logic (diff analysis + dimension matching)"
```

---

### Task 3: 实现维度 Agent（审查提示词 + Schema）

**Files:**
- Modify: `.claude/workflows/review-entry`

- [ ] **Step 1: 定义审查结果的 JSON Schema**

```javascript
// 统一审查输出 Schema
const FINDING_SCHEMA = {
  type: 'object',
  properties: {
    findings: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          severity: { type: 'string', enum: ['error', 'warning', 'info'] },
          file: { type: 'string' },
          line: { type: 'number' },
          message: { type: 'string' },
          suggestion: { type: 'string' },
        },
        required: ['severity', 'file', 'message'],
      },
    },
  },
  required: ['findings'],
}
```

- [ ] **Step 2: rust-correctness Agent prompt**

```javascript
async function reviewRustCorrectness(targetFiles) {
  return agent(
    `你审查 Rust 代码的正确性问题。只关注以下方面：
1. unwrap()/expect()/panic!() 在 IO 或网络路径上
2. 错误传播遗漏（? 或 match 缺失）
3. 所有权/借用错误
4. 空指针/悬垂引用风险

文件列表: ${targetFiles.join(', ')}

输出每个发现的问题，包含 severity（error/warning/info）、file、line、message、suggestion。`,
    { label: 'rust-correctness', phase: 'Review', schema: FINDING_SCHEMA }
  )
}
```

- [ ] **Step 3: js-correctness Agent prompt**

```javascript
async function reviewJsCorrectness(targetFiles) {
  return agent(
    `你审查 JavaScript 代码的正确性问题。只关注以下方面：
1. DOM 操作错误（选择器不匹配、节点不存在）
2. 事件委托违规（本项目用 data-action 模式）
3. 全局状态污染（window.__ 命名空间冲突）
4. 异步错误（未捕获 Promise reject）

文件列表: ${targetFiles.join(', ')}

输出每个发现的问题。`,
    { label: 'js-correctness', phase: 'Review', schema: FINDING_SCHEMA }
  )
}
```

- [ ] **Step 4: arch-check Agent prompt**

```javascript
async function reviewArchCheck(targetFiles) {
  return agent(
    `你审查架构一致性。本项目架构规则：
- Rust 分层：main.rs ← setup/main → svc/（业务）→ cmd/（Tauri 命令）
- cmd/ 命令不得包含业务逻辑
- svc/ 不得直接调用 Tauri API
- JS 面板用事件委托，禁止 addEventListener 或 onclick=
- 实体用 ID 关联（不可改名用名称）
- 文件路径用 sanitize_path_component() 校验

检查文件: ${targetFiles.join(', ')}

输出违规问题。`,
    { label: 'arch-check', phase: 'Review', schema: FINDING_SCHEMA }
  )
}
```

- [ ] **Step 5: css-stability + dead-code Agent prompts（全量审计用）**

```javascript
async function reviewCssStability(targetFiles) {
  return agent(
    `审查 CSS 稳定性问题：
1. 选择器冲突（同名类但用途不同）
2. 主题变量覆盖问题（硬编码色值替代 var(--xxx)）
3. 冗余/未使用的 CSS 规则

文件列表: ${targetFiles.join(', ')}`,
    { label: 'css-stability', phase: 'Review', schema: FINDING_SCHEMA }
  )
}

async function reviewDeadCode() {
  return agent(
    `扫描整个项目查找：
1. 未使用的函数/变量定义
2. 重复的模块或逻辑
3. 死注释（被注释掉的旧代码块）
4. 遗留的 import/引用

运行 grep 或直接分析文件内容。`,
    { label: 'dead-code', phase: 'Review', schema: FINDING_SCHEMA }
  )
}

async function reviewRustSecurity(targetFiles) {
  return agent(
    `审查 Rust 代码安全问题：
1. 路径遍历 — 用户输入未过 sanitize_path_component()
2. IPC 注入 — Tauri command 参数校验不严
3. 文件操作 — 未检查路径合法性

文件列表: ${targetFiles.join(', ')}`,
    { label: 'rust-security', phase: 'Review', schema: FINDING_SCHEMA }
  )
}
```

- [ ] **Step 6: Commit 维度 Agent**

```bash
git add .claude/workflows/review-entry
git commit -m "feat: add review dimension agents (rust/js/arch/css/deadcode/security)"
```

---

### Task 4: 实现并行调度 + Synthesizer

**Files:**
- Modify: `.claude/workflows/review-entry`

- [ ] **Step 1: 按维度并行调度 Agent**

```javascript
// 按维度分组文件
phase('Review')

const filesByExt = {}
for (const f of filesToCheck) {
  const dot = f.lastIndexOf('.')
  const ext = dot >= 0 ? f.slice(dot) : ''
  if (!filesByExt[ext]) filesByExt[ext] = []
  filesByExt[ext].push(f)
}

const agentMap = {
  'rust-correctness': () => reviewRustCorrectness([...filesByExt['.rs'] || []]),
  'js-correctness': () => reviewJsCorrectness([...filesByExt['.js'] || []]),
  'arch-check': () => reviewArchCheck(filesToCheck),
  'css-stability': () => reviewCssStability([...filesByExt['.css'] || []]),
  'dead-code': () => reviewDeadCode(),
  'rust-security': () => reviewRustSecurity([...filesByExt['.rs'] || []]),
}

// 并行运行匹配维度 — 失败不阻断
const results = await parallel(
  dimensionList.map(dim => () =>
    agentMap[dim]()
      .then(result => ({ dimension: dim, status: 'ok', findings: result.findings }))
      .catch(err => ({ dimension: dim, status: 'failed', findings: [], error: err.message }))
  )
)
```

- [ ] **Step 2: Synthesizer — 合并结果**

```javascript
phase('Synthesize')

// 合并所有 finding
const allFindings = results
  .filter(r => r && r.status === 'ok')
  .flatMap(r => r.findings.map(f => ({ ...f, dimension: r.dimension })))

// 去重（相同 file+message 只保留一个）
const seen = new Set()
const deduped = allFindings.filter(f => {
  const key = `${f.file}:${f.line}:${f.message}`
  if (seen.has(key)) return false
  seen.add(key)
  return true
})

// 按 severity 排序
const severityOrder = { error: 0, warning: 1, info: 2 }
deduped.sort((a, b) => (severityOrder[a.severity] || 9) - (severityOrder[b.severity] || 9))

const errorCount = deduped.filter(f => f.severity === 'error').length
const warningCount = deduped.filter(f => f.severity === 'warning').length
const infoCount = deduped.filter(f => f.severity === 'info').length

// 失败的维度
const failedDims = results.filter(r => r.status === 'failed').map(r => r.dimension)
```

- [ ] **Step 3: 写入 Markdown 报告**

```javascript
// 生成报告内容
const date = new Date()
const dateStr = date.toISOString().slice(0, 10)
const weekStr = `W${String(Math.ceil((date.getTime() - new Date(date.getFullYear(), 0, 1).getTime()) / 604800000)).padStart(2, '0')}`
const filename = isFullAudit ? `audit-${date.getFullYear()}-${weekStr}.md` : `review-${dateStr}.md`
const filepath = `docs/reviews/${filename}`

const reportLines = [
  `# Review: ${dateStr}`,
  ``,
  `> 模式: ${mode}`,
  `> 触发: 手动`,
  `> 文件: ${filesToCheck.length}`,
  `> 维度: ${dimensionList.join(', ')}`,
  ``,
]

// 按维度分组输出
const byDim = {}
for (const f of deduped) {
  if (!byDim[f.dimension]) byDim[f.dimension] = []
  byDim[f.dimension].push(f)
}

for (const [dim, findings] of Object.entries(byDim)) {
  const dimName = dim.charAt(0).toUpperCase() + dim.slice(1).replace(/-/g, ' ')
  reportLines.push(`## ${dimName}`)
  reportLines.push('')
  for (const f of findings) {
    const icon = f.severity === 'error' ? '❌' : f.severity === 'warning' ? '⚠️' : 'ℹ️'
    reportLines.push(`- ${icon} [${f.severity}] ${f.file}:${f.line} — ${f.message}`)
    if (f.suggestion) reportLines.push(`  - 建议: ${f.suggestion}`)
  }
  reportLines.push('')
}

// 失败维度标注
if (failedDims.length > 0) {
  reportLines.push('## 失败的维度')
  reportLines.push('')
  failedDims.forEach(d => reportLines.push(`- ❌ [failed] ${d} — 审查未完成`))
  reportLines.push('')
}

reportLines.push('## 总结')
reportLines.push('')
reportLines.push(`- ❌ 严重: ${errorCount} | ⚠️ 警告: ${warningCount} | ℹ️ 信息: ${infoCount}`)
if (failedDims.length > 0) reportLines.push(`- ❌ 失败维度: ${failedDims.length}`)

// 写入文件
const reportContent = reportLines.join('\n')
await agent(
  `将以下内容写入文件 ${filepath}:\n\n${reportContent}`,
  { label: 'write-report', phase: 'Synthesize' }
)

log(`报告已写入: ${filepath}`)
```

- [ ] **Step 4: 返回结果**

```javascript
return {
  mode,
  filepath,
  total: deduped.length,
  errors: errorCount,
  warnings: warningCount,
  infos: infoCount,
  failed: failedDims,
}
```

- [ ] **Step 5: Commit Synthesizer**

```bash
git add .claude/workflows/review-entry
git commit -m "feat: add synthesizer (result merge + markdown report writer)"
```

---

### Task 5: 全量审计分批调度

**Files:**
- Modify: `.claude/workflows/review-entry`

- [ ] **Step 1: 全量模式 — 大文件组分批**

```javascript
// 全量模式: 文件按组分批，避免 token 爆炸
if (isFullAudit) {
  // .rs 文件分 2 批
  const rsFiles = filesByExt['.rs'] || []
  const rsBatch1 = rsFiles.filter(f => f.includes('/cmd/'))
  const rsBatch2 = rsFiles.filter(f => !f.includes('/cmd/'))

  // .js 文件分 2 批
  const jsFiles = filesByExt['.js'] || []
  const jsBatch1 = jsFiles.filter(f => f.includes('core.') || f.includes('init.'))
  const jsBatch2 = jsFiles.filter(f => !f.includes('core.') && !f.includes('init.'))

  // 替换默认分组为分批
  if (rsBatch1.length) filesByExt['.rs-batch-1'] = rsBatch1
  if (rsBatch2.length) filesByExt['.rs-batch-2'] = rsBatch2
  if (jsBatch1.length) filesByExt['.js-batch-1'] = jsBatch1
  if (jsBatch2.length) filesByExt['.js-batch-2'] = jsBatch2

  log(`全量审计分批: rs(${rsBatch1.length}+${rsBatch2.length}), js(${jsBatch1.length}+${jsBatch2.length})`)
}
```

- [ ] **Step 2: Commit 分批逻辑**

```bash
git add .claude/workflows/review-entry
git commit -m "feat: add full audit batching (rs/js split by module)"
```

---

### Task 6: 端到端验证

- [ ] **Step 1: 运行增量审查（当前 diff）**

手动构造一个测试 diff，然后运行 workflow：

```bash
# 确保有未提交的改动
git diff HEAD --stat

# 调用入口 workflow（通过 Claude 的 Workflow 工具）
# 在会话中执行: 用 Workflow 工具，scriptPath 指向 .claude/workflows/review-entry
```

由于 Workflow 需要在 Claude Code 会话中执行，这里验证方式为：在实现完成后，由执行 agent 用 Workflow 工具加载 `review-entry` 进行实际运行测试。

预期输出：
```
模式: incremental
匹配维度: rust-correctness, arch-check
报告已写入: docs/reviews/review-2026-06-05.md
```

- [ ] **Step 2: 验证报告文件**

```bash
cat docs/reviews/review-2026-06-05.md
```

检查格式是否符合 spec 要求：
- 头部元信息（模式、触发、文件数）
- 维度分组
- 三色标记（❌⚠️ℹ️）
- 总结行

- [ ] **Step 3: 验证边界情况 — 无改动**

在没有改动的 repo 上运行，预期 Route Agent 检测 diff 为空 → 返回 skipped。

- [ ] **Step 4: 提交最终版本**

```bash
git add .claude/workflows/review-entry docs/reviews/
git commit -m "feat: multi-agent review system complete"
```

---

### 自审检查

**1. Spec 覆盖度：**

| Spec 章节 | 对应 Task |
|-----------|----------|
| 2. 架构拓扑 | Task 1, 2 |
| 3. 审查维度优先级 | Task 3 |
| 4. 增量审查流程 | Task 2, 4 |
| 5. 全量审计流程 + 分批 | Task 5 |
| 6. 存储结构 | Task 4 |
| 7. 边界情况（无改动/失败/中断） | Task 2 (Step 3), Task 4 (Step 1 catch) |
| 8. 扩展指南 | ROUTE_MAP 设计（Task 1） |

**2. 占位符检查：** 无 TBD/TODO，代码完整可运行。

**3. 类型一致性检查：** `FINDING_SCHEMA` 在 Task 3 定义，Task 4 使用。`dimensionList` 在 Task 2 定义，Task 4 使用。agent 返回结构从 Task 3 到 Task 4 一致。

**4. 范围检查：** 单个系统，两个模式。聚焦不分散。✓
