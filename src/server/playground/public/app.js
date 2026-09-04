(() => {
  "use strict";
  const $ = (sel) => document.querySelector(sel);
  const loginScreen  = $("#loginScreen");
  const loginForm    = $("#loginForm");
  const loginPassword = $("#loginPassword");
  const loginError   = $("#loginError");
  const app          = $("#app");
  const chatLog       = $("#chatLog");
  const composer      = $("#composer");
  const composerInput = $("#composerInput");
  const settingsBtn    = $("#settingsBtn");
  const settingsPanel  = $("#settingsPanel");
  const clearBtn       = $("#clearBtn");
  const logoutBtn      = $("#logoutBtn");
  const cfgThreadID    = $("#cfgThreadID");
  const cfgSenderID    = $("#cfgSenderID");
  const cfgIsGroup     = $("#cfgIsGroup");
  const botNameLabel   = $("#botNameLabel");
  async function api(path, opts = {}) {
    const res = await fetch(`/playground${path}`, {
      method: opts.method || "GET",
      headers: { "Content-Type": "application/json" },
      body: opts.body ? JSON.stringify(opts.body) : undefined,
    });
    let data = {};
    try { data = await res.json(); } catch (_) {}
    if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
    return data;
  }
  function showApp() {
    loginScreen.classList.add("hidden");
    app.classList.remove("hidden");
    composerInput.focus();
    api("/api/config").then((cfg) => {
      const pfx = (cfg.prefixes || [])[0];
      botNameLabel.textContent = cfg.botName || "البوت";
      if (pfx) {
        composerInput.placeholder = `اكتب أمراً (مثال: ${pfx}help)…`;
      }
    }).catch(() => {});
  }
  function showLogin() {
    app.classList.add("hidden");
    loginScreen.classList.remove("hidden");
  }
  api("/api/me").then(showApp).catch(showLogin);
  loginForm.addEventListener("submit", async (e) => {
    e.preventDefault();
    loginError.textContent = "";
    try {
      await api("/api/login", {
        method: "POST",
        body: { username: $("#loginUsername").value, password: loginPassword.value },
      });
      loginPassword.value = "";
      showApp();
    } catch (err) {
      loginError.textContent = err.message || "فشل تسجيل الدخول";
    }
  });
  logoutBtn.addEventListener("click", async () => {
    try { await api("/api/logout", { method: "POST" }); } catch (_) {}
    showLogin();
  });
  settingsBtn.addEventListener("click", () => settingsPanel.classList.toggle("hidden"));
  clearBtn.addEventListener("click", () => {
    chatLog.innerHTML = `<div class="chat-hint">تم مسح المحادثة. اكتب رسالة للمتابعة.</div>`;
  });
  function addBubble(text, side, meta) {
    const row = document.createElement("div");
    row.className = `bubble-row ${side}`;
    const bubble = document.createElement("div");
    bubble.className = "bubble";
    bubble.textContent = text;
    if (meta) {
      const metaEl = document.createElement("span");
      metaEl.className = "meta";
      metaEl.textContent = meta;
      bubble.appendChild(metaEl);
    }
    row.appendChild(bubble);
    chatLog.appendChild(row);
    chatLog.scrollTop = chatLog.scrollHeight;
  }
  function timeLabel() {
    return new Date().toLocaleTimeString("ar", { hour: "2-digit", minute: "2-digit" });
  }
  composer.addEventListener("submit", async (e) => {
    e.preventDefault();
    const text = composerInput.value.trim();
    if (!text) return;
    addBubble(text, "out", timeLabel());
    composerInput.value = "";
    composerInput.disabled = true;
    try {
      const result = await api("/api/send", {
        method: "POST",
        body: {
          text,
          threadID: cfgThreadID.value.trim() || "playground-thread",
          senderID: cfgSenderID.value.trim() || "playground-user",
          isGroup: cfgIsGroup.checked,
        },
      });
      if (result.noMatch) {
        addBubble("(لم يتطابق أي أمر مع هذه الرسالة — لا رد)", "sys");
      } else if (!result.outbox || !result.outbox.length) {
        addBubble(
          result.matchedCommand
            ? `تم تنفيذ الأمر "${result.matchedCommand}" بدون أي رسالة رد.`
            : "لا رد.",
          "sys"
        );
      } else {
        for (const msg of result.outbox) {
          if (msg.type === "system") {
            addBubble(msg.body, "sys");
          } else {
            addBubble(String(msg.body ?? ""), "in", timeLabel());
            if (msg.attachment) addBubble(msg.attachment, "sys");
          }
        }
      }
    } catch (err) {
      addBubble(`⚠️ خطأ: ${err.message}`, "sys");
    } finally {
      composerInput.disabled = false;
      composerInput.focus();
    }
  });
})();
