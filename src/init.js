// ==================== 启动 ====================

document.addEventListener("DOMContentLoaded", async function () {
  var t0 = performance.now();
  // 第一步：必须同步的操作 — 加载配置、应用主题
  await loadConfig();
  // 隐藏加载层
  var loadingOverlay = document.getElementById("loadingOverlay");
  if (loadingOverlay) loadingOverlay.classList.add("hidden");

  // 第二步：分步渲染，避免阻塞首帧
  requestAnimationFrame(function () {
    // Tab 栏（首帧已由 loadConfig 渲染）

    requestAnimationFrame(function () {
      // 内容面板（首帧已由 switchTab 渲染）

      var tDel = performance.now();

      // 第三步：日志面板事件绑定 + 加载历史日志（不阻塞首帧）
      setTimeout(function () {
        bindLogPanelEvents();
        window.__log.loadFromFile();
      }, 100);

      // 第四步：一次性事件委托，替代每次渲染后重新绑定监听器
      setupEventDelegation();

      // 第五步：横幅系统（从 config.banners 读取）
      renderBanners();

      window.__onReminderFired = function () {
        invoke("get_config")
          .then(function (fresh) {
            currentConfig = fresh;
            renderBanners();
            if (currentTab === "todo") renderTodos();
          })
          .catch(function (e) {
            window.__log.error("重新拉取配置失败: " + e);
          });
      };

      // 同步待提醒列表（为有提醒的待办创建 pending_reminders）
      syncPendingReminders();
      // 展示横幅（从 config.banners 读取）
      renderBanners();

      // 铃铛按钮
      var bell = document.getElementById("notificationBell");
      if (bell) {
        bell.addEventListener("click", function (e) {
          e.stopPropagation();
          renderNotificationCenter();
        });
      }

      // 填充年份下拉
      (function populateHolidayYears() {
        var select = document.getElementById("holidayYearSelect");
        if (!select) return;
        var currentYear = new Date().getFullYear();
        for (var y = 2026; y <= currentYear + 1; y++) {
          var opt = document.createElement("option");
          opt.value = String(y);
          opt.textContent = y + "年";
          select.appendChild(opt);
        }
      })();

      // 最后：通知 Rust 显示窗口（避免白屏）
      invoke("show_main_window");

      window.__log.perf("Startup", "DOMContentLoaded 总耗时", {
        loadConfig: +(tDel - t0).toFixed(2),
        full: +(performance.now() - t0).toFixed(2),
      });
    });
  });
});
