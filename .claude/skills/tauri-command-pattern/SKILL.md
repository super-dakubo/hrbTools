---
name: tauri-command-pattern
description: 使用当要添加新的 Tauri 命令时。涉及 Rust 端定义命令函数、前端 IPC 调用、命名约定（camelCase vs snake_case）、注册到 generate_handler! 等规范。
---

# Tauri 命令添加规范

## 概述

在 Tauri 2.0 项目中添加新命令需要遵循 4 步流程，注意 Tauri 宏与 serde 的命名差异。

## 命名约定

| 层级 | 格式 | 示例 |
|------|------|------|
| 命令参数名（`invoke` 顶层 key） | **camelCase** | `game_name` → `invoke('xxx', { gameName: ... })` |
| 结构体字段（嵌套对象 / 返回值） | **snake_case** | `backup_root`、`file_paths` |
| 无下划线字段 | 两种一致 | `success`、`message` |

## 命令函数规范

```rust
#[tauri::command]
fn my_command(app: tauri::AppHandle, param1: String, param2: i32) -> OpResult {
    // 使用 app 访问文件系统或配置
    // 写操作返回 OpResult { success, message }
    OpResult { success: true, message: "操作成功".to_string() }
}
```

- 读操作直接返回数据，写操作统一返回 `OpResult { success: bool, message: String }`
- 需要配置文件时通过 `load_config(&app)` / `save_config(&app, &config)`

### `AppHandle` vs `tauri::State`

| 方式 | 适用场景 | 示例 |
|------|---------|------|
| `app: tauri::AppHandle` | 函数需要 `load_config`、`save_config` 或读写文件路径（通过 `app.path()`） | 绝大多数 CRUD 命令 |
| `state: tauri::State<'_, MyState>` | 全局单例状态（如数据库连接池），在 `setup()` 中用 `app.manage()` 注册 | 跨请求共享数据 |

**本项目当前只需要 `tauri::AppHandle`**（所有状态通过 config.json 持久化，无需 `State`）。只在引入全局共享资源时再用 `State`。

## 请求/响应结构体

对于复杂参数，定义请求结构体：

```rust
#[derive(Debug, Serialize, Deserialize)]
struct MyRequest {
    field_one: String,  // snake_case
    field_two: i32,
}
```

## 注册命令

在 `main()` 的 `invoke_handler` 中添加：

```rust
.invoke_handler(tauri::generate_handler![
    // ... 现有命令 ...
    my_command,
])
```

## 前端调用

```js
const result = await invoke('my_command', {
    paramName: 'value', // camelCase！
    paramCount: 42,
});
```

## 完整示例

```rust
// Rust 后端
#[derive(Debug, Serialize, Deserialize)]
struct MyRequest {
    item_name: String,
    item_value: i32,
}

#[tauri::command]
fn process_item(app: tauri::AppHandle, request: MyRequest) -> OpResult {
    let config = load_config(&app);
    // ... 处理逻辑 ...
    save_config(&app, &config);
    OpResult { success: true, message: "处理成功".to_string() }
}
```

```js
// 前端
const result = await invoke('process_item', {
    request: { itemName: 'test', itemValue: 42 }
});
```
