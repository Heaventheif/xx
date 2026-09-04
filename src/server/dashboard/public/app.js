"use strict";
const API = "/dashboard/api";
let selectedBot = 1;
let broadcastSelection = new Map();

function qs(id) { return document.getElementById(id); }

async function api(path, opts = {}) {
  const res = await fetch(API + path + (path.includes("?") ? "&" : "?") + "bot=" + selectedBot, {
    credentials: "same-origin",
    headers: { "Content-Type": "application/json" },
    ...opts,
  });
  let data = null;
  try { data = await res.json(); } catch (_) {}
  if (!res.ok) {
    const err = new Error(data?.error || `HTTP ${res.status}`);
    err.status = res.status;
    throw err;
  }
  return data;
}

async function checkAuth() {
  try {
    await api("/me");
    showApp();
  } catch (_) {
    showLogin();
  }
}
function showLogin() {
  qs("loginScreen").classList.remove("hidden");
  qs("app").classList.add("hidden");
}
function showApp() {
  qs("loginScreen").classList.add("hidden");
  qs("app").classList.remove("hidden");
  refreshBotSelect();
  loadOverview();
}

qs("loginForm").addEventListener("submit", async (e) => {
  e.preventDefault();
  qs("loginError").textContent = "";
  const username = qs("loginUsername").value;
  const password = qs("loginPassword").value;
  try {
    const res = await fetch(API + "/login", {
      method: "POST",
      credentials: "same-origin",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ username, password }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data?.error || "فشل الدخول");
    qs("loginPassword").value = "";
    showApp();
  } catch (err) {
    qs("loginError").textContent = err.message;
  }
});

qs("registerForm").addEventListener("submit", async (e) => {
  e.preventDefault();
  qs("loginError").textContent = "";
  const username = qs("registerUsername").value;
  const password = qs("registerPassword").value;
  try {
    const res = await fetch(API + "/register", {
      method: "POST",
      credentials: "same-origin",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ username, password }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data?.error || "فشل إنشاء الحساب");
    qs("registerPassword").value = "";
    showApp();
  } catch (err) {
    qs("loginError").textContent = err.message;
  }
});

let showingRegister = false;
qs("authToggleBtn").addEventListener("click", () => {
  showingRegister = !showingRegister;
  qs("loginForm").classList.toggle("hidden", showingRegister);
  qs("registerForm").classList.toggle("hidden", !showingRegister);
  qs("authSubtitle").textContent = showingRegister ? "أنشئ حساباً جديداً للمتابعة" : "سجّل الدخول للمتابعة";
  qs("authToggleBtn").textContent = showingRegister ? "لديك حساب بالفعل؟ سجّل الدخول" : "ليس لديك حساب؟ أنشئ واحداً";
  qs("loginError").textContent = "";
});

qs("logoutBtn").addEventListener("click", async () => {
  try { await fetch(API + "/logout", { method: "POST", credentials: "same-origin" }); } catch (_) {}
  showLogin();
});

// ─── Main Tab Switching ───
document.querySelectorAll(".tab-btn").forEach((btn) => {
  btn.addEventListener("click", () => {
    document.querySelectorAll(".tab-btn").forEach((b) => b.classList.remove("active"));
    document.querySelectorAll(".tab-panel").forEach((p) => p.classList.remove("active"));
    btn.classList.add("active");
    qs("tab-" + btn.dataset.tab).classList.add("active");
    if (btn.dataset.tab === "groups")   loadGroups();
    if (btn.dataset.tab === "requests") loadRequests();
    if (btn.dataset.tab === "bans")     loadBans();
    if (btn.dataset.tab === "appstate") loadAppstates();
    if (btn.dataset.tab === "commands") loadCommandsList();
    if (btn.dataset.tab === "facebook") initFacebookTab();
  });
});

async function refreshBotSelect() {
  try {
    const data = await api("/appstates");
    const sel = qs("botSelect");
    sel.innerHTML = "";
    const connected = data.accounts.filter((a) => a.connected);
    const list = connected.length ? connected : [{ index: selectedBot || 1, name: null }];
    for (const a of list) {
      const opt = document.createElement("option");
      opt.value = a.index;
      opt.textContent = a.name || `حساب #${a.index}`;
      sel.appendChild(opt);
    }
    sel.value = selectedBot;
    sel.onchange = () => { selectedBot = parseInt(sel.value); };
  } catch (_) {}
}

function fmtUptime(sec) {
  const d = Math.floor(sec / 86400);
  const h = Math.floor((sec % 86400) / 3600);
  const m = Math.floor((sec % 3600) / 60);
  if (d > 0) return `${d}ي ${h}س ${m}د`;
  if (h > 0) return `${h}س ${m}د`;
  return `${m}د ${sec % 60}ث`;
}

