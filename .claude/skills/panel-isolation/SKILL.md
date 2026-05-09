---
name: panel-isolation
description: 使用当要修改 src/main.js 时。此文件包含三个独立功能面板的代码，修改其中一个绝不能动其他面板的代码。曾因此出过数据丢失事故。
---

# main.js 面板隔离规则

## 概述

`src/main.js` 包含三个完全独立的功能面板，共用同一个文件但没有任何共享状态或逻辑。修改一个面板时，绝不能改动其他面板的任何代码。

## 三个面板

| 面板 | 核心函数 | HTML 容器 |
|------|---------|----------|
| 时间转换 | `renderTimezoneSets`, `saveTimezoneValues`, `restoreTimezoneValues`, `initTimezoneDefaults` | `#timezoneSets` |
| 存档管理 | `renderGameTabs`, `renderSlotTabs`, `renderFileTags`, `refreshBackupList` | `#gameTabs`, `#slotTabs`, `#fileTags`, `#backupList` |
| 待办工具 | `renderTodos`, `openTodoEditModal`, `toggleTodoDone` | `#todoList` |

## 规则

1. 修改前用 `// ====================` 分隔注释定位目标区块
2. **只改目标面板的区块内的代码**，不碰其他面板的任何行
3. 共用工具函数（`escapeHtml`, `setButtonLoading`, `shortenPath`）在 `// ==================== 工具函数 ====================` 区块中，修改时需确认两端兼容
4. 代码审查必须 diff 对比原始文件，确认未改动的区块确实未被触碰

## 禁止

- 在修改存档管理时，**不能删除或修改**时间转换或待办面板的代码
- 在修改待办面板时，**不能删除或修改**时间转换或存档管理的代码
- 反之亦然

## 已知事故

2026-05-09：修改存档管理时，子代理意外删除了时间转换面板的多个函数，导致输入值丢失、清空按钮消失。

## 实施步骤

1. 打开 `src/main.js`，用分隔注释定位目标区块
2. 只修改目标区块内的代码
3. 提交前用 `git diff` 检查是否改动了非目标区块
4. 如有意外改动，立即撤销
