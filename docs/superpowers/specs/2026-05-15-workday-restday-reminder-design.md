# 工作日/休息日分时提醒 + 节假日管理

## 概述

待办系统支持按工作日/休息日设置不同的提醒时间，并配套节假日管理功能。用户通过设置界面导入节假日数据（JSON），系统据此判定每天的"工作日/休息日"属性，决定使用哪个提醒时间。

---

## 一、数据结构

### AppConfig 新增

```rust
// 节假日配置，按年存储
holiday_data: Vec<HolidayYearConfig>,
```

### 新类型

```rust
struct HolidayYearConfig {
    year: i32,
    holidays: Vec<HolidayPeriod>,
    makeup_days: Vec<String>,   // ["MMdd"...]
}

struct HolidayPeriod {
    name: String,               // "春节"
    start: String,              // "0215"
    end: String,                // "0223", 包含结束
}
```

### ReminderConfig 修改

```rust
struct ReminderConfig {
    #[serde(default)]
    datetime: String,           // 保留旧字段，用于向前兼容

    #[serde(default)]
    workday_time: Option<String>,  // "HH:MM" 或 null
    #[serde(default)]
    restday_time: Option<String>,  // "HH:MM" 或 null

    sound: bool,
    day_mode: String,
}
```

### 向前兼容

旧配置只有 `datetime: "2026-05-15T20:00"` → 读取时自动转为：
```rust
workday_time: Some("20:00"),
restday_time: Some("20:00"),
```

---

## 二、节假日管理（设置弹窗）

### 入口

设置弹窗内新增「节假日」区块。

### 年份列表

```
节假日配置
┌──────────────────────────┐
│ 2026年    [编辑] [删除]  │
│ 2027年    [编辑] [删除]  │
│                          │
│ [添加年份] ▾ [添加]      │
└──────────────────────────┘
```

年份下拉范围：2026 ～ 当前年份+1。

### 编辑流程

```
点击年份的「编辑」→ 展开编辑面板：

┌────────────────────────────────────┐
│ [复制模板]                          │
│                                    │
│ ┌────────────────────────────────┐ │
│ │                                │ │
│ │  粘贴 JSON（粘贴即解析）       │ │
│ │                                │ │
│ └────────────────────────────────┘ │
│                                    │
│ (下方实时显示结果)                 │
└────────────────────────────────────┘

点击「复制模板」复制到剪贴板：
{
  "year": 2026,
  "holidays": [
    {"name": "元旦", "start": "0101", "end": "0103"}
  ],
  "makeup_days": ["0114"]
}

粘贴 AI 返回的完整 JSON → 点击「解析并预览」

┌────────────────────────────────────┐
│ 2026 年节假日配置                   │
│                                    │
│ 假期：                              │
│ ┌────────┬────────┬────────┐      │
│ │ 节日  │ 开始  │ 结束  │      │
│ ├────────┼────────┼────────┤      │
│ │ 元旦  │ 01/01 │ 01/03 │      │
│ │ 春节  │ 02/15 │ 02/23 │      │
│ │ ...   │ ...   │ ...   │      │
│ └────────┴────────┴────────┘      │
│                                    │
│ 补班日：                            │
│ 01/04  02/14  02/28  05/09        │
│                                    │
│ [确认保存] [取消]                  │
└────────────────────────────────────┘
```

### 校验规则

| 检查项 | 失败处理 |
|--------|---------|
| year 范围 2000-2099 | 显示错误 |
| MMdd 格式（4 位数字，月 01-12，日 01-31） | 显示具体错误位置 |
| end >= start | 提示日期范围错误 |
| 假期名不重复 | 提示名称冲突 |
| 假期不重叠 | 提示重叠的假期名 |
| 补班日不重复 | 提示重复条目 |
| 补班日在假期内 | 警告（允许保存） |

### 数据存储

设置确认后保存到 `config.json` 的 `holiday_data` 字段。

---

## 三、提醒系统改动

### 工作日/休息日判定

```js
// 存一个待办的所有提醒中，取 workday_time 和 restday_time
// 判定函数（Rust + JS 各一份）：
function getDayType(date, holidayYear) {
    const mmdd = formatMMdd(date);
    const isHoliday = holidayYear.holidays.some(h => mmdd >= h.start && mmdd <= h.end);
    const isMakeup = holidayYear.makeup_days.includes(mmdd);
    const isWeekend = date.getDay() === 0 || date.getDay() === 6;

    if (isHoliday && !isMakeup) return "restday";
    if (isWeekend && !isMakeup) return "restday";
    return "workday";
}
```

### 提醒线程（Rust）

```
每天检查待办：
  dayType = getDayType(today)
  targetTime = (dayType == "workday") ? todo.workday_time : todo.restday_time

  if targetTime == null → 跳过本日，推到下一天

  if 当前时间 >= 当天 targetTime:
    触发提醒
    推送到明天（重新按明天的 dayType 取时间）
```

### JS 前端

`createNextRepeat()`、`calculateNextReminder()`、`recalculateNextDue()` 修改：

```
新增 next_day_time 的计算：
  明天 → 放到明天的对应时间（按明天的 dayType 取 workday_time/restday_time）
  后天 → 同理
```

### 提醒输入 UI

待办编辑弹窗 → 提醒时间区域：

```html
<details class="reminder-advanced">
  <summary>
    ⏰ 提醒时间  <span id="reminderSummary">{{显示逻辑}}</span>
  </summary>
  工作日: <input type="time" id="editWorkdayTime">
  休息日: <input type="time" id="editRestdayTime">
  <label><input type="checkbox" id="editRestdayOff"> 休息日不提醒</label>
</details>
```

总结行逻辑：
- 两个时间相同 → 显示 `每天 {time}`
- 仅工作日有值 → 显示 `工作日 {time}`
- 各设不同 → 显示 `工作日 {time} / 休息日 {time}`
- 勾选"休息日不提醒" → `workday_time 不变, restday_time = null`

---

## 四、场景覆盖

| # | workday_time | restday_time | 节假日无配置时 | 有节假日配置时 |
|---|-------------|-------------|--------------|--------------|
| 1 | `"20:00"` | `"20:00"` | 每天 20:00 | 同左 |
| 2 | `"20:00"` | null | 周一至五 20:00 | 工作日（含补班）20:00 |
| 3 | null | `"14:00"` | 周末 14:00 | 休息日（含假期）14:00 |
| 4 | `"20:00"` | `"14:00"` | 工作日20:00 / 周末14:00 | 工作日20:00 / 休息日14:00 |
| 5 | `"20:00"` | 勾选不提醒 | 同场景2 | 同场景2 |

---

## 五、涉及文件

| 文件 | 改动 |
|------|------|
| src/main.rs | 新增 HolidayYearConfig 等类型、is_workday 判定、提醒线程 day_type 分支、向前兼容读取 |
| src/main.js | remind UI 改造（details/summary + 双时间）、createNextRepeat/calculateNextReminder/recalculateNextDue 修改、节假日编辑面板全流程 |
| src/index.html | 设置弹窗新增节假日编辑 HTML |
| src/styles.css | 节假日编辑区/预览表格/提醒区域 details 样式 |

---

## 六、未纳入范围

- 日历页面（待后续单独设计）
- 节假日数据的 Markdown 格式解析（当前仅支持 JSON）
