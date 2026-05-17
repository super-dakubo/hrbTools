# 一次性提醒自动完成修复 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 一次性待办到期后自动标记完成、显示横幅、刷新列表

**Architecture:** Rust 提醒线程同步标记 `todo.done = true` 并持久化配置，前端只读刷新（消除之前 `__onReminderFired` 的写竞争问题）。启动扫描同样处理过期的一次性待办。

**Tech Stack:** Tauri 2.0 (Rust + vanilla JS)

---

### Task 1: Rust 端 — 一次性提醒分支标记完成

**Files:**
- Modify: `src/main.rs:1795-1797`

- [ ] **Step 1: 替换一次性提醒空分支为完成逻辑**

  将 `main.rs` 中一次性提醒分支（当前是空注释 `// 一次性提醒：保留 reminder 数据，由前端标记完成`）替换为：

  ```rust
  } else {
      // 一次性提醒：直接标记完成并持久化
      todo.done = true;
      todo.last_notified = Some(now);
      if let Err(e) = save_config(&app_handle, &config) {
          write_log(&app_handle, &format!("一次性提醒标记完成保存失败: {:?}", e));
      }
  }
  ```

  注意：`todo` is `&mut TodoItem`，`now: i64` 已在作用域中，`save_config` 同步写入。

- [ ] **Step 2: 简化 eval payload 为轻量函数调用**

  将 `main.rs:1799-1825` 的 JSON payload 构造 + eval 调用替换为直接调用 `__onOneTimeReminderDone(id, text)`：

  ```rust
  // 通知前端刷新列表和显示横幅
  let safe_text = todo.text.replace('\'', "\\'");
  let _ = w.eval(&format!(
      r#"try{{window.__onOneTimeReminderDone('{}','{}')}}catch(e){{}}"#,
      todo.id.replace('\'', "\\'"),
      safe_text
  ));
  ```

  注意：所有一次性提醒都会走这里，重复提醒不受影响（仍保留原有的 `__onReminderFired` eval 调用）。检查代码结构确保 eval 在 `if let Some(w) = ...` 内窗口操作之后执行。

- [ ] **Step 3: cargo check 验证编译**

  ```bash
  cargo check
  ```

  Expected: 编译成功，无 warning

- [ ] **Step 4: 提交**

  ```bash
  git add src/main.rs
  git commit -m "fix: Rust 端一次性提醒标记完成并持久化

  Rust 线程同步标记 todo.done = true 并 save_config，
  eval 改为调用轻量 __onOneTimeReminderDone(id, text)。"
  ```

---

### Task 2: 前端 — 新增 `__onOneTimeReminderDone` 函数

**Files:**
- Modify: `src/main.js:2330`

- [ ] **Step 1: 替换 `__onReminderFired = null` 为新函数**

  找到 `main.js` 的 `window.__onReminderFired = null; // 预留，当前由 Rust 线程推送系统通知` 这一行，替换为：

  ```javascript
  window.__onOneTimeReminderDone = function(id, text) {
      window.__bannerQueue.push({ text: '⏰ ' + text, id: ++window.__bannerIdSeq, todoId: id });
      window.__renderBanners();
      invoke('get_config').then(function(fresh) {
          currentConfig.todos = fresh.todos;
          renderTodos();
      }).catch(function() {});
  };
  ```

  注意：该函数**只调 get_config（只读）**，不调 saveConfigToBackend，不存在写竞争。

- [ ] **Step 2: 修改启动扫描（IIFE at `main.js:2332-2355`）**

  将整个启动扫描 IIFE 替换为：

  ```javascript
  // 启动时扫描过期提醒，展示横幅并将一次性待办标记完成
  (function() {
      var now = new Date();
      var items = [];
      var needSave = false;
      (currentConfig.todos || []).forEach(function(t) {
          if (t.done || !t.reminder || !t.reminder.datetime) return;
          // 跳过已被用户关闭过的提醒
          if (t.last_notified) return;
          var rt = new Date(t.reminder.datetime);
          if (!isNaN(rt) && rt <= now) {
              items.push({ text: '⏰ ' + t.text, todoId: t.id });
              // 一次性待办启动时自动标记完成
              if (!t.repeat && t.reminder.datetime && t.reminder.datetime.includes('T')) {
                  t.done = true;
                  t.last_notified = Date.now();
                  needSave = true;
              }
          }
      });
      items.forEach(function(item) {
          window.__bannerQueue.push({ text: item.text, id: ++window.__bannerIdSeq, todoId: item.todoId });
      });
      window.__renderBanners();

      // 先保存再刷新，避免竞态
      var refreshPromise;
      if (needSave) {
          refreshPromise = saveConfigToBackend().catch(function(e) {
              window.__log.error('启动扫描保存失败: ' + e);
          }).then(function() {
              return invoke('get_config');
          });
      } else if (items.length > 0) {
          refreshPromise = invoke('get_config');
      }
      if (refreshPromise) {
          refreshPromise.then(function(fresh) {
              currentConfig.todos = fresh.todos;
              renderTodos();
          }).catch(function() {});
      }
  })();
  ```

- [ ] **Step 3: 验证无语法错误**

  用 node 检查语法或肉眼复查：
  - `__onOneTimeReminderDone` 在 eval 调用前已定义（在启动 IIFE 之前）
  - 函数引用无拼写错误：`__bannerQueue`、`__bannerIdSeq`、`__renderBanners`、`invoke`、`renderTodos`
  - 启动扫描中 `needSave` 分支正确串联 `.then()`

- [ ] **Step 4: 提交**

  ```bash
  git add src/main.js
  git commit -m "fix: 前端一次性提醒完成处理

  - 新增 __onOneTimeReminderDone 显示横幅并刷新列表（只读）
  - 启动扫描检测过期一次性待办时自动标记完成
  - 修复竞态：先 saveConfigToBackend 再 get_config"
  ```

---

### Task 3: 集成测试验证

**Files:** 无（手动测试）

- [ ] **Step 1: cargo tauri dev 启动应用**

  ```bash
  cargo tauri dev
  ```

- [ ] **Step 2: 测试一次性提醒即时触发**
  1. 创建一个一次性待办，提醒时间设为 1 分钟后
  2. 等待触发
  3. 验证：窗口置顶 + 横幅出现 + 待办自动勾选 + 列表刷新

- [ ] **Step 3: 测试启动扫描**
  1. 创建一个一次性待办，提醒时间设为过去（手动改 config.json）
  2. 重启应用
  3. 验证：横幅出现 + 待办自动标记完成

- [ ] **Step 4: 测试重复提醒不受影响**
  1. 创建一个每日/每周/每月提醒
  2. 等待触发
  3. 验证：提醒触发后推期到下一次，不被标记为 done

- [ ] **Step 5: 提交最终状态**

  ```bash
  git add -A
  git commit -m "fix: 一次性提醒自动完成修复"
  ```
