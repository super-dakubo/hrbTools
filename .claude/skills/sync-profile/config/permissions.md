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