async function loadOverview() {
  const cards = qs("statsCards");
  cards.innerHTML = "<p class='muted'>جاري التحميل...</p>";
  try {
    const s = await api("/stats");
    const items = [
      ["⏱️ وقت التشغيل", fmtUptime(s.uptimeSeconds)],
      ["🔌 الحسابات المتصلة", s.bots.connected],
      ["📦 الأوامر المحمّلة", s.commandsLoaded],
      ["🗄️ قاعدة البيانات", s.db.connected ? "✅ متصلة" : "⚠️ غير متصلة"],
      ["🧠 مستخدمون بالذاكرة", s.users.inMemory],
      ["🚫 مجموعات محظورة", s.bans.groups],
      ["🚫 مستخدمون محظورون", s.bans.users],
      ["👥 مجموعات (مخزّنة مؤقتاً)", s.groupsCached],
      ["💾 RAM (RSS)", s.memory.rssMB + " MB"],
      ["💾 Heap مستخدم", s.memory.heapUsedMB + " / " + s.memory.heapTotalMB + " MB"],
      ["🖥️ ذاكرة النظام الحرة", s.memory.systemFreeMB + " / " + s.memory.systemTotalMB + " MB"],
    ];
    cards.innerHTML = items.map(([label, value]) => `
      <div class="card">
        <div class="label">${label}</div>
        <div class="value">${value}</div>
      </div>
    `).join("");
  } catch (e) {
    cards.innerHTML = `<p class="error-text">${e.message}</p>`;
  }
}
qs("refreshStatsBtn").addEventListener("click", loadOverview);

async function loadGroups(force = false) {
  const list = qs("groupsList");
  list.innerHTML = "<p class='muted'>جاري التحميل...</p>";
  try {
    const q = qs("groupSearch").value.trim();
    const data = await api(`/groups?q=${encodeURIComponent(q)}${force ? "&refresh=1" : ""}`);
    qs("groupsCount").textContent = `${data.groups.length} / ${data.total}`;
    if (!data.groups.length) {
      list.innerHTML = "<p class='muted'>لا توجد مجموعات مطابقة.</p>";
      return;
    }
    list.innerHTML = data.groups.map((g) => `
      <div class="list-item" data-gid="${g.threadID}">
        <div class="info">
          <div class="name">👥 ${escapeHtml(g.name)}</div>
          <div class="meta">🆔 ${g.threadID}${g.memberCount != null ? " · 👤 " + g.memberCount : ""}</div>
        </div>
        <div class="actions">
          <button class="btn-danger leave-btn">مغادرة</button>
        </div>
      </div>
    `).join("");
    list.querySelectorAll(".leave-btn").forEach((btn) => {
      btn.addEventListener("click", async (e) => {
        const item = e.target.closest(".list-item");
        const gid = item.dataset.gid;
        if (!confirm("هل أنت متأكد من مغادرة هذه المجموعة؟")) return;
        btn.disabled = true;
        btn.textContent = "...";
        try {
          await api(`/groups/${gid}/leave`, { method: "POST" });
          item.remove();
        } catch (err) {
          alert("فشل: " + err.message);
          btn.disabled = false;
          btn.textContent = "مغادرة";
        }
      });
    });
  } catch (e) {
    list.innerHTML = `<p class="error-text">${e.message}</p>`;
  }
}

qs("refreshGroupsBtn").addEventListener("click", () => loadGroups(true));
qs("groupSearch").addEventListener("input", debounce(() => loadGroups(), 400));

async function loadRequests() {
  const list = qs("requestsList");
  list.innerHTML = "<p class='muted'>جاري التحميل...</p>";
  try {
    const data = await api("/requests");
    if (qs("requestsCount")) qs("requestsCount").textContent = data.requests.length + " طلب";
    if (!data.requests.length) {
      list.innerHTML = "<p class='muted'>لا توجد طلبات معلّقة.</p>";
      return;
    }
    list.innerHTML = data.requests.map((r) => `
      <div class="list-item" data-tid="${r.threadID}">
        <div class="info">
          <div class="name">${r.isGroup ? "👥" : "👤"} ${escapeHtml(r.name)}</div>
          <div class="meta">🆔 ${r.threadID} · 📁 ${r.folder}${r.preview ? " · 💬 " + escapeHtml(r.preview) : ""}</div>
        </div>
        <div class="actions">
          <button class="btn-primary accept-btn">✅ قبول</button>
          <button class="btn-danger reject-btn">❌ رفض</button>
        </div>
      </div>
    `).join("");
    list.querySelectorAll(".accept-btn, .reject-btn").forEach((btn) => {
      btn.addEventListener("click", async (e) => {
        const item = e.target.closest(".list-item");
        const tid = item.dataset.tid;
        const accept = btn.classList.contains("accept-btn");
        item.querySelectorAll("button").forEach((b) => (b.disabled = true));
        try {
          await api(`/requests/${tid}/${accept ? "accept" : "reject"}`, { method: "POST" });
          item.remove();
        } catch (err) {
          alert("فشل: " + err.message);
          item.querySelectorAll("button").forEach((b) => (b.disabled = false));
        }
      });
    });
  } catch (e) {
    list.innerHTML = `<p class="error-text">${e.message}</p>`;
  }
}
qs("refreshRequestsBtn").addEventListener("click", loadRequests);

