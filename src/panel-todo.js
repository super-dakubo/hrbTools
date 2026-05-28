// ==================== 待办工具 ====================
const todoList = document.getElementById('todoList');
const todoSearch = document.getElementById('todoSearch');
const todoFilterStatus = document.getElementById('todoFilterStatus');
const todoFilterPriority = document.getElementById('todoFilterPriority');
const todoStats = document.getElementById('todoStats');

function getReminderDisplay(todo) {
    if (todo.done || !todo.reminder) return '';
    if (!todo.reminder.datetime) return '';
    var now = new Date();
    var reminderTime = new Date(todo.reminder.datetime);
    var diffMs = reminderTime - now;
    if (isNaN(diffMs)) return '';
    var diffMin = Math.floor(diffMs / 60000);

    // 已过期（含刚好到期），返回已过期
    if (diffMs <= 0) {
        if (todo.repeat) return ''; // 周期任务由 recalculateNextDue 推进，不显示过期
        return '<span class="todo-reminder overdue">⏰ 已过期</span>';
    }

    var text = '';
    if (diffMin < 1) text = '1分钟内';
    else if (diffMin < 60) text = diffMin + '分钟后';
    else if (diffMin < 1440) text = Math.floor(diffMin / 60) + '小时后';
    else if (diffMin < 43200) text = Math.floor(diffMin / 1440) + '天后';
    else text = Math.floor(diffMin / 43200) + '个月后';

    var icon = todo.paused ? '⏸' : '⏰';
    var cls = todo.paused ? 'todo-reminder paused' : 'todo-reminder';
    return '<span class="' + cls + '" data-action="toggle-pause">' + icon + ' ' + text + '</span>';
}

function formatCompletedTime(isoStr) {
    if (!isoStr) return '';
    var d = new Date(isoStr);
    var y = d.getFullYear();
    var m = String(d.getMonth() + 1).padStart(2, '0');
    var day = String(d.getDate()).padStart(2, '0');
    var h = String(d.getHours()).padStart(2, '0');
    var min = String(d.getMinutes()).padStart(2, '0');
    return y + '-' + m + '-' + day + ' ' + h + ':' + min;
}

function autoClearExpiredPaused() {
    var changed = false;
    (currentConfig.todos || []).forEach(function(t) {
        if (t.done || !t.paused || !t.reminder || !t.reminder.datetime) return;
        if (t.repeat) return; // 重复任务不自动清除暂停
        var reminderTime = new Date(t.reminder.datetime);
        if (isNaN(reminderTime)) return;
        if (reminderTime <= new Date()) {
            t.paused = false;
            changed = true;
        }
    });
    return changed;
}

function renderTodos() {
    var t0 = performance.now();
    if (autoClearExpiredPaused()) saveConfigToBackend();

    // 推进周期任务的过期提醒到下一周期
    (currentConfig.todos || []).forEach(function(t) {
        if (t.done || !t.repeat || !t.reminder || !t.reminder.datetime) return;
        if (new Date(t.reminder.datetime) > new Date()) return;
        recalculateNextDue(t);
    });

    const items = currentConfig.todos || [];
    const keyword = (todoSearch.value || '').toLowerCase();
    const statusFilter = todoFilterStatus.value;
    const priorityFilter = parseInt(todoFilterPriority.value, 10);

    // 搜索 + 筛选
    let filtered = items.filter(t => {
        if (statusFilter === 'active' && t.done) return false;
        if (statusFilter === 'done' && !t.done) return false;
        if (priorityFilter >= 0 && t.priority !== priorityFilter) return false;
        if (keyword && !t.text.toLowerCase().includes(keyword) &&
            !t.tags.some(tag => tag.toLowerCase().includes(keyword))) return false;
        return true;
    });

    // 排序: 未完成优先 → 按优先级 → 手动排序
    const sorted = [...filtered].sort((a, b) => {
        if (a.done !== b.done) return a.done - b.done;
        if (a.priority !== b.priority) return b.priority - a.priority;
        return a.sort_order - b.sort_order;
    });

    // 统计
    const total = items.length;
    const active = items.filter(t => !t.done).length;
    const doneCount = total - active;
    todoStats.innerHTML = '<span class="' + (statusFilter === 'all' ? 'active' : '') + '" data-filter="all">全部 <span class="count">' + total + '</span></span>'
        + '<span class="' + (statusFilter === 'active' ? 'active' : '') + '" data-filter="active">待完成 <span class="count">' + active + '</span></span>'
        + '<span class="' + (statusFilter === 'done' ? 'active' : '') + '" data-filter="done">已完成 <span class="count">' + doneCount + '</span></span>';

    // 渲染列表
    if (sorted.length === 0) {
        todoList.innerHTML = '<div class="empty-hint">暂无待办，在下方添加</div>';
        return;
    }

    todoList.innerHTML = sorted.map(t => {
        const priClass = t.priority === 2 ? 'high' : t.priority === 1 ? 'medium' : 'low';
        const priLabel = t.priority === 2 ? '高' : t.priority === 1 ? '中' : '低';
        const reminderHtml = getReminderDisplay(t);
        const tagsHtml = t.tags.map(tag => '<span class="todo-tag">' + escapeHtml(tag) + '</span>').join('');
        return '<div class="todo-item' + (t.done ? ' done' : '') + '" data-id="' + escapeHtml(t.id) + '">'
            + '<span class="todo-drag-handle">⠿</span>'
            + '<span class="todo-check" data-action="toggle-todo">' + (t.done ? '✓' : '') + '</span>'
            + (t.priority > 0 ? '<span class="todo-priority ' + priClass + '">' + priLabel + '</span>' : '')
            + '<span class="todo-text" data-action="edit-todo">' + escapeHtml(t.text) + '</span>'
            + (t.done && t.completed_at ? '<span class="todo-completed-at">' + formatCompletedTime(t.completed_at) + '</span>' : '')
            + reminderHtml
            + (tagsHtml ? '<span class="todo-tags">' + tagsHtml + '</span>' : '')
            + '<button class="todo-delete-btn" data-action="delete-todo" title="删除">×</button>'
            + '</div>';
    }).join('');

    window.__log.perf('Render', 'renderTodos', { ms: +(performance.now() - t0).toFixed(2), total: items.length, filtered: sorted.length });
}

