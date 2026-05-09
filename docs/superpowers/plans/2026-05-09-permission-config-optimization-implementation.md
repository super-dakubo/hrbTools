# 权限配置分层优化实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 将 Claude Code 权限配置按职责分层，清理项目配置中的临时残留。

**Architecture:** 修改两个 JSON 配置文件：全局 `settings.json` 改为通配 + cargo 命令，项目 `settings.local.json` 精简为仅本项目特有条目并补全 missing 字段。

**Tech Stack:** JSON 配置

---

### Task 1: 修改全局 settings.json

**Files:**
- Modify: `C:\Users\PC_WIN10\.claude\settings.json`

- [ ] **Step 1: 替换 npm 命令为 cargo 命令，合并 git 条目**

将 `permissions.allow` 数组中的：
```
- Bash(npm run test)
- Bash(npm run lint)
- Bash(npm run build)
- Bash(git status)
- Bash(git diff)
- Bash(git log)
```
替换为：
```
- Bash(cargo build *)
- Bash(cargo test *)
- Bash(git *)
```

- [ ] **Step 2: 在 allow 中添加 WebSearch**

在 `permissions.allow` 数组中添加 `"WebSearch"`。

- [ ] **Step 3: 验证配置 JSON 格式正确**

```bash
python -c "import json; json.load(open(r'C:\Users\PC_WIN10\.claude\settings.json')); print('OK')"
```
期望输出：`OK`

- [ ] **Step 4: Commit**

```bash
git -C "d:\code\hello_world" add .
git -C "d:\code\hello_world" commit -m "chore: update global permissions - cargo, git wildcard, WebSearch"
```

---

### Task 2: 重写项目 settings.local.json

**Files:**
- Modify: `d:\code\hello_world\.claude\settings.local.json`

- [ ] **Step 1: 将项目配置文件替换为精简版本**

原内容（24 条 allow 条目 + 无 deny/defaultMode）替换为新内容：

```json
{
  "permissions": {
    "allow": [
      "Bash(cargo search:*)",
      "Bash(cargo tauri dev)",
      "Bash(cargo tauri build)",
      "Bash(git push *)",
      "Read(//c/Users/PC_WIN10/.claude/**)"
    ],
    "deny": [
      "Bash(rm -rf /)",
      "Bash(git push --force)",
      "Bash(git reset --hard)"
    ],
    "defaultMode": "acceptEdits",
    "additionalDirectories": [
      "C:\\Users\\PC_WIN10\\.claude",
      "d:\\code\\hello_world\\.claude\\skills"
    ]
  }
}
```

- [ ] **Step 2: 验证 JSON 格式正确**

```bash
python -c "import json; json.load(open(r'd:\code\hello_world\.claude\settings.local.json')); print('OK')"
```
期望输出：`OK`

- [ ] **Step 3: 验证全局和项目配置的差异符合预期**

```bash
python -c "
import json
g = json.load(open(r'C:\Users\PC_WIN10\.claude\settings.json'))
p = json.load(open(r'd:\code\hello_world\.claude\settings.local.json'))
ga = set(g['permissions']['allow'])
pa = set(p['permissions']['allow'])
print('Global only:', ga - pa)
print('Project only:', pa - ga)
print('Overlap (should be empty):', ga & pa)
"
```
期望输出：
- Global only: 包含 `WebSearch`, `Bash(cargo build *)`, `Bash(cargo test *)`, `Bash(git *)` 等
- Project only: 包含 `Bash(cargo tauri dev)`, `Bash(cargo tauri build)` 等
- Overlap: 空（无重复条目）

- [ ] **Step 4: Commit**

```bash
git -C "d:\code\hello_world" add .claude/settings.local.json
git -C "d:\code\hello_world" commit -m "chore: clean project permissions - remove temp entries, add tauri commands, add deny/defaultMode"
```