// ─── Broadcast ───
function renderBroadcastChips() {
  const wrap = qs("broadcastSelected");
  wrap.innerHTML = [...broadcastSelection.entries()].map(([id, name]) => `
    <span class="chip" data-id="${id}">${escapeHtml(name)}
      <button data-remove="${id}">×</button>
    </span>
  `).join("");
  wrap.querySelectorAll("[data-remove]").forEach((b) => {
    b.addEventListener("click", () => {
      broadcastSelection.delete(b.dataset.remove);
      renderBroadcastChips();
    });
  });
}
async function searchBroadcastGroups() {
  const picker = qs("broadcastPicker");
  picker.innerHTML = "<p class='muted'>جاري البحث...</p>";
  try {
    const q = qs("broadcastSearch").value.trim();
    const data = await api(`/groups?q=${encodeURIComponent(q)}`);
    if (!data.groups.length) {
      picker.innerHTML = "<p class='muted'>لا نتائج.</p>";
      return;
    }
    picker.innerHTML = data.groups.slice(0, 30).map((g) => `
      <div class="list-item" data-gid="${g.threadID}" data-name="${escapeHtml(g.name)}">
        <div class="info"><div class="name">👥 ${escapeHtml(g.name)}</div><div class="meta">🆔 ${g.threadID}</div></div>
        <div class="actions"><button class="btn-secondary add-btn">إضافة</button></div>
      </div>
    `).join("");
    picker.querySelectorAll(".add-btn").forEach((btn) => {
      btn.addEventListener("click", (e) => {
        const item = e.target.closest(".list-item");
        broadcastSelection.set(item.dataset.gid, item.dataset.name);
        renderBroadcastChips();
      });
    });
  } catch (e) {
    picker.innerHTML = `<p class="error-text">${e.message}</p>`;
  }
}
qs("broadcastSearchBtn").addEventListener("click", searchBroadcastGroups);
qs("broadcastSendBtn").addEventListener("click", async () => {
  const resultBox = qs("broadcastResult");
  const message = qs("broadcastMessage").value;
  const threadIDs = [...broadcastSelection.keys()];
  if (!threadIDs.length) { resultBox.textContent = "❌ اختر مجموعة واحدة على الأقل"; return; }
  if (!message.trim()) { resultBox.textContent = "❌ الرسالة فارغة"; return; }
  resultBox.textContent = "جاري الإرسال...";
  try {
    const data = await api("/broadcast", {
      method: "POST",
      body: JSON.stringify({ threadIDs, message }),
    });
    resultBox.textContent = data.results.map((r) =>
      r.ok ? `✅ ${broadcastSelection.get(r.threadID) || r.threadID}` : `❌ ${broadcastSelection.get(r.threadID) || r.threadID}: ${r.error}`
    ).join("\n");
  } catch (e) {
    resultBox.textContent = "❌ " + e.message;
  }
});

// ─── Bans ───
async function loadBans() {
  qs("bannedGroupsList").innerHTML = "<p class='muted'>جاري التحميل...</p>";
  qs("bannedUsersList").innerHTML = "";
  try {
    const data = await api("/bans");
    const renderList = (ids, type) => ids.length
      ? ids.map((id) => `
          <div class="list-item" data-id="${id}" data-type="${type}">
            <div class="info"><div class="name">🆔 ${id}</div></div>
            <div class="actions"><button class="btn-secondary unban-btn">رفع الحظر</button></div>
          </div>
        `).join("")
      : "<p class='muted'>لا يوجد</p>";
    qs("bannedGroupsList").innerHTML = renderList(data.groups, "group");
    qs("bannedUsersList").innerHTML = renderList(data.users, "user");
    document.querySelectorAll(".unban-btn").forEach((btn) => {
      btn.addEventListener("click", async (e) => {
        const item = e.target.closest(".list-item");
        btn.disabled = true;
        try {
          await api("/bans", { method: "DELETE", body: JSON.stringify({ type: item.dataset.type, targetID: item.dataset.id }) });
          item.remove();
        } catch (err) {
          alert("فشل: " + err.message);
          btn.disabled = false;
        }
      });
    });
  } catch (e) {
    qs("bannedGroupsList").innerHTML = `<p class="error-text">${e.message}</p>`;
  }
}
qs("banAddBtn").addEventListener("click", async () => {
  const type = qs("banType").value;
  const targetID = qs("banTargetID").value.trim();
  const reason = qs("banReason").value.trim();
  qs("banError").textContent = "";
  if (!targetID) { qs("banError").textContent = "❌ أدخل المعرّف"; return; }
  try {
    await api("/bans", { method: "POST", body: JSON.stringify({ type, targetID, reason }) });
    qs("banTargetID").value = "";
    qs("banReason").value = "";
    loadBans();
  } catch (e) {
    qs("banError").textContent = "❌ " + e.message;
  }
});

