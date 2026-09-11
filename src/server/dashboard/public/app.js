"use strict";

const API = "/dashboard/api";

// ─── Helpers ─────────────────────────────────────────────────────────────────
function qs(id) { return document.getElementById(id); }

function escapeHtml(str) {
  return String(str ?? "").replace(/[&<>"']/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c])
  );
}

async function apiFetch(path, opts = {}) {
  const res = await fetch(API + path, {
    headers: { "Content-Type": "application/json" },
    ...opts,
  });
  let data = null;
  try { data = await res.json(); } catch (_) {}
  if (!res.ok) throw new Error(data?.error || `HTTP ${res.status}`);
  return data;
}

function toast(msg, type = "info") {
  const el = document.createElement("div");
  el.className = `toast toast-${type}`;
  el.textContent = msg;
  qs("toastContainer").appendChild(el);
  requestAnimationFrame(() => el.classList.add("show"));
  setTimeout(() => { el.classList.remove("show"); setTimeout(() => el.remove(), 250); }, 3000);
}

// ─── Load & render accounts ───────────────────────────────────────────────────
async function loadAccounts() {
  const container = qs("accountsList");
  container.innerHTML = "<p class='muted'>جاري التحميل...</p>";
  try {
    const { accounts } = await apiFetch("/appstates");
    updateStatusPill(accounts);
    if (!accounts.length) {
      container.innerHTML = "<p class='muted'>لا توجد حسابات بعد. أضف AppState أدناه.</p>";
      return;
    }
    container.innerHTML = accounts.map((a) => renderAccount(a)).join("");
    bindAccountEvents(container, accounts);
  } catch (e) {
    container.innerHTML = `<p class="error-text">${escapeHtml(e.message)}</p>`;
  }
}

function updateStatusPill(accounts) {
  const connected = accounts.filter((a) => a.connected && !a.paused).length;
  const paused    = accounts.filter((a) => a.paused).length;
  const textEl    = qs("statusText");
  const dotEl     = qs("globalStatus").querySelector(".status-dot");
  if (connected > 0) {
    textEl.textContent = `${connected} متصل${paused ? " · " + paused + " موقوف" : ""}`;
    dotEl.style.background = "var(--success)";
  } else if (paused > 0) {
    textEl.textContent = `${paused} موقوف`;
    dotEl.style.background = "var(--warn)";
  } else {
    textEl.textContent = "غير متصل";
    dotEl.style.background = "var(--danger)";
  }
}

function renderAccount(a) {
  const statusLabel = a.paused ? "موقوف مؤقتاً" : a.connected ? "متصل" : "غير متصل";
  const statusClass = a.paused ? "warn" : a.connected ? "connected" : "disconnected";
  const pauseLabel  = a.paused ? "استئناف" : "إيقاف مؤقت";
  const pauseClass  = a.paused ? "btn-success" : "btn-secondary";

  return `
  <div class="account-card" data-index="${a.index}">
    <div class="account-top">
      <div>
        <div class="account-name">${escapeHtml(a.name || "حساب #" + a.index)}</div>
        ${a.fbId ? `<div class="muted small">UID: ${escapeHtml(a.fbId)}</div>` : ""}
        <span class="status-badge status-${statusClass}">${statusLabel}</span>
      </div>
      <div class="account-actions">
        <button class="${pauseClass} btn-small pause-btn" data-index="${a.index}" data-paused="${a.paused}">${pauseLabel}</button>
        <button class="btn-danger btn-small del-btn" data-index="${a.index}">حذف</button>
      </div>
    </div>
    <div class="admin-row">
      <span class="muted small">المطوّر:</span>
      <input class="admin-input" type="text" data-index="${a.index}"
        value="${escapeHtml(a.adminFbId || "")}" placeholder="Facebook ID للمطوّر">
      <button class="btn-secondary btn-small save-admin-btn" data-index="${a.index}">حفظ</button>
    </div>
  </div>`;
}

function bindAccountEvents(container, accounts) {
  // Pause / Resume
  container.querySelectorAll(".pause-btn").forEach((btn) => {
    btn.addEventListener("click", async () => {
      const index  = btn.dataset.index;
      const paused = btn.dataset.paused === "true";
      btn.disabled = true;
      try {
        await apiFetch(`/appstates/${index}/${paused ? "resume" : "pause"}`, { method: "POST" });
        toast(paused ? "تم استئناف البوت" : "تم إيقاف البوت مؤقتاً (الاتصال لا يزال نشطاً)", "success");
        loadAccounts();
      } catch (e) { toast(e.message, "error"); btn.disabled = false; }
    });
  });

  // Delete
  container.querySelectorAll(".del-btn").forEach((btn) => {
    btn.addEventListener("click", async () => {
      const index = btn.dataset.index;
      const name  = accounts.find((a) => String(a.index) === String(index))?.name || `#${index}`;
      if (!confirm(`حذف حساب "${name}"؟ سيتوقف البوت فوراً.`)) return;
      btn.disabled = true;
      try {
        await apiFetch(`/appstates/${index}`, { method: "DELETE" });
        toast("تم حذف الحساب وإيقاف البوت", "success");
        loadAccounts();
      } catch (e) { toast(e.message, "error"); btn.disabled = false; }
    });
  });

  // Save admin ID
  container.querySelectorAll(".save-admin-btn").forEach((btn) => {
    btn.addEventListener("click", async () => {
      const index   = btn.dataset.index;
      const input   = container.querySelector(`.admin-input[data-index="${index}"]`);
      const adminId = input?.value?.trim() || null;
      btn.disabled  = true;
      try {
        await apiFetch(`/appstates/${index}/admin`, {
          method: "PATCH",
          body: JSON.stringify({ adminId }),
        });
        toast("تم حفظ معرّف المطوّر", "success");
        btn.textContent = "تم ✓";
        setTimeout(() => { btn.textContent = "حفظ"; btn.disabled = false; loadAccounts(); }, 1500);
      } catch (e) { toast(e.message, "error"); btn.disabled = false; }
    });
  });
}

// ─── Save new AppState ────────────────────────────────────────────────────────
qs("saveBtn").addEventListener("click", async () => {
  const resultBox = qs("saveResult");
  const raw       = qs("appstateJson").value.trim();
  const adminId   = qs("adminFbId").value.trim() || null;
  if (!raw) { resultBox.textContent = "الصق الـ AppState أولاً"; return; }
  let parsed;
  try { parsed = JSON.parse(raw); } catch { resultBox.textContent = "JSON غير صالح"; return; }
  resultBox.textContent = "جاري الحفظ والاتصال...";
  qs("saveBtn").disabled = true;
  try {
    const data = await apiFetch("/appstates", {
      method: "POST",
      body: JSON.stringify({ appstate: parsed, adminId }),
    });
    resultBox.textContent = data.connectedNow
      ? `✅ تم الاتصال بالحساب #${data.index} — سيظهر اسمه خلال لحظات`
      : "✅ تم الحفظ";
    qs("appstateJson").value = "";
    qs("adminFbId").value    = "";
    loadAccounts();
    toast("تم إضافة الحساب", "success");
  } catch (e) {
    resultBox.textContent = "❌ " + e.message;
    toast(e.message, "error");
  } finally {
    qs("saveBtn").disabled = false;
  }
});

// ─── Refresh button ───────────────────────────────────────────────────────────
qs("refreshBtn").addEventListener("click", loadAccounts);

// ─── Auto-refresh every 30 s ─────────────────────────────────────────────────
loadAccounts();
setInterval(loadAccounts, 30_000);
