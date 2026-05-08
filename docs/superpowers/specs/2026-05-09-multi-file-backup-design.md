# 存档文件多选支持 — 设计文档

日期：2026-05-09

## 概述

存档位（Slot）从关联单个文件改为关联多个文件，备份时一次性打包保存全部文件，每个文件独立哈希，恢复时多文件可选择。

## 数据结构变更

### SlotConfig（`src/main.rs`）

- `file_path: String` → `file_paths: Vec<String>`（`#[serde(default)]`）

### meta.json

旧格式：
```json
{
  "original_file_path": "D:/saves/save.dat",
  "content_hash": "abc123",
  "display_name": "...",
  "description": "..."
}
```

新格式：
```json
{
  "display_name": "...",
  "description": "...",
  "files": {
    "save.dat": {
      "original_path": "D:/saves/save.dat",
      "content_hash": "abc123"
    },
    "config.ini": {
      "original_path": "D:/saves/config.ini",
      "content_hash": "def456"
    }
  }
}
```

向后兼容：读取旧 meta.json 时检测 `original_file_path` 字段存在即转换为新格式。

### 前端状态（`src/main.js`）

- `filePathBySlot: { "gameId:slotId": "path" }` → `filePathsBySlot: { "gameId:slotId": ["path1", "path2"] }`
- `currentHashBySlot: { "gameId:slotId": "hash" }` → `currentHashesBySlot: { "gameId:slotId": { "file.dat": "hash" } }`

## 后端变更（`src/main.rs`）

### compute_hash

签名改为接收多路径，返回 `HashMap<String, String>`（文件名→哈希）。单文件直接用该文件，多文件各自独立计算。

### create_backup

- 遍历 `file_paths`，逐个计算 MD5
- 全部文件复制到备份文件夹
- 去重：取最新备份，逐一比对每个文件的哈希，全部相同才拒绝（"存档未变化"）
- meta.json 写入新 `files` 结构

### restore_backup

- 新增参数 `selected_files: Option<Vec<String>>`
- `selected_files` 为空：单文件直接恢复；多文件返回文件列表供前端弹窗
- `selected_files` 有值：只恢复选中的文件到各自原路径

### recompute_backup_hash

适配新 meta.json 格式，逐个文件重算并更新。

## 前端变更（`src/main.js` + `src/index.html`）

### 文件管理区域

标签式多文件管理，替代现有单个输入框：

- `.file-tags` 容器展示已选文件标签（可删除）
- "+" 按钮触发文件浏览对话框追加文件
- 浏览/重算按钮作用于全部文件

### 恢复弹窗

仅多文件备份时弹出，使用 modal 模式（复用 `.modal-overlay`）：

- 每行：checkbox + 文件名 + 原始路径
- 默认全选
- 确定 → 调用 restore_backup 传 selected_files

### 备份列表

哈希 badge 适配多文件显示（"多文件" 或首个文件名摘要）。

## CSS 变更（`src/styles.css`）

全部使用现有设计令牌，不新增 CSS 变量：

- `.file-tags` — flex-wrap 容器
- `.file-tag` / `.file-tag .tag-close` — 复用 `.slot-tag` 样式模式
- `.file-tag-add` — 虚线边框添加按钮
- `.restore-modal` — 复用 modal 模式
- `.restore-file-item` — 复选框 + 文件名 + 路径

## 边界情况

- 旧 meta.json 向后兼容（自动转换读取）
- 空文件列表时提示"请先添加文件"
- 文件不存在时的错误处理（备份/恢复/哈希各自处理缺失文件）
- 去重判断需所有文件哈希完全一致才算重复
