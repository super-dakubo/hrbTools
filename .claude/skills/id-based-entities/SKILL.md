---
name: id-based-entities
description: 使用当要添加新实体（用户可编辑名称的对象）或修改游戏/存档位/时区套件的关联逻辑时。任何可改名的实体，关联关系必须用不可变 ID，不能用名称。
---

# ID 化实体关联规范

## 核心原则

**任何可改名的实体，关联关系必须用不可变 ID，不能用名称。**

名称是可变的（用户可改名），一旦改名：
- 磁盘目录找不到了 → 备份列表消失
- 内存键对不上了 → 文件路径丢失
- 配置引用了不存在的名称 → 数据断裂

## 正确 vs 错误做法

| 场景 | 错误（用名称） | 正确（用 ID） |
|------|---------------|---------------|
| 选择游戏 | `selectedGame = "塞尔达"` | `selectedGameId = "uuid-xxx"` |
| 备份目录路径 | `backup_root/塞尔达/存档1/` | `backup_root/{game_id}/{slot_id}/` |
| 前端键 | `filePathBySlot["塞尔达:存档1"]` | `filePathBySlot["uuid:uuid"]` |
| 配置文件关联 | 用名称数组 | 用 ID |

## 规则

1. **任何用户可编辑名称的实体**，必须有不可变 ID（UUID）
2. 目录路径、存储键、跨实体引用**一律用 ID**
3. `name` 只用于 UI 展示，**不作为关联依据**
4. 前端用 `crypto.randomUUID()` 生成 ID
5. Rust 后端存 `String` 类型即可（UUID 格式）

## 实现模式

### 数据结构

```rust
struct MyEntity {
    id: String,         // UUID，创建时生成，永不改变
    name: String,       // 用户可改名
    // 其他字段...
}
```

### 前端

```js
// 创建时生成 UUID
const entityId = crypto.randomUUID();

// 存储键用 ID
memoryMap[entityId] = data;

// 渲染时显示 name，但操作时传 ID
element.dataset.entityId = entity.id;
element.textContent = entity.name;
```

### 后端路径

```rust
let dir = config.backup_root
    .join(&entity_id)    // 用 ID，不用 name
    .join(&sub_entity_id);
```

## 现有实体参考

| 实体 | ID 字段 | 名称字段 | 备注 |
|------|---------|---------|------|
| 游戏 | `GameConfig.id` | `GameConfig.name` | UUID |
| 存档位 | `SlotConfig.id` | `SlotConfig.name` | UUID |
| 时区套件 | `TimezoneSet.id` | 无独立 name（timezone 做标识） | "beijing" 或 UUID |
| 待办 | `TodoItem.id` | `TodoItem.text`（内容） | UUID |
| 备份 | 无独立 id（用文件夹名） | `folder_name` | 含时间戳不可变 |