// ─── AppStates ───
async function loadAppstates() {
  const list = qs("appstateList");
  list.innerHTML = "<p class='muted'>جاري التحميل...</p>";
  try {
    const data = await api("/appstates");
    const isolationNote = data.isolated
      ? "<p class='muted small'>🔒 كل مستخدم يرى حساباته الخاصة فقط (خزنة مشفّرة).</p>"
      : "<p class='muted small'>⚠️ خزنة العزل غير مفعّلة — كل الحسابات مشتركة بين كل المستخدمين.</p>";
    list.innerHTML = isolationNote + (data.accounts.map((a) => `
      <div class="list-item">
        <div class="info"><div class="name">🔌 ${escapeHtml(a.name || `حساب #${a.index}`)}</div><div class="meta">${a.connected ? "✅ متصل" : "⏳ بانتظار الاتصال"}</div></div>
        <button class="btn-danger btn-small" data-del-appstate="${a.index}">حذف</button>
      </div>
    `).join("") || "<p class='muted'>لا يوجد حسابات مضافة بعد.</p>");
    list.querySelectorAll("[data-del-appstate]").forEach((btn) => {
      btn.addEventListener("click", async () => {
        if (!confirm("حذف هذا الحساب؟ سيتوقف عن العمل بعد إعادة التشغيل التالية.")) return;
        try {
          await api("/appstates/" + btn.dataset.delAppstate, { method: "DELETE" });
          loadAppstates();
          refreshBotSelect();
        } catch (e) {
          alert("❌ " + e.message);
        }
      });
    });
  } catch (e) {
    list.innerHTML = `<p class="error-text">${e.message}</p>`;
  }
}
qs("appstateSaveBtn").addEventListener("click", async () => {
  const resultBox = qs("appstateResult");
  const appstateText = qs("appstateJson").value.trim();
  if (!appstateText) { resultBox.textContent = "❌ الصق الـ AppState أولاً"; return; }
  let parsed;
  try { parsed = JSON.parse(appstateText); } catch { resultBox.textContent = "❌ JSON غير صالح"; return; }
  resultBox.textContent = "جاري الحفظ والاتصال... قد يستغرق بضع ثوانٍ";
  try {
    const data = await api("/appstates", { method: "POST", body: JSON.stringify({ appstate: parsed }) });
    resultBox.textContent = data.connectedNow
      ? "✅ تم الاتصال بالحساب الجديد بنجاح — سيظهر اسمه خلال لحظات"
      : "✅ " + (data.note || "تم الحفظ");
    qs("appstateJson").value = "";
    loadAppstates();
    refreshBotSelect();
  } catch (e) {
    resultBox.textContent = "❌ " + e.message;
  }
});

// ─── Commands ───
let _cmdsData = [];
async function loadCommandsList(force = false) {
  const list = qs("cmdsList");
  if (list) list.innerHTML = "<p class='muted'>جاري التحميل...</p>";
  try {
    const data = await api("/commands");
    _cmdsData = data.commands || [];
    renderCommandsList(_cmdsData);
    if (qs("cmdsCount")) qs("cmdsCount").textContent = `${_cmdsData.length} أمر`;
  } catch (e) {
    if (list) list.innerHTML = `<p class="error-text">❌ ${e.message}</p>`;
  }
}
function renderCommandsList(cmds) {
  const list = qs("cmdsList");
  if (!list) return;
  if (!cmds.length) { list.innerHTML = "<p class='muted'>لا توجد أوامر.</p>"; return; }
  const byCat = new Map();
  for (const cmd of cmds) {
    if (!byCat.has(cmd.category)) byCat.set(cmd.category, []);
    byCat.get(cmd.category).push(cmd);
  }
  let html = "";
  for (const [cat, items] of byCat) {
    html += `<div class="cmd-category-header">${escapeHtml(cat)}</div>`;
    for (const cmd of items) {
      const enabledChk = cmd.enabled  ? "checked" : "";
      const hiddenChk  = cmd.hidden   ? "checked" : "";
      const rowClass   = cmd.enabled  ? "" : " cmd-row-disabled";
      html += `
<div class="list-item cmd-row${rowClass}" data-cmd="${escapeHtml(cmd.name)}">
  <div class="cmd-info">
    <strong>${escapeHtml(cmd.name)}</strong>
    <span class="muted small">${escapeHtml(cmd.category)}</span>
  </div>
  <div class="cmd-toggles">
    <label class="toggle-label" title="تشغيل / تعطيل الأمر كلياً">
      <input type="checkbox" class="cmd-toggle-enabled" ${enabledChk}>
      <span class="toggle-track"></span>
      <span class="toggle-text">تفعيل</span>
    </label>
    <label class="toggle-label" title="إخفاء من قائمة help">
      <input type="checkbox" class="cmd-toggle-hidden" ${hiddenChk}>
      <span class="toggle-track"></span>
      <span class="toggle-text">إخفاء</span>
    </label>
  </div>
</div>`;
    }
  }
  list.innerHTML = html;
  list.querySelectorAll(".cmd-toggle-enabled").forEach(chk => {
    chk.addEventListener("change", async () => {
      const row  = chk.closest(".cmd-row");
      const name = row.dataset.cmd;
      const enabled = chk.checked;
      try {
        await api("/commands/" + encodeURIComponent(name), {
          method: "PATCH",
          body: JSON.stringify({ enabled }),
        });
        const cmd = _cmdsData.find(c => c.name === name);
        if (cmd) cmd.enabled = enabled;
        row.classList.toggle("cmd-row-disabled", !enabled);
      } catch (e) {
        chk.checked = !enabled;
        alert("❌ " + e.message);
      }
    });
  });
  list.querySelectorAll(".cmd-toggle-hidden").forEach(chk => {
    chk.addEventListener("change", async () => {
      const row  = chk.closest(".cmd-row");
      const name = row.dataset.cmd;
      const hidden = chk.checked;
      try {
        await api("/commands/" + encodeURIComponent(name), {
          method: "PATCH",
          body: JSON.stringify({ hidden }),
        });
        const cmd = _cmdsData.find(c => c.name === name);
        if (cmd) cmd.hidden = hidden;
      } catch (e) {
        chk.checked = !hidden;
        alert("❌ " + e.message);
      }
    });
  });
}
if (qs("refreshCmdsBtn")) {
  qs("refreshCmdsBtn").addEventListener("click", () => loadCommandsList(true));
}
if (qs("cmdSearch")) {
  qs("cmdSearch").addEventListener("input", debounce(() => {
    const q = qs("cmdSearch").value.trim().toLowerCase();
    const filtered = q ? _cmdsData.filter(c =>
      c.name.toLowerCase().includes(q) || c.category.toLowerCase().includes(q)
    ) : _cmdsData;
    renderCommandsList(filtered);
  }, 250));
}

// ═══════════════════════════════════════════════════════════
//  📘 FACEBOOK TAB LOGIC
// ═══════════════════════════════════════════════════════════

let _fbTabInitialized = false;

/** Switch between Facebook sub-tabs */
function initFbSubTabs() {
  document.querySelectorAll(".fb-tab-btn").forEach(btn => {
    btn.addEventListener("click", () => {
      document.querySelectorAll(".fb-tab-btn").forEach(b => b.classList.remove("active"));
      document.querySelectorAll(".fb-tab-panel").forEach(p => p.classList.remove("active"));
      btn.classList.add("active");
      qs("fbtab-" + btn.dataset.fbtab).classList.add("active");

      // Lazy-load content per sub-tab
      if (btn.dataset.fbtab === "friends")  loadFbFriends();
      if (btn.dataset.fbtab === "msgreq")   loadFbMsgRequests();
      if (btn.dataset.fbtab === "stories")  loadFbStories();
    });
  });
}

/** Initialize the Facebook tab (called once on first open) */
async function initFacebookTab() {
  if (!_fbTabInitialized) {
    _fbTabInitialized = true;
    initFbSubTabs();
    bindFbActions();
  }
  loadFbProfile();
  loadFbFriends();
}

/** Load and display bot account profile */
async function loadFbProfile() {
  qs("fbProfileName").textContent = "جاري التحميل...";
  qs("fbProfileUid").textContent = "";
  try {
    const data = await api("/facebook/profile");
    const p = data.profile;
        qs("fbProfileName").textContent = p?.name || p?.fullName || p?.firstName || data.botName || "غير معروف";
    qs("fbProfileUid").textContent = `UID: ${data.uid}`;
    if (p?.thumbSrc || p?.profilePicture) {
      qs("fbAvatar").innerHTML = `<img src="${fbImg(p.thumbSrc || p.profilePicture)}" alt="avatar">`;
    }
  } catch (e) {
    qs("fbProfileName").textContent = "❌ " + e.message;
  }
}
qs("fbRefreshProfileBtn").addEventListener("click", loadFbProfile);

// ─── Friends List ───
let _fbFriendsData = [];
async function loadFbFriends(force = false) {
  const list = qs("fbFriendsList");
  list.innerHTML = "<p class='muted'>جاري التحميل...</p>";
  try {
    const q = (qs("fbFriendSearch")?.value || "").trim();
    const data = await api(`/facebook/friends?q=${encodeURIComponent(q)}${force ? "&refresh=1" : ""}`);
    _fbFriendsData = data.friends || [];
    qs("fbFriendsCount").textContent = `${data.friends.length} / ${data.total}`;
    renderFbFriends(data.friends);
  } catch (e) {
    list.innerHTML = `<p class="error-text">❌ ${e.message}</p>`;
  }
}
function renderFbFriends(friends) {
  const list = qs("fbFriendsList");
  if (!friends.length) {
    list.innerHTML = "<p class='muted'>لا يوجد أصدقاء مطابقون.</p>";
    return;
  }
  list.innerHTML = friends.slice(0, 100).map(f => `
    <div class="list-item fb-friend-row" data-uid="${f.userID}">
      <div class="info">
        <div class="name">
          ${f.profilePicture ? `<img class="fb-mini-avatar" src="${fbImg(f.profilePicture)}" alt="">` : "👤"}
          ${escapeHtml(f.fullName || f.firstName || "مجهول")}
          ${f.isBirthday ? "🎂" : ""}
        </div>
        <div class="meta">
          🆔 ${f.userID}
          ${f.vanity ? ` · @${escapeHtml(f.vanity)}` : ""}
          ${f.gender && f.gender !== "unknown" ? ` · ${f.gender === "male_singular" ? "ذكر" : "أنثى"}` : ""}
        </div>
      </div>
      <div class="actions">
        <button class="btn-secondary btn-small fb-msg-friend-btn" data-uid="${f.userID}">💬 رسالة</button>
        <button class="btn-danger btn-small fb-unfriend-inline-btn" data-uid="${f.userID}" data-name="${escapeHtml(f.fullName || f.userID)}">❌</button>
      </div>
    </div>
  `).join("");

  // Unfriend inline
  list.querySelectorAll(".fb-unfriend-inline-btn").forEach(btn => {
    btn.addEventListener("click", async () => {
      const { uid, name } = btn.dataset;
      if (!confirm(`إلغاء صداقة "${name}"؟`)) return;
      btn.disabled = true;
      try {
        await api("/facebook/friends/unfriend", { method: "POST", body: JSON.stringify({ uid }) });
        btn.closest(".list-item").remove();
      } catch (e) {
        alert("❌ " + e.message);
        btn.disabled = false;
      }
    });
  });

  // Quick message to friend
  list.querySelectorAll(".fb-msg-friend-btn").forEach(btn => {
    btn.addEventListener("click", () => {
      // Switch to post sub-tab and fill in the thread ID
      document.querySelector('[data-fbtab="post"]')?.click();
      if (qs("fbSendMsgTID")) qs("fbSendMsgTID").value = btn.dataset.uid;
    });
  });
}

qs("fbRefreshFriendsBtn").addEventListener("click", () => loadFbFriends(true));
qs("fbFriendSearch").addEventListener("input", debounce(() => loadFbFriends(), 400));

// ─── Friend Request accept/reject ───
qs("fbAcceptFriendBtn").addEventListener("click", async () => {
  const uid = qs("fbFriendReqUID").value.trim();
  const box = qs("fbFriendReqResult");
  if (!uid) { box.textContent = "❌ أدخل UID"; return; }
  box.textContent = "جاري القبول...";
  try {
    await api("/facebook/friend-request", { method: "POST", body: JSON.stringify({ uid, accept: true }) });
    box.textContent = "✅ تم قبول طلب الصداقة!";
    qs("fbFriendReqUID").value = "";
  } catch (e) { box.textContent = "❌ " + e.message; }
});
qs("fbRejectFriendBtn").addEventListener("click", async () => {
  const uid = qs("fbFriendReqUID").value.trim();
  const box = qs("fbFriendReqResult");
  if (!uid) { box.textContent = "❌ أدخل UID"; return; }
  box.textContent = "جاري الرفض...";
  try {
    await api("/facebook/friend-request", { method: "POST", body: JSON.stringify({ uid, accept: false }) });
    box.textContent = "✅ تم رفض طلب الصداقة.";
    qs("fbFriendReqUID").value = "";
  } catch (e) { box.textContent = "❌ " + e.message; }
});

// ─── Follow / Unfollow ───
qs("fbFollowBtn").addEventListener("click", async () => {
  const uid = qs("fbFollowUID").value.trim();
  const box = qs("fbFollowResult");
  if (!uid) { box.textContent = "❌ أدخل UID"; return; }
  box.textContent = "جاري...";
  try {
    await api("/facebook/follow", { method: "POST", body: JSON.stringify({ uid, follow: true }) });
    box.textContent = "✅ تمت المتابعة!";
  } catch (e) { box.textContent = "❌ " + e.message; }
});
qs("fbUnfollowBtn").addEventListener("click", async () => {
  const uid = qs("fbFollowUID").value.trim();
  const box = qs("fbFollowResult");
  if (!uid) { box.textContent = "❌ أدخل UID"; return; }
  box.textContent = "جاري...";
  try {
    await api("/facebook/follow", { method: "POST", body: JSON.stringify({ uid, follow: false }) });
    box.textContent = "✅ تم إلغاء المتابعة.";
  } catch (e) { box.textContent = "❌ " + e.message; }
});

// ─── Message Requests ───
async function loadFbMsgRequests() {
  const list = qs("fbMsgReqList");
  list.innerHTML = "<p class='muted'>جاري التحميل...</p>";
  try {
    const data = await api("/requests");
    if (!data.requests.length) {
      list.innerHTML = "<p class='muted'>لا توجد طلبات معلّقة.</p>";
      return;
    }
    list.innerHTML = data.requests.map(r => `
      <div class="list-item" data-tid="${r.threadID}">
        <div class="info">
          <div class="name">${r.isGroup ? "👥" : "👤"} ${escapeHtml(r.name)}</div>
          <div class="meta">📁 ${r.folder}${r.preview ? " · " + escapeHtml(r.preview) : ""}</div>
        </div>
        <div class="actions">
          <button class="btn-primary fb-accept-msg-btn">✅</button>
          <button class="btn-danger fb-reject-msg-btn">❌</button>
        </div>
      </div>
    `).join("");
    list.querySelectorAll(".fb-accept-msg-btn, .fb-reject-msg-btn").forEach(btn => {
      btn.addEventListener("click", async e => {
        const item = e.target.closest(".list-item");
        const tid = item.dataset.tid;
        const accept = btn.classList.contains("fb-accept-msg-btn");
        item.querySelectorAll("button").forEach(b => b.disabled = true);
        try {
          await api(`/requests/${tid}/${accept ? "accept" : "reject"}`, { method: "POST" });
          item.remove();
        } catch (e) {
          alert("❌ " + e.message);
          item.querySelectorAll("button").forEach(b => b.disabled = false);
        }
      });
    });
  } catch (e) {
    list.innerHTML = `<p class="error-text">❌ ${e.message}</p>`;
  }
}
qs("fbLoadMsgReqBtn").addEventListener("click", loadFbMsgRequests);

// Accept all message requests
async function acceptAllMsgRequests(resultEl) {
  if (resultEl) resultEl.textContent = "جاري القبول...";
  try {
    const data = await api("/facebook/message-requests/accept-all", { method: "POST" });
    const msg = `✅ تم قبول ${data.processed} طلب مراسلة`;
    if (resultEl) resultEl.textContent = msg;
    else alert(msg);
    loadFbMsgRequests();
  } catch (e) {
    const msg = "❌ " + e.message;
    if (resultEl) resultEl.textContent = msg;
    else alert(msg);
  }
}
qs("fbAcceptAllMsgBtn").addEventListener("click", () => acceptAllMsgRequests(qs("fbMsgReqResult")));

// ─── Post / Story Creation ───
qs("fbPostSendBtn").addEventListener("click", async () => {
  const body    = qs("fbPostBody").value.trim();
  const privacy = qs("fbPostPrivacy").value;
  const box     = qs("fbPostResult");
  if (!body) { box.textContent = "❌ النص فارغ"; return; }
  box.textContent = "جاري النشر...";
  try {
    await api("/facebook/post", { method: "POST", body: JSON.stringify({ body, privacy }) });
    box.textContent = "✅ تم نشر المنشور بنجاح!";
    qs("fbPostBody").value = "";
  } catch (e) { box.textContent = "❌ " + e.message; }
});

// Send direct message
qs("fbSendMsgBtn").addEventListener("click", async () => {
  const threadID = qs("fbSendMsgTID").value.trim();
  const message  = qs("fbSendMsgBody").value.trim();
  const box      = qs("fbSendMsgResult");
  if (!threadID) { box.textContent = "❌ أدخل Thread ID"; return; }
  if (!message)  { box.textContent = "❌ الرسالة فارغة"; return; }
  box.textContent = "جاري الإرسال...";
  try {
    await api("/facebook/send-message", { method: "POST", body: JSON.stringify({ threadID, message }) });
    box.textContent = "✅ تم الإرسال!";
    qs("fbSendMsgBody").value = "";
  } catch (e) { box.textContent = "❌ " + e.message; }
});

// React to post
qs("fbReactPostBtn").addEventListener("click", async () => {
  const postID   = qs("fbReactPostID").value.trim();
  const reaction = qs("fbReactType").value;
  const box      = qs("fbReactResult");
  if (!postID) { box.textContent = "❌ أدخل Post ID"; return; }
  box.textContent = "جاري التفاعل...";
  try {
    await api("/facebook/react-post", { method: "POST", body: JSON.stringify({ postID, reaction }) });
    box.textContent = "✅ تم التفاعل!";
  } catch (e) { box.textContent = "❌ " + e.message; }
});

// ─── User Info Lookup ───
qs("fbLookupBtn").addEventListener("click", async () => {
  const uid = qs("fbLookupUID").value.trim();
  const card = qs("fbUserInfoCard");
  if (!uid) return;
  card.classList.add("hidden");
  card.innerHTML = "جاري البحث...";
  card.classList.remove("hidden");
  try {
    const data = await api(`/facebook/user-info?uid=${encodeURIComponent(uid)}`);
    const u = data.user;
    if (!u) { card.innerHTML = "<p class='error-text'>❌ المستخدم غير موجود</p>"; return; }
    card.innerHTML = `
      <div class="fb-user-card-inner">
        ${u.thumbSrc ? `<img class="fb-card-avatar" src="${fbImg(u.thumbSrc)}" alt="">` : "<div class='fb-card-avatar-placeholder'>👤</div>"}
        <div class="fb-card-info">
          <div class="fb-card-name">${escapeHtml(u.name || "غير معروف")}</div>
          <div class="muted small">🆔 ${escapeHtml(data.uid)}</div>
          ${u.vanity ? `<div class="muted small">🔗 @${escapeHtml(u.vanity)}</div>` : ""}
          ${u.profileUrl ? `<div class="muted small"><a href="${escapeHtml(u.profileUrl)}" target="_blank">🌐 الملف الشخصي</a></div>` : ""}
          ${u.isFriend !== undefined ? `<div class="muted small">${u.isFriend ? "✅ صديق" : "👤 غير صديق"}</div>` : ""}
        </div>
        <div class="fb-card-actions">
          <button class="btn-secondary btn-small" onclick="document.getElementById('fbFollowUID').value='${escapeHtml(data.uid)}'; document.querySelector('[data-fbtab=\\'friendreq\\']').click()">➕ متابعة</button>
          <button class="btn-danger btn-small" onclick="document.getElementById('fbBlockUID').value='${escapeHtml(data.uid)}'; document.querySelector('[data-fbtab=\\'actions\\']').click()">🚫 حظر</button>
        </div>
      </div>
    `;
  } catch (e) {
    card.innerHTML = `<p class="error-text">❌ ${e.message}</p>`;
  }
});

// Thread info
qs("fbThreadInfoBtn").addEventListener("click", async () => {
  const tid = qs("fbThreadInfoTID").value.trim();
  const box = qs("fbThreadInfoResult");
  if (!tid) { box.textContent = "❌ أدخل Thread ID"; return; }
  box.textContent = "جاري الجلب...";
  try {
    const data = await api(`/facebook/thread-info?tid=${encodeURIComponent(tid)}`);
    const t = data.thread;
    box.textContent = JSON.stringify({
      name:          t?.name || t?.threadName,
      threadID:      t?.threadID,
      isGroup:       t?.isGroup,
      participantCount: t?.participantIDs?.length,
      messageCount:  t?.messageCount,
      emoji:         t?.emoji,
      color:         t?.color,
    }, null, 2);
  } catch (e) {
    box.textContent = "❌ " + e.message;
  }
});

// ─── Stories ───
async function loadFbStories() {
  const list   = qs("fbStoriesList");
  const flist  = qs("fbFriendEventsList");
  list.innerHTML  = "<p class='muted'>جاري التحميل...</p>";
  flist.innerHTML = "";
  try {
    const data = await api("/facebook/stories");
    const stories = data.stories || [];
    const fevents = data.friendEvents || [];
    qs("fbStoriesCount").textContent = stories.length;

    if (!stories.length) {
      list.innerHTML = "<p class='muted'>لم يُكتشف أي حدث قصة بعد. ستظهر هنا عند وصول قصص عبر MQTT.</p>";
    } else {
      list.innerHTML = stories.map(s => `
        <div class="list-item">
          <div class="info">
            <div class="name">📸 ${s.type || "story"}</div>
            <div class="meta">
              ${s.senderID ? `👤 ${escapeHtml(s.senderName || s.senderID)}` : ""}
              ${s.preview  ? ` · 💬 ${escapeHtml(String(s.preview).slice(0, 80))}` : ""}
              · 🕐 ${new Date(s.timestamp).toLocaleString("ar")}
            </div>
          </div>
        </div>
      `).join("");
    }

    if (!fevents.length) {
      flist.innerHTML = "<p class='muted'>لا توجد أحداث صداقة مُكتشفة.</p>";
    } else {
      flist.innerHTML = fevents.map(f => `
        <div class="list-item">
          <div class="info">
            <div class="name">👥 ${f.type || "friend_event"}</div>
            <div class="meta">
              ${f.senderID ? `👤 ${escapeHtml(f.senderName || f.senderID)}` : ""}
              · 🕐 ${new Date(f.timestamp).toLocaleString("ar")}
            </div>
          </div>
        </div>
      `).join("");
    }
  } catch (e) {
    list.innerHTML = `<p class="error-text">❌ ${e.message}</p>`;
  }
}
qs("fbRefreshStoriesBtn").addEventListener("click", loadFbStories);
qs("fbClearStoriesBtn").addEventListener("click", async () => {
  await api("/facebook/stories", { method: "DELETE" });
  loadFbStories();
});

// ─── Actions sub-tab ───
function bindFbActions() {
  // Block / Unblock
  qs("fbBlockBtn").addEventListener("click", async () => {
    const uid = qs("fbBlockUID").value.trim();
    const box = qs("fbBlockResult");
    if (!uid) { box.textContent = "❌ أدخل UID"; return; }
    box.textContent = "جاري الحظر...";
    try {
      await api("/facebook/block", { method: "POST", body: JSON.stringify({ uid, blocked: true }) });
      box.textContent = "✅ تم حظر المستخدم!";
    } catch (e) { box.textContent = "❌ " + e.message; }
  });
  qs("fbUnblockBtn").addEventListener("click", async () => {
    const uid = qs("fbBlockUID").value.trim();
    const box = qs("fbBlockResult");
    if (!uid) { box.textContent = "❌ أدخل UID"; return; }
    box.textContent = "جاري رفع الحظر...";
    try {
      await api("/facebook/block", { method: "POST", body: JSON.stringify({ uid, blocked: false }) });
      box.textContent = "✅ تم رفع الحظر!";
    } catch (e) { box.textContent = "❌ " + e.message; }
  });

  // Unfriend from actions tab
  qs("fbUnfriendBtn").addEventListener("click", async () => {
    const uid = qs("fbUnfriendUID").value.trim();
    const box = qs("fbUnfriendResult");
    if (!uid) { box.textContent = "❌ أدخل UID"; return; }
    if (!confirm(`إلغاء صداقة ${uid}؟`)) return;
    box.textContent = "جاري...";
    try {
      await api("/facebook/friends/unfriend", { method: "POST", body: JSON.stringify({ uid }) });
      box.textContent = "✅ تم إلغاء الصداقة.";
      qs("fbUnfriendUID").value = "";
    } catch (e) { box.textContent = "❌ " + e.message; }
  });

  // Accept all (actions tab duplicate)
  qs("fbAcceptAllMsgBtn2").addEventListener("click", () => acceptAllMsgRequests(qs("fbAcceptAllResult")));

  // Force refresh friends
  qs("fbForceRefreshFriendsBtn").addEventListener("click", async () => {
    const box = qs("fbForceRefreshResult");
    box.textContent = "جاري التحديث من فيسبوك...";
    try {
      const data = await api("/facebook/friends?refresh=1");
      box.textContent = `✅ تم تحديث القائمة: ${data.total} صديق`;
      _fbFriendsData = data.friends;
    } catch (e) { box.textContent = "❌ " + e.message; }
  });
}

// ═══════════════════════════════════════════════════════════

function escapeHtml(str) {
  return String(str).replace(/[&<>"']/g, (c) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
  }[c]));
}
/**
 * [FIX] Route Facebook CDN images through the server proxy to avoid CORS/referrer blocks.
 */
function fbImg(url) {
  if (!url) return "";
  try {
    const h = new URL(url).hostname;
    if (/(fbcdn\.net|facebook\.com|fb\.com)$/.test(h))
      return "/dashboard/api/facebook/image-proxy?url=" + encodeURIComponent(url);
  } catch { /* not a URL */ }
  return url;
}
function debounce(fn, ms) {
  let t;
  return (...args) => {
    clearTimeout(t);
    t = setTimeout(() => fn(...args), ms);
  };
}

checkAuth();