function toggleTodoDone(id) {
    var todo = currentConfig.todos.find(function(t) { return t.id === id; });
    if (!todo) return;

    if (!todo.done) {
        // 完成 — 翻转 done 并生成克隆
        todo.done = true;
        todo.completed_at = new Date().toISOString();
        if (todo.repeat) {
            var newTodo = createNextRepeat(todo);
            if (newTodo) currentConfig.todos.push(newTodo);
        }
        window.__log.info('Todo', '完成任务: ' + todo.text);
    } else {
        // 取消完成 — 删除克隆项，翻转 done，置空完成时间，重置时间
        var childIndex = currentConfig.todos.findIndex(function(t) { return t.parent_id === todo.id; });
        if (childIndex !== -1) currentConfig.todos.splice(childIndex, 1);
        todo.done = false;
        todo.completed_at = null;
        if (todo.repeat) recalculateNextDue(todo);
        window.__log.info('Todo', '取消完成任务: ' + todo.text);
    }

    saveConfigToBackend();
    renderTodos();
}

function deleteTodo(id) {
    var item = document.querySelector('.todo-item[data-id="' + id + '"]');
    var todo = currentConfig.todos.find(function(t) { return t.id === id; });
    if (todo) window.__log.info('Todo', '删除待办: ' + todo.text);
    var doDelete = function() {
        currentConfig.todos = currentConfig.todos.filter(function(t) { return t.id !== id; });
        saveConfigToBackend();
        renderTodos();
    };
    if (item) {
        item.classList.add('leaving');
        setTimeout(doDelete, 200);
    } else {
        doDelete();
    }
}

function createNextRepeat(todo) {
    var now = new Date();
    var nextDate = new Date(now.getFullYear(), now.getMonth(), now.getDate());

    if (todo.repeat === 'daily') nextDate.setDate(nextDate.getDate() + 1);
    else if (todo.repeat === 'weekly') nextDate.setDate(nextDate.getDate() + 7);
    else if (todo.repeat === 'monthly') nextDate = safeAddMonth(nextDate);
    else return null;

    var newTodo = JSON.parse(JSON.stringify(todo));
    newTodo.id = crypto.randomUUID();
    newTodo.done = false;
    newTodo.created_at = new Date().toISOString().slice(0, 16);

    // 推 reminder 和 due_date
    if (newTodo.due_date && todo.repeat) {
        var d = new Date(todo.due_date + 'T00:00:00');
        if (todo.repeat === 'daily') d.setDate(d.getDate() + 1);
        else if (todo.repeat === 'weekly') d.setDate(d.getDate() + 7);
        else if (todo.repeat === 'monthly') d = safeAddMonth(d);
        newTodo.due_date = d.toISOString().slice(0, 10);
    }
    if (newTodo.reminder && newTodo.reminder.datetime && todo.repeat) {
        if (todo.repeat === 'daily') {
            var next = calculateNextReminderDate('daily',
                newTodo.reminder.workday_time,
                newTodo.reminder.restday_time);
            if (next) newTodo.reminder.datetime = next;
        } else if (todo.repeat === 'weekly') {
            var r = new Date(newTodo.reminder.datetime);
            r.setDate(r.getDate() + 7);
            newTodo.reminder.datetime = r.toISOString().slice(0, 16);
        } else if (todo.repeat === 'monthly') {
            var r = new Date(newTodo.reminder.datetime);
            r = safeAddMonth(r);
            newTodo.reminder.datetime = r.toISOString().slice(0, 16);
        }
    }
    newTodo.parent_id = todo.id;   // 记录关联，供取消完成时查找删除
    return newTodo;
}

