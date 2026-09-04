"use strict";
// ui.js — تحسينات واجهة إضافية بحتة (فتح/إغلاق القائمة الجانبية على الموبايل +
// مزامنة عنوان أعلى الصفحة). لا يلمس أي منطق موجود في app.js، فقط يضيف
// سلوكاً بصرياً فوق ما هو موجود أصلاً.
(function () {
  const appEl      = document.getElementById("app");
  const sidebar    = document.getElementById("sidebar");
  const toggleBtn  = document.getElementById("sidebarToggle");
  const overlay    = document.getElementById("sidebarOverlay");
  const pageTitle  = document.getElementById("pageTitle");

  if (!appEl || !sidebar) return;

  function openSidebar()  { appEl.classList.add("sidebar-open"); }
  function closeSidebar() { appEl.classList.remove("sidebar-open"); }

  toggleBtn?.addEventListener("click", () => {
    appEl.classList.contains("sidebar-open") ? closeSidebar() : openSidebar();
  });
  overlay?.addEventListener("click", closeSidebar);

  // مزامنة عنوان الصفحة أعلى المحتوى مع التبويب المختار، وإغلاق القائمة
  // تلقائياً بعد الاختيار على الشاشات الصغيرة. مستمع إضافي لا يعطّل مستمع
  // app.js الأصلي على نفس الأزرار.
  document.querySelectorAll(".side-nav .tab-btn").forEach((btn) => {
    btn.addEventListener("click", () => {
      if (pageTitle) {
        const icon  = btn.querySelector(".nav-icon")?.textContent || "";
        const label = btn.querySelector(".nav-label")?.textContent || "";
        pageTitle.textContent = `${icon} ${label}`.trim();
      }
      closeSidebar();
    });
  });
})();
