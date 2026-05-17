---
name: panel-isolation
description: 使用当要修改 src/main.js 时。此文件包含四个独立功能面板的代码（时间转换/存档管理/待办工具/日志面板），修改其中一个绝不能动其他面板的代码。曾因此出过数据丢失事故。
---

# main.js 面板隔离规则

## 概述

`src/main.js` 包含多个独立的功能面板，共用同一个文件但**没有任何共享状态或逻辑**。修改一个面板时，绝不能改动其他面板的任何代码。

## 独立面板（4 个）

每个面板有独立的渲染函数、数据逻辑和事件处理，互不依赖：

| 面板 | 核心函数 | HTML 容器 | 代码区块 |
|------|---------|----------|---------|
| 时间转换 | `renderTimezoneSets`, `saveTimezoneValues`, `restoreTimezoneValues`, `initTimezoneDefaults` | `#timezoneSets` | `=== 时间转换 ===` |
| 存档管理 | `renderGameTabs`, `renderSlotTabs`, `renderFileTags`, `refreshBackupList` | `#gameTabs`, `#slotTabs`, `#fileTags`, `#backupList` | `=== 配置管理 ===` ~ `=== 恢复文件选择弹窗 ===` |
| 待办工具 | `renderTodos`, `openTodoEditModal`, `toggleTodoDone` | `#todoList` | `=== 待办工具 ===` |
| 日志面板 | `renderLogPanel`, `bindLogPanelEvents`，IIFE `window.__log` | `#logPanel` | `=== 日志系统 ===` + `=== 日志面板渲染 ===` |

## 基础设施（非面板，所有面板共用）

这些区块不属于任何面板，修改时需注意兼容性：

| 区块 | 说明 |
|------|------|
| `=== 状态 ===` / `=== DOM 引用 ===` | 全局变量和 DOM 缓存 |
| `=== Tab 栏管理 ===` / `=== Tab 拖拽 ===` | Tab 切换 + 拖拽排序，跨面板 |
| `=== 设置弹窗 ===` / `=== 节假日管理 ===` | 全局设置，可能被任一面板触发 |
| `=== 按钮防重复 ===` / `=== 消息提示 ===` | 工具函数，所有面板共用 |
| `=== 工具函数 ===` | `escapeHtml`、时间格式化等 |
| `=== 事件委托 ===` | `setupEventDelegation()` 一次性绑定 |
| `=== 启动 ===` | `DOMContentLoaded` 分步初始化

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