function recalculateNextDue(todo) {
    // 推进 due_date（如果存在且已过期）
    if (todo.due_date && todo.repeat) {
        var due = new Date(todo.due_date);
        var now = new Date();
        if (due <= now) {
            var next = new Date(now.getFullYear(), now.getMonth(), now.getDate());
            if (todo.repeat === 'daily') next.setDate(next.getDate() + 1);
            else if (todo.repeat === 'weekly') next.setDate(next.getDate() + 7);
            else if (todo.repeat === 'monthly') next = safeAddMonth(next);
            todo.due_date = next.toISOString().slice(0, 10);
        }
    }

    // 推进 reminder.datetime（如果存在、已过期、且是周期任务）
    if (todo.reminder && todo.reminder.datetime && todo.repeat) {
        var r = new Date(todo.reminder.datetime);
        if (r <= new Date()) {
            if (todo.repeat === 'daily') {
                var next = calculateNextReminderDate('daily',
                    todo.reminder.workday_time,
                    todo.reminder.restday_time);
                if (next) todo.reminder.datetime = next;
            } else if (todo.repeat === 'weekly') {
                var maxWeeks = 52;
                while (r <= new Date() && maxWeeks > 0) {
                    r.setDate(r.getDate() + 7);
                    maxWeeks--;
                }
                if (maxWeeks > 0) todo.reminder.datetime = r.toISOString().slice(0, 16);
            } else if (todo.repeat === 'monthly') {
                var maxMonths = 12;
                while (r <= new Date() && maxMonths > 0) {
                    r = safeAddMonth(r);
                    maxMonths--;
                }
                if (maxMonths > 0) todo.reminder.datetime = r.toISOString().slice(0, 16);
            }
        }
    }
}

// 添加待办按钮
document.getElementById('todoAddBtn').addEventListener('click', function() {
    openTodoEditModal(null);
});

// 搜索/筛选事件
todoSearch.addEventListener('input', function() { renderTodos(); });
todoFilterStatus.addEventListener('change', function() { renderTodos(); });
todoFilterPriority.addEventListener('change', function() { renderTodos(); });

function formatISOLocal(d) {
    var y = d.getFullYear();
    var m = String(d.getMonth() + 1).padStart(2, '0');
    var day = String(d.getDate()).padStart(2, '0');
    var h = String(d.getHours()).padStart(2, '0');
    var min = String(d.getMinutes()).padStart(2, '0');
    return y + '-' + m + '-' + day + 'T' + h + ':' + min;
}

