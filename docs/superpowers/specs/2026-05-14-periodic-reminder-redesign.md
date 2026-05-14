# 周期提醒 UI 改造设计

## 概述

改造待办编辑弹窗的提醒时间输入，让不同重复类型使用对应的专用输入控件，而非统一的 `datetime-local`。

## 影响范围

| 文件 | 改动程度 |
|------|---------|
| `src/main.js` | 中等 — `openTodoEditModal` 的弹窗逻辑 + 保存计算逻辑 |
| `src/main.rs` | 小 — `ReminderConfig` 加字段 + `monthly` push 逻辑分支 |
| `src/index.html` | 无 |
| `src/styles.css` | 可能微调 |

## 数据模型

`ReminderConfig` 增加 `day_mode` 字段，仅用于 `monthly` 类型：

```rust
#[derive(Debug, Serialize, Deserialize, Clone)]
struct ReminderConfig {
    #[serde(default)]
    datetime: String,         // "%Y-%m-%dT%H:%M" 下次触发完整时间
    #[serde(default)]
    sound: bool,
    #[serde(default)]
    day_mode: String,         // "fixed" | "last" | "second_last" | "third_last"
}
```

默认 `""` 等价于 `"fixed"`，向后兼容已有数据。

## UI 输入控件

### 不重复（repeat = null）
保持不变：`<input type="datetime-local">` 日期+时间

### 每天（repeat = "daily"）
`<input type="time">` 仅时分

### 每周（repeat = "weekly"）
星期X 下拉 + `<input type="time">`
星期映射：1=周一 ... 7=周日

### 每月（repeat = "monthly"）
日号下拉 + `<input type="time">`
日号选项：1, 2, ..., 28, 29, 30, 31, 最后一天, 倒数第二天, 倒数第三天

## 前端保存计算逻辑（openTodoEditModal 保存时）

函数 `calculateNextReminder(repeat, time, dayOfWeek, dayOfMonth, dayMode)`:

### daily
```
target = today HH:mm
if target <= now:
    target = tomorrow HH:mm
```

### weekly
```
target = next {dayOfWeek} HH:mm from now
// findNextWeekday 用 Date 计算
```

### monthly — fixed
```
target = thisMonth {dayOfMonth} HH:mm
if target <= now:
    target = nextMonthClamped(dayOfMonth) HH:mm
```
clamp 规则与 chrono `checked_add_months` 一致，用 JS 的 `new Date(year, month+1, 0)` 获取月天数后 min。

### monthly — last
```
thisMonthLast = lastDayOf(thisMonth) HH:mm
if thisMonthLast <= now:
    nextMonthLast = lastDayOf(nextMonth) HH:mm
```

### monthly — second_last / third_last
```
target = lastDayOf(thisMonth) - (N-1) days HH:mm
if target <= now:
    target = lastDayOf(nextMonth) - (N-1) days HH:mm
```

## 后端变化

### ReminderConfig 反序列化

`day_mode` 有 `#[serde(default)]`，旧数据自动补为 `""`。

### 每月 push 逻辑（main.rs reminder thread）

```rust
if let Some(repeat) = &todo.repeat {
    let day_mode = reminder.day_mode.as_str();
    let next_dt = match (repeat.as_str(), day_mode) {
        ("daily", _) => reminder_dt + Duration::days(1),
        ("weekly", _) => reminder_dt + Duration::days(7),
        ("monthly", "last") => {
            // 下个月最后一天
            let next_month = reminder_dt + Months::new(1);
            let last_day = last_day_of_month(next_month);
            NaiveDateTime::new(last_day, reminder_dt.time())
        }
        ("monthly", "second_last") => {
            let next_month = reminder_dt + Months::new(1);
            let last_day = last_day_of_month(next_month);
            NaiveDateTime::new(last_day - Days::new(1), reminder_dt.time())
        }
        ("monthly", "third_last") => {
            let next_month = reminder_dt + Months::new(1);
            let last_day = last_day_of_month(next_month);
            NaiveDateTime::new(last_day - Days::new(2), reminder_dt.time())
        }
        ("monthly", _) => { // fixed
            reminder_dt.checked_add_months(Months::new(1)).unwrap_or(reminder_dt)
        }
        _ => reminder_dt,
    };
}
```

Last day 辅助函数：
```rust
fn last_day_of_month(dt: NaiveDate) -> NaiveDate {
    let month = dt.month();
    if month == 12 {
        NaiveDate::from_ymd_opt(dt.year() + 1, 1, 1).unwrap() - Days::new(1)
    } else {
        NaiveDate::from_ymd_opt(dt.year(), month + 1, 1).unwrap() - Days::new(1)
    }
}
```

## 边界情况验证

| 场景 | 预期 |
|------|------|
| daily, 14:30, 当前 14:00 | 今天 14:30 → 触发后推明天 |
| daily, 14:30, 当前 15:00 | 明天 14:30 |
| weekly, 周三, 当前周一 | 本周三 |
| weekly, 周三, 当前周四 | 下周三 |
| monthly fixed 31, 5月 | 5月31 → 触发后 chrono 到 6月30（已接受）|
| monthly last, 5月 | 5月31 → 触发后 6月30 → 7月31 |
| monthly last, 6月 | 6月30 → 触发后 7月31 |
| monthly second_last, 3月(31天) | 3月30 → 触发后 4月29 |
| 修改提醒类型（daily→weekly）| 按新类型重新计算 |
| 修改提醒时间 | 基于 now 重新计算 |
| day_mode 默认值 | `""` 等价 `"fixed"`，旧数据兼容 |
| due_date 字段 | 不变，不受影响 |

## 不做的事

- 不改 due_date 的逻辑和 UI
- 不改通知系统的整体架构（环形缓冲区、轮询机制）
- 不处理 DST（已有问题，不在此范围）
- 不改 existing reminder push 的 debounce 逻辑
