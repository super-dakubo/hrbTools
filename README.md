# HRB Tools

Windows 桌面工具箱 — 时间转换、游戏存档备份、待办工具、本地日志，基于 Tauri 2.0。

## 截图

| 时间转换 | 存档管理 | 待办工具 |
|---------|---------|---------|
| ![时间转换](screenshots/timezone.png) | ![存档管理](screenshots/backup.png) | ![待办工具](screenshots/todo.png) |

![操作演示](screenshots/demo.gif)

> 截图和 GIF 待补充。可用截图工具截取后放入 `screenshots/` 目录，替换上述路径。

## 功能

- **时间转换** — 多时区时间转换，支持 Unix 时间戳互转，支持夏令时（美/欧/澳）
- **游戏存档备份** — 多游戏/多存档位管理，哈希校验，备份恢复/重命名/置顶/重算哈希
- **待办工具** — 待办增删改，优先级筛选，重复周期（日/周/月），提醒通知
- **日志** — 本地日志记录（全部级别写入文件），搜索/筛选，自动加载历史

## 下载

[![GitHub Release](https://img.shields.io/github/v/release/super-dakubo/hrbTools)](https://github.com/super-dakubo/hrbTools/releases/latest)

从 [GitHub Releases](https://github.com/super-dakubo/hrbTools/releases/latest) 下载最新安装包（`.msi` 或 `*-setup.exe`），安装即用。

> 发布方式：`cargo tauri build` 生成安装包后，用 `gh release create v0.1.0 target/release/bundle/nsis/*.exe target/release/bundle/msi/*.msi` 上传。

## 开发

### 技术栈

- **前端** — 原生 HTML/CSS/JS（无 npm / 无打包器）
- **后端** — Rust + Tauri 2.0
- **窗口** — 960×720 无边框，自定义标题栏

### 构建

```bash
# 开发模式
cargo tauri dev

# 生产构建
cargo tauri build

# 仅编译 Rust
cargo build
```

> 修改前端文件（`.html` / `.css` / `.js`）后需重启或按 Ctrl+R 刷新 WebView。

## 项目结构

```
src/
  index.html      HTML 骨架，4 面板 + 设置弹窗
  styles.css      CSS 变量主题（暗色/亮色）+ 全部样式
  main.js         全部前端逻辑，// === 分隔为 Tab/时间转换/存档/待办/日志 五区块
  main.rs         全部 Rust 逻辑，28 个 Tauri 命令

docs/
  ARCHITECTURE.md  数据结构、命令列表、持久化等详细参考
  design-system.md 颜色令牌、排版、组件标准、主题规则
  LESSONS.md       项目踩坑记录

screenshots/       截图和演示 GIF
```

## 许可

MIT