function calculateNextReminder(repeat, options) {
    var now = new Date();
    var hours = options.hours, minutes = options.minutes;
    if (hours == null || isNaN(hours) || minutes == null || isNaN(minutes)) return '';

    if (repeat === 'daily') {
        var target = new Date(now.getFullYear(), now.getMonth(), now.getDate(), hours, minutes, 0, 0);
        if (target <= now) target.setDate(target.getDate() + 1);
        return formatISOLocal(target);
    }

    if (repeat === 'weekly') {
        var jsTarget = options.weekday === 7 ? 0 : options.weekday;
        var target = new Date(now.getFullYear(), now.getMonth(), now.getDate(), hours, minutes, 0, 0);
        var daysUntil = (jsTarget - now.getDay() + 7) % 7;
        if (daysUntil === 0 && target <= now) daysUntil = 7;
        target.setDate(target.getDate() + daysUntil);
        return formatISOLocal(target);
    }

    if (repeat === 'monthly') {
        if (options.dayMode === 'last') {
            var target = new Date(now.getFullYear(), now.getMonth() + 1, 0, hours, minutes, 0, 0);
            if (target <= now) {
                target = new Date(now.getFullYear(), now.getMonth() + 2, 0, hours, minutes, 0, 0);
            }
            return formatISOLocal(target);
        }
        if (options.dayMode === 'second_last') {
            var last = new Date(now.getFullYear(), now.getMonth() + 1, 0);
            var target = new Date(last.getFullYear(), last.getMonth(), last.getDate() - 1, hours, minutes, 0, 0);
            if (target <= now) {
                last = new Date(now.getFullYear(), now.getMonth() + 2, 0);
                target = new Date(last.getFullYear(), last.getMonth(), last.getDate() - 1, hours, minutes, 0, 0);
            }
            return formatISOLocal(target);
        }
        if (options.dayMode === 'third_last') {
            var last = new Date(now.getFullYear(), now.getMonth() + 1, 0);
            var target = new Date(last.getFullYear(), last.getMonth(), last.getDate() - 2, hours, minutes, 0, 0);
            if (target <= now) {
                last = new Date(now.getFullYear(), now.getMonth() + 2, 0);
                target = new Date(last.getFullYear(), last.getMonth(), last.getDate() - 2, hours, minutes, 0, 0);
            }
            return formatISOLocal(target);
        }
        // fixed
        var daysInMonth = new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate();
        var clampedDay = Math.min(options.day, daysInMonth);
        var target = new Date(now.getFullYear(), now.getMonth(), clampedDay, hours, minutes, 0, 0);
        if (target <= now) {
            var nextMonth = now.getMonth() + 1;
            var nextYear = now.getFullYear();
            if (nextMonth > 11) { nextMonth = 0; nextYear++; }
            var daysInNext = new Date(nextYear, nextMonth + 1, 0).getDate();
            target = new Date(nextYear, nextMonth, Math.min(options.day, daysInNext), hours, minutes, 0, 0);
        }
        return formatISOLocal(target);
    }

    return '';
}

function getReminderSummary(todo) {
    if (!todo.reminder) return '未设置';
    var wd = todo.reminder.workday_time;
    var rd = todo.reminder.restday_time;
    if (wd && rd) {
        if (wd === rd) return '每天 ' + wd;
        return '工作日 ' + wd + ' / 休息日 ' + rd;
    }
    if (wd) return '工作日 ' + wd;
    if (rd) return '休息日 ' + rd;
    return '未设置';
}

function getDayType(date, holidayData) {
    var mmdd = String(date.getMonth() + 1).padStart(2, '0') + String(date.getDate()).padStart(2, '0');
    var year = date.getFullYear();
    var holiday = null;
    for (var i = 0; i < holidayData.length; i++) {
        if (holidayData[i].year === year) { holiday = holidayData[i]; break; }
    }

    if (holiday) {
        if (holiday.makeup_days.indexOf(mmdd) !== -1) return 'workday';
        for (var j = 0; j < holiday.holidays.length; j++) {
            var h = holiday.holidays[j];
            if (h.start <= h.end) {
                if (mmdd >= h.start && mmdd <= h.end) return 'restday';
            } else {
                // 跨年假期段
                if (mmdd >= h.start || mmdd <= h.end) return 'restday';
            }
        }
    }

    var day = date.getDay();
    if (day === 0 || day === 6) return 'restday';
    return 'workday';
}

function calculateNextReminderDate(repeat, workdayTime, restdayTime) {
    var now = new Date();
    var today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    var holidayData = currentConfig.holiday_data || [];

    for (var d = 0; d < 60; d++) {
        var checkDate = new Date(today.getFullYear(), today.getMonth(), today.getDate() + d);
        var dayType = getDayType(checkDate, holidayData);
        var targetTime = dayType === 'workday' ? workdayTime : restdayTime;
        if (!targetTime) continue;

        var parts = targetTime.split(':');
        var target = new Date(checkDate.getFullYear(), checkDate.getMonth(), checkDate.getDate(),
            parseInt(parts[0], 10), parseInt(parts[1], 10), 0, 0);
        if (d === 0 && target > now) return formatISOLocal(target);
        if (d === 0) continue;
        return formatISOLocal(target);
    }
    return '';
}

function calculateFireAt(todo) {
    if (todo.repeat === 'daily') {
        var next = calculateNextReminderDate('daily',
            todo.reminder.workday_time,
            todo.reminder.restday_time);
        return next ? new Date(next).getTime() : null;
    }
    if (todo.reminder && todo.reminder.datetime) {
        return new Date(todo.reminder.datetime).getTime();
    }
    return null;
}

