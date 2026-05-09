# 权限配置分层优化设计

## 概述

将 Claude Code 权限配置按职责分层：全局 `settings.json` 放通用规则，项目 `.claude/settings.local.json` 放项目特有规则。清理项目配置中累积的一次性临时条目。

## 现状问题

- 项目级 `.claude/settings.local.json` 累积了大量自动化加入的一次性命令（brainstorming 脚本路径、带 `-C` 的 git 变体等），共 24 条
- 路径风格不一致（`d:` vs `D:`，正斜杠 vs 反斜杠，有无引号）
- 缺少 `deny` 规则和 `defaultMode`
- 本应全局的条目（`WebSearch`）放在项目级

## 设计方案

### 分层架构

```
settings.json (全局，所有项目共享)
├── 基础工具权限 (Read / Grep / Glob / WebSearch)
├── 通用开发命令 (Bash(cargo build *) / Bash(cargo test *))
├── 基础 Git 操作 (Bash(git *))，破坏性操作由 deny 保护
├── defaultMode: acceptEdits
└── deny: 破坏性操作黑名单

.claude/settings.local.json (本项目)
├── Tauri 特有命令 (cargo tauri dev / build)
├── 项目特定命令 (cargo search:*, git push)
├── 超级力量文件访问 (Read(//c/Users/PC_WIN10/.claude/**))
└── 路径授权 (additionalDirectories)
```

### 全局 settings.json 变更

| 操作 | 原条目 | 新条目 | 原因 |
|------|--------|--------|------|
| 替换 | `Bash(npm run test)` | — | 非 Node 项目，不相关 |
| 替换 | `Bash(npm run lint)` | — | 同上 |
| 替换 | `Bash(npm run build)` | — | 同上 |
| 新增 | — | `Bash(cargo build *)` | 涵盖 build / check 等 |
| 新增 | — | `Bash(cargo test *)` | 运行测试 |
| 合并 | `Bash(git status)` / `git diff` / `git log` | `Bash(git *)` | 通配简化 |
| 移动 | `WebSearch` (项目级) | `WebSearch` | 提到全局 |

### 项目 settings.local.json 变更

**删除条目（临时一次性）：**

| 条目 | 原因 |
|------|------|
| `Bash(".../stop-server.sh" ...)` | brainstorming 脚本残留 |
| `Bash(".../start-server.sh" ...)` | brainstorming 脚本残留 |
| `Bash([ -f "$d/server-info" ])` | 超级力量内部脚本 |
| `Bash(mkdir -p ".../skills/..." )` | 目录已创建完成 |
| `Bash(git -C "d:/code/..." diff --stat)` | 全局 `git *` 已覆盖 |
| `Bash(git -C "d:/code/..." status)` | 同上一并去掉 |
| `Bash(git -C "d:/code/..." add ...)` | 同上 |
| `Bash(git -C "d:/code/..." commit ...)` | 同上 |
| `Bash(git -C "d:/code/..." log ...)` | 同上 |
| `Bash(git -C D:/... status)` | 同上 |
| `Bash(git -C D:/... diff ...)` | 同上 |
| `Bash(git -C D:/... log ...)` | 同上 |
| `Bash(git -C D:/... add ...)` | 同上 |
| `Bash(git -C D:/... commit ...)` | 同上 |
| `Bash(git log *)` | 全局 `git *` 已覆盖 |
| `Bash(git rev-parse *)` | 同上 |

**移动条目：**

| 条目 | 去向 | 原因 |
|------|------|------|
| `WebSearch` | 全局 settings.json | 通用工具，非项目特有 |

**保留条目：**

| 条目 | 说明 |
|------|------|
| `Bash(cargo search:*)` | 项目特有的包搜索需求 |
| `Bash(git push *)` | 推到远端需明确授权（非所有 `git` 场景） |
| `Read(//c/Users/PC_WIN10/.claude/**)` | 访问超级力量技能文件 |
| `additionalDirectories` | 维持不变 |

**新增条目：**

| 条目 | 说明 |
|------|------|
| `Bash(cargo tauri dev)` | 启动 Tauri 开发服务器 |
| `Bash(cargo tauri build)` | 构建生产版本 |

**补全新字段：**

- `deny` — 破坏性操作黑名单
- `defaultMode: "acceptEdits"` — 默认模式

### 最终项目配置

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

## 风险与注意事项

- **`Bash(git *)` 通配**依赖 deny 规则保护破坏性操作，deny 规则的 glob 匹配必须精确
- 项目级 `git push *` 依然保留，确保推送到远端始终需要明确授权
- 如果用户将来新增依赖（npm/pip 等），需要同步更新全局或项目权限
- 全局配置改动会影响所有项目，需确认用户全局配置的用途
