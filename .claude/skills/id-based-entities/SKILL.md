---
name: id-based-entities
description: 使用当要添加新实体（用户可编辑名称的对象）或修改游戏/存档位/时区套件的关联逻辑时。任何可改名的实体，关联关系必须用不可变 ID，不能用名称。
---

# ID 化实体关联规范

## 核心原则

**任何可改名的实体，关联关系必须用不可变 ID，不能用名称。**

通用原则（名称可变→关联断裂）已在 CLAUDE.md / LESSONS.md 中详述，此处只列实现模式。

## 数据结构模式

```rust
struct MyEntity {
    id: String,         // UUID，创建时生成，永不改变
    name: String,       // 用户可改名，仅用于 UI
}

// 目录路径用 ID
let dir = config.backup_root.join(&entity_id).join(&sub_id);

// 跨实体引用存 ID
struct Parent { child_ids: Vec<String> }  // 存子实体 UUID 列表
```

## 前端模式

```js
// 创建时生成 UUID
const id = crypto.randomUUID();

// 存储键用 ID，渲染用 name
map[id] = data;
element.dataset.id = entity.id;
element.textContent = entity.name;  // 展示 name 但操作传 id

// 跨实体引用：用 ID 拼接
const key = `${gameId}:${slotId}`;
```

## 现有实体参考

| 实体 | ID 字段 | 名称字段 | 说明 |
|------|---------|---------|------|
| 游戏 | `GameConfig.id` | `GameConfig.name` | UUID，备份目录用 `{game_id}` |
| 存档位 | `SlotConfig.id` | `SlotConfig.name` | UUID，备份目录用 `{slot_id}` |
| 时区套件 | `TimezoneSet.id` | 无独立 name | `"beijing"` 或 UUID |
| 待办 | `TodoItem.id` | `TodoItem.text` | UUID |
| 备份 | 无独立 id（文件夹名） | `folder_name` | 含时间戳不可变 |