function syncPendingReminders() {
    try {
        currentConfig.pending_reminders = currentConfig.pending_reminders || [];
        var changed = false;

        // 清理已删除待办的孤儿 pending_reminder
        var todoIds = new Set((currentConfig.todos || []).map(function(t) { return t.id; }));
        var before = currentConfig.pending_reminders.length;
        currentConfig.pending_reminders = currentConfig.pending_reminders.filter(function(r) { return todoIds.has(r.todo_id); });
        if (currentConfig.pending_reminders.length !== before) changed = true;

        (currentConfig.todos || []).forEach(function(t) {
            if (t.done || t.paused || !t.reminder) {
                var had = currentConfig.pending_reminders.some(function(r) { return r.todo_id === t.id; });
                if (had) {
                    currentConfig.pending_reminders = currentConfig.pending_reminders.filter(function(r) { return r.todo_id !== t.id; });
                    changed = true;
                }
                return;
            }
            if (currentConfig.pending_reminders.some(function(r) { return r.todo_id === t.id; })) return;

            var fireAt = calculateFireAt(t);
            if (!fireAt) return;

            currentConfig.pending_reminders.push({
                id: crypto.randomUUID(),
                todo_id: t.id,
                text: t.text,
                fire_at: fireAt,
                sound: t.reminder.sound || false,
                repeat: t.repeat || null,
                workday_time: t.reminder.workday_time || null,
                restday_time: t.reminder.restday_time || null,
                day_mode: t.reminder.day_mode || '',
            });
            changed = true;
        });
        if (changed) saveConfigToBackend();
    } catch (err) {
        window.__log.error('Reminder', '同步待提醒列表异常: ' + err);
    }
}

function updateReminderSummary() {
    var el = document.getElementById('reminderSummaryText');
    if (!el) return;
    var wd = document.getElementById('editWorkdayTime');
    var rd = document.getElementById('editRestdayTime');
    var off = document.getElementById('editRestdayOff');
    if (!wd || !rd) return;
    var wdv = wd.value;
    var rdv = off && off.checked ? null : (rd ? rd.value : null);
    if (wdv && rdv) {
        if (wdv === rdv) el.textContent = '每天 ' + wdv;
        else el.textContent = '工作日 ' + wdv + ' / 休息日 ' + rdv;
    } else if (wdv) {
        el.textContent = '工作日 ' + wdv;
    } else if (rdv) {
        el.textContent = '休息日 ' + rdv;
    } else {
        el.textContent = '未设置';
    }
}

// 编辑弹窗
function openTodoEditModal(id) {
    var isNew = id === null;
    var todo = isNew ? null : currentConfig.todos.find(function(t) { return t.id === id; });
    if (!todo && !isNew) return;
    // 已完成的一次性提醒待办不再允许编辑（编辑弹窗 autoSave 可能覆盖后端 done=true）
    if (!isNew && todo.done && !todo.repeat && todo.reminder) {
        window.__log.info('已完成的一次性提醒待办不可编辑: ' + todo.text);
        return;
    }

    if (isNew) {
        todo = {
            id: null,
            text: '',
            done: false,
            priority: 1,
            due_date: null,
            tags: [],
            notes: '',
            reminder: null,
            repeat: null,
            sort_order: currentConfig.todos.length,
            created_at: new Date().toISOString().slice(0, 16),
        };
    }

    var oldEl = document.querySelector('.todo-edit-overlay');
    if (oldEl) oldEl.remove();

    var priorityLabels = ['低', '中', '高'];
    var priorityHtml = '';
    for (var i = 0; i < 3; i++) {
        priorityHtml += '<button class="' + (todo.priority === i ? 'active' : '') + '" data-value="' + i + '">' + priorityLabels[i] + '</button>';
    }

    var repeatValues = [null, 'daily', 'weekly', 'monthly'];
    var repeatLabels = ['不重复', '每天', '每周', '每月'];
    var repeatOpts = '';
    for (var i = 0; i < repeatValues.length; i++) {
        repeatOpts += '<option value="' + (repeatValues[i] || '') + '" ' + (todo.repeat === repeatValues[i] ? 'selected' : '') + '>' + repeatLabels[i] + '</option>';
    }

    var overlay = document.createElement('div');
    overlay.className = 'todo-edit-overlay dialog-overlay';
    overlay.innerHTML = '<div class="todo-edit-modal dialog-box">'
        + '<div class="todo-edit-header">'
            + '<div class="todo-edit-title">' + (isNew ? '新建待办' : '编辑待办') + '</div>'
            + '<button class="todo-edit-close" id="editCloseBtn">&#x2715;</button>'
        + '</div>'
        + '<div class="todo-edit-body">'

        + '<div class="todo-edit-field">'
            + '<label>内容</label>'
            + '<input type="text" id="editText" value="' + escapeHtml(todo.text) + '">'
        + '</div>'

        + '<div class="todo-edit-field">'
            + '<label>优先级</label>'
            + '<div class="todo-priority-picker" id="editPriority">' + priorityHtml + '</div>'
        + '</div>'

        + '<div class="todo-edit-field">'
            + '<label>📅 到期日</label>'
            + '<input type="date" id="editDueDate" value="' + (todo.due_date || '') + '">'
        + '</div>'

        + '<div class="todo-edit-field">'
            + '<label>标签（逗号分隔）</label>'
            + '<input type="text" id="editTags" value="' + escapeHtml((todo.tags || []).join(', ')) + '">'
        + '</div>'

        + '<div class="todo-edit-field">'
            + '<label>备注</label>'
            + '<textarea id="editNotes">' + escapeHtml(todo.notes || '') + '</textarea>'
        + '</div>'

        + '<div class="todo-edit-field">'
            + '<label>重复</label>'
            + '<select id="editRepeat">' + repeatOpts + '</select>'
        + '</div>'

        + '<div class="todo-edit-field">'
            + '<label>⏰ 提醒时间</label>'
            + '<div class="reminder-input-group">'
                // 不重复
                + '<input type="datetime-local" id="editReminderOnce" class="ri ri-once" value="' + (todo.reminder && !todo.repeat ? todo.reminder.datetime : '') + '">'
                // 每天
                + '<span class="ri ri-daily" style="display:none">'
                    + '<details class="reminder-details">'
                    + '<summary class="reminder-summary">⏰ <span id="reminderSummaryText">' + getReminderSummary(todo) + '</span></summary>'
                    + '<div class="reminder-detail-fields">'
                    + '<label class="reminder-time-label">工作日 <input type="time" id="editWorkdayTime" value="' + (todo.reminder && todo.repeat === 'daily' && todo.reminder.workday_time ? todo.reminder.workday_time : '') + '"></label>'
                    + '<label class="reminder-time-label">休息日 <input type="time" id="editRestdayTime" value="' + (todo.reminder && todo.repeat === 'daily' && todo.reminder.restday_time ? todo.reminder.restday_time : '') + '"></label>'
                    + '<label class="reminder-off-label"><input type="checkbox" id="editRestdayOff"' + (todo.reminder && todo.repeat === 'daily' && !todo.reminder.restday_time && todo.reminder.workday_time ? ' checked' : '') + '> 休息日不提醒</label>'
                    + '</div>'
                    + '</details>'
                + '</span>'
                // 每周
                + '<span class="ri ri-weekly" style="display:none">'
                    + '<select id="editReminderWeekday">'
                        + '<option value="1">周一</option>'
                        + '<option value="2">周二</option>'
                        + '<option value="3">周三</option>'
                        + '<option value="4">周四</option>'
                        + '<option value="5">周五</option>'
                        + '<option value="6">周六</option>'
                        + '<option value="7">周日</option>'
                    + '</select>'
                    + '<input type="time" id="editReminderWeeklyTime">'
                + '</span>'
                // 每月
                + '<span class="ri ri-monthly" style="display:none">'
                    + '<select id="editReminderMonthDay">'
                        + (function() {
                            var opts = '';
                            for (var i = 1; i <= 31; i++) opts += '<option value="' + i + '">' + i + '日</option>';
                            opts += '<option value="last">最后一天</option>';
                            opts += '<option value="second_last">倒数第二天</option>';
                            opts += '<option value="third_last">倒数第三天</option>';
                            return opts;
                        })()
                    + '</select>'
                    + '<input type="time" id="editReminderMonthlyTime">'
                + '</span>'
            + '</div>'
        + '</div>'
    + '</div>'
    + '</div>';

    document.querySelector('.container').appendChild(overlay);

    // 编辑已有待办：恢复每周/每月的选择值
    if (todo.reminder && todo.repeat === 'weekly') {
        var d = new Date(todo.reminder.datetime);
        var weekday = d.getDay() === 0 ? 7 : d.getDay();
        overlay.querySelector('#editReminderWeekday').value = String(weekday);
        overlay.querySelector('#editReminderWeeklyTime').value = todo.reminder.datetime.slice(11, 16);
    }
    if (todo.reminder && todo.repeat === 'monthly') {
        var dayMode = todo.reminder.day_mode || 'fixed';
        var timeVal = todo.reminder.datetime.slice(11, 16);
        if (dayMode === 'last' || dayMode === 'second_last' || dayMode === 'third_last') {
            overlay.querySelector('#editReminderMonthDay').value = dayMode;
        } else {
            var dayNum = new Date(todo.reminder.datetime).getDate();
            overlay.querySelector('#editReminderMonthDay').value = String(dayNum);
        }
        overlay.querySelector('#editReminderMonthlyTime').value = timeVal;
    }

    // 重复类型切换 → 切换提醒输入控件
    function switchReminderInput(repeatVal) {
        overlay.querySelectorAll('.ri').forEach(function(el) { el.style.display = 'none'; });
        if (repeatVal === null || repeatVal === '') {
            overlay.querySelector('.ri-once').style.display = '';
        } else if (repeatVal === 'daily') {
            overlay.querySelector('.ri-daily').style.display = '';
        } else if (repeatVal === 'weekly') {
            overlay.querySelector('.ri-weekly').style.display = '';
        } else if (repeatVal === 'monthly') {
            overlay.querySelector('.ri-monthly').style.display = '';
        }
    }
    var repeatSelect = overlay.querySelector('#editRepeat');
    repeatSelect.addEventListener('change', function() {
        switchReminderInput(this.value || null);
        autoSave();
    });
    switchReminderInput(repeatSelect.value || null); // 初始化状态

    // ─── 关闭 ───
    function closeModal() {
        // 新待办且内容为空 → 从数组清理（防止自动保存了空内容）
        if (isNew && todo.id && !overlay.querySelector('#editText').value.trim()) {
            var idx = currentConfig.todos.indexOf(todo);
            if (idx !== -1) currentConfig.todos.splice(idx, 1);
            saveConfigToBackend();
        }
        renderTodos(); // 统一刷新（编辑中跳过，关闭时保证列表最新）
        overlay.remove();
    }
    overlay.querySelector('#editCloseBtn').addEventListener('click', closeModal);
    overlay.addEventListener('click', function(e) { if (e.target === overlay) closeModal(); });

    // ─── 自动保存（每项修改后 300ms 防抖写入配置） ───
    var _saveTimer = null;
    function collectFields() {
        var text = overlay.querySelector('#editText').value.trim();
        if (!text) return null;
        var activePri = overlay.querySelector('.todo-priority-picker .active');
        var repeatType = overlay.querySelector('#editRepeat').value;
        var reminderVal = null;
        var dayMode = 'fixed';
        if (repeatType === '' || repeatType === null) {
            reminderVal = overlay.querySelector('#editReminderOnce').value;
        } else if (repeatType === 'daily') {
            var wdVal = overlay.querySelector('#editWorkdayTime').value;
            var rdVal = overlay.querySelector('#editRestdayTime').value;
            var rdOff = overlay.querySelector('#editRestdayOff').checked;
            if (wdVal || rdVal) {
                var nextDate = calculateNextReminderDate('daily', wdVal || null, rdOff ? null : (rdVal || null));
                if (nextDate) {
                    reminderVal = nextDate;
                }
            }
        } else if (repeatType === 'weekly') {
            var weekday = parseInt(overlay.querySelector('#editReminderWeekday').value, 10);
            var timeVal = overlay.querySelector('#editReminderWeeklyTime').value;
            if (timeVal) {
                var parts = timeVal.split(':');
                reminderVal = calculateNextReminder('weekly', { weekday: weekday, hours: parseInt(parts[0], 10), minutes: parseInt(parts[1], 10) });
            }
        } else if (repeatType === 'monthly') {
            var daySelect = overlay.querySelector('#editReminderMonthDay');
            var dayVal = daySelect.value;
            var timeVal = overlay.querySelector('#editReminderMonthlyTime').value;
            if (timeVal) {
                var parts = timeVal.split(':');
                var specialDays = ['last', 'second_last', 'third_last'];
                if (specialDays.indexOf(dayVal) !== -1) {
                    dayMode = dayVal;
                    reminderVal = calculateNextReminder('monthly', { dayMode: dayVal, hours: parseInt(parts[0], 10), minutes: parseInt(parts[1], 10) });
                } else {
                    reminderVal = calculateNextReminder('monthly', { dayMode: 'fixed', day: parseInt(dayVal, 10), hours: parseInt(parts[0], 10), minutes: parseInt(parts[1], 10) });
                }
            }
        }
        return {
            text: text,
            priority: activePri ? parseInt(activePri.dataset.value, 10) : 1,
            due_date: overlay.querySelector('#editDueDate').value || null,
            tags: overlay.querySelector('#editTags').value.split(',').map(function(s) { return s.trim(); }).filter(Boolean),
            notes: overlay.querySelector('#editNotes').value,
            repeat: overlay.querySelector('#editRepeat').value || null,
            reminder: reminderVal ? { datetime: reminderVal, sound: true, day_mode: dayMode } : null,
        };
    }
    var _editSaveInProgress = false;
    function autoSave() {
        if (_saveTimer) clearTimeout(_saveTimer);
        if (_editSaveInProgress) return; // 前一次保存未完成则跳过本次
        _saveTimer = setTimeout(function() {
            var fields = collectFields();
            if (!fields) return;
            // 新待办首次保存时生成 ID
            if (isNew && !todo.id) {
                todo.id = crypto.randomUUID();
                todo.created_at = new Date().toISOString().slice(0, 16);
                todo.sort_order = currentConfig.todos.length;
                currentConfig.todos.push(todo);
            }
            todo.text = fields.text;
            todo.priority = fields.priority;
            todo.due_date = fields.due_date;
            todo.tags = fields.tags;
            todo.notes = fields.notes;
            todo.repeat = fields.repeat;
            if (fields.reminder) {
                if (!todo.reminder) {
                    todo.reminder = { datetime: fields.reminder.datetime, sound: true, day_mode: fields.reminder.day_mode || 'fixed', workday_time: null, restday_time: null };
                } else {
                    todo.reminder.datetime = fields.reminder.datetime;
                    todo.reminder.day_mode = fields.reminder.day_mode || 'fixed';
                }
                if (fields.repeat === 'daily') {
                    todo.reminder.workday_time = overlay.querySelector('#editWorkdayTime').value || null;
                    todo.reminder.restday_time = overlay.querySelector('#editRestdayOff').checked ? null : (overlay.querySelector('#editRestdayTime').value || null);
                }
            } else {
                todo.reminder = null;
            }
            _editSaveInProgress = true;
            var settled = false;
            var _saveTimeout = setTimeout(function() {
                settled = true;
                _editSaveInProgress = false;
            }, 5000);
            saveConfigToBackend().then(function() {
                if (settled) return;
                settled = true;
                clearTimeout(_saveTimeout);
                _editSaveInProgress = false;
                syncPendingReminders();
            }).catch(function() {
                if (settled) return;
                settled = true;
                clearTimeout(_saveTimeout);
                _editSaveInProgress = false;
            });
            // 编辑弹窗中不渲染列表（关闭时才渲染），避免 DOM 操作卡顿
            if (!overlay.parentNode) renderTodos();
        }, 300);
    }
    // 各字段修改触发自动保存
    overlay.querySelector('#editText').addEventListener('input', autoSave);
    overlay.querySelectorAll('.todo-priority-picker button').forEach(function(btn) {
        btn.addEventListener('click', function() {
            overlay.querySelectorAll('.todo-priority-picker button').forEach(function(b) { b.classList.remove('active'); });
            this.classList.add('active');
            autoSave();
        });
    });
    overlay.querySelector('#editDueDate').addEventListener('change', autoSave);
    overlay.querySelector('#editTags').addEventListener('input', autoSave);
    overlay.querySelector('#editNotes').addEventListener('input', autoSave);
    // 提醒输入控件变化
    overlay.querySelector('#editReminderOnce').addEventListener('change', autoSave);
    overlay.querySelector('#editReminderWeekday').addEventListener('change', autoSave);
    overlay.querySelector('#editReminderWeeklyTime').addEventListener('change', autoSave);
    overlay.querySelector('#editReminderMonthDay').addEventListener('change', autoSave);
    overlay.querySelector('#editReminderMonthlyTime').addEventListener('change', autoSave);
    var editWorkdayTime = overlay.querySelector('#editWorkdayTime');
    var editRestdayTime = overlay.querySelector('#editRestdayTime');
    var editRestdayOff = overlay.querySelector('#editRestdayOff');
    if (editWorkdayTime) editWorkdayTime.addEventListener('change', function() {
        updateReminderSummary();
        autoSave();
    });
    if (editRestdayTime) editRestdayTime.addEventListener('change', function() {
        updateReminderSummary();
        autoSave();
    });
    if (editRestdayOff) editRestdayOff.addEventListener('change', function() {
        updateReminderSummary();
        autoSave();
    });
}

