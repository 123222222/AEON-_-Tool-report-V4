/* ============================================================
   RMC Report Assistant — app.js
   ============================================================ */

const API = window.location.origin;

/* ── State ─────────────────────────────────────────────────── */
const state = {
  authenticated: false,
  appInitialized: false,
  currentUser: null,
  isAdmin: false,
  currentGroup:  "AEONMALL",
  originalReportText: "",   // luu noi dung bao cao goc, khong bi ghi de boi Contact/Status
  clockRunning:  true,
  clockInterval: null,
  countdownSec:  300,
  countdownJob:  null,
  countdownRunning: false,
  boxFilled:     [false, false, false, false, false, false],
  currentSiteKey: null,
  currentFileId:  null,
  currentFileName: null,
  sitesData:      {},         // {AEONMALL: {ANVL: ..., ATQB: ...}, ...}
  notesList:      [],
  activeSiteBtn:  null,
  activeItemBtn:  null,
  chartInstances: {},
};

/* ── Helpers ────────────────────────────────────────────────── */
function $(sel, ctx = document) { return ctx.querySelector(sel); }
function $$(sel, ctx = document) { return [...ctx.querySelectorAll(sel)]; }

async function apiFetch(path, opts = {}) {
  const res = await fetch(API + path, {
    headers: { "Content-Type": "application/json" },
    ...opts,
  });
  let data = null;
  try {
    data = await res.json();
  } catch {
    data = null;
  }

  if (!res.ok) {
    const err = new Error((data && data.error) ? data.error : `HTTP ${res.status}`);
    err.status = res.status;
    err.data = data;
    throw err;
  }

  return data;
}

function showToast(title, message, duration = 5000) {
  const wrap = $("#toast-container");
  const el = document.createElement("div");
  el.className = "toast";
  el.innerHTML = `<div class="toast-title">${title}</div>${message}`;
  wrap.appendChild(el);
  setTimeout(() => el.remove(), duration);
}

function copyToClipboard(text) {
  navigator.clipboard.writeText(text).then(() => showToast("Đã copy", "Nội dung đã được sao chép vào clipboard."));
}

/* ── Login / Auth ─────────────────────────────────────────── */
function bindAuthButtons() {
  const ms = $("#btn-login-microsoft");
  const gg = $("#btn-login-google");

  if (ms) ms.onclick = () => { window.location.href = "/api/auth/login/microsoft"; };
  if (gg) gg.onclick = () => { window.location.href = "/api/auth/login/google"; };
}

function applyProviderAvailability(providers = []) {
  const setEnabled = (id, providerName) => {
    const btn = $(id);
    if (!btn) return;
    const enabled = providers.includes(providerName);
    btn.disabled = !enabled;
    btn.title = enabled ? "" : "Provider này chưa được cấu hình ở backend";
  };

  setEnabled("#btn-login-microsoft", "microsoft");
  setEnabled("#btn-login-google", "google");

  if (!providers.length) {
    showLoginScreen(
      "Chưa cấu hình đăng nhập OAuth",
      "Admin cần cấu hình MS_OAUTH_CLIENT_ID / GOOGLE_OAUTH_CLIENT_ID trong Docker .env rồi khởi động lại container."
    );
  }
}

function showLoginScreen(statusText, hintText = "") {
  $("#login-screen").classList.remove("hidden");
  if (statusText) $("#login-status").textContent = statusText;
  if (hintText) $("#login-hint").textContent = hintText;
}

function handleAuthQueryHint() {
  const params = new URLSearchParams(window.location.search);
  const auth = params.get("auth");
  if (!auth) return;

  if (auth === "success") showToast("Đăng nhập thành công", "Bạn đã đăng nhập hệ thống.");
  if (auth === "pending") showToast("Đang chờ duyệt", "Tài khoản của bạn đang chờ admin phê duyệt.");
  if (auth === "failed") showToast("Đăng nhập thất bại", "Không thể xác thực tài khoản.");
  if (auth === "provider_not_configured") showToast("Thiếu cấu hình", "Provider đăng nhập chưa được cấu hình ở backend.");

  history.replaceState({}, document.title, window.location.pathname);
}

async function checkAuth() {
  try {
    const res = await apiFetch("/api/auth/me");
    applyProviderAvailability(res.providers || []);

    if (!res.logged_in) {
      showLoginScreen("Chưa đăng nhập", "Nếu bạn là user mới, đăng nhập một lần để tạo tài khoản chờ duyệt.");
      return;
    }

    if (!res.can_access) {
      showLoginScreen(
        "Tài khoản đang chờ admin phê duyệt",
        "Vui lòng liên hệ admin để được cấp quyền truy cập."
      );
      return;
    }

    onAuthSuccess(res.user);
  } catch {
    showLoginScreen("Không thể kết nối backend.");
  }
}

function onAuthSuccess(user) {
  state.authenticated = true;
  state.currentUser = user || null;
  state.isAdmin = !!user && user.role === "admin";

  $("#login-screen").classList.add("hidden");
  $("#auth-badge").classList.add("ok");
  $("#auth-badge .label").textContent = state.isAdmin ? "Admin" : "Đã đăng nhập";

  const authUser = $("#auth-user");
  if (authUser && user) {
    authUser.textContent = `${user.name || "User"} (${user.email || ""})`;
    authUser.classList.remove("hidden");
  }

  $("#btn-logout")?.classList.remove("hidden");
  if (state.isAdmin) $("#btn-admin")?.classList.remove("hidden");

  if (!state.appInitialized) {
    state.appInitialized = true;
    initApp();
  }
}

/* ── App init ──────────────────────────────────────────────── */
async function initApp() {
  startClock();
  await loadSites();
  renderSiteList(state.currentGroup);
  bindTopbar();
  bindActionStrip();
  startNotificationPoller();
  triggerBackgroundSync();
}

/* ── Clock ──────────────────────────────────────────────────── */
function startClock() {
  state.clockInterval = setInterval(() => {
    if (state.clockRunning) {
      const now = new Date();
      const pad = n => String(n).padStart(2, "0");
      $("#clock-display").textContent = `${pad(now.getHours())}:${pad(now.getMinutes())}:${pad(now.getSeconds())}`;
      $("#clock-display").classList.remove("paused");
    } else {
      $("#clock-display").classList.add("paused");
    }
  }, 1000);
}

function bindTopbar() {
  $("#btn-catch").onclick    = () => { state.clockRunning = false; };
  $("#btn-continue").onclick = () => { state.clockRunning = true;  };
  $("#btn-sync").onclick     = triggerBackgroundSync;
  $("#btn-charts").onclick   = showChartsModal;
  $("#btn-logout").onclick   = async () => {
    await apiFetch("/api/auth/logout", { method: "POST" });
    window.location.href = "/";
  };
  $("#btn-admin").onclick    = () => {
    openModal("admin");
    loadAdminUsers();
  };
}

/* ── Countdown ─────────────────────────────────────────────── */
function startCountdown() {
  clearCountdown();
  state.countdownSec     = 300;
  state.countdownRunning = true;
  const el = $("#countdown-display");

  state.countdownJob = setInterval(() => {
    state.countdownSec--;
    const m = Math.floor(state.countdownSec / 60);
    const s = state.countdownSec % 60;
    const pad = n => String(n).padStart(2, "0");
    el.textContent = `⏳ ${pad(m)}:${pad(s)}`;

    if (state.countdownSec <= 60) el.className = "alert";
    if (state.countdownSec <= 0) {
      clearCountdown();
      el.textContent = "⏰ Contact Site!";
      el.className = "done";
    }
  }, 1000);
}

function clearCountdown() {
  if (state.countdownJob) clearInterval(state.countdownJob);
  state.countdownJob = null;
  state.countdownRunning = false;
  const el = $("#countdown-display");
  el.textContent = "⏳ Đang chờ...";
  el.className = "";
}

/* ── Sites & Items ──────────────────────────────────────────── */
async function loadSites() {
  try {
    state.sitesData = await apiFetch("/api/sites");
  } catch {
    showToast("Lỗi", "Không tải được danh sách sites.");
  }
}

function renderSiteList(group) {
  const list    = $("#site-list");
  list.innerHTML = "";
  state.currentGroup = group;

  // Group tab highlight
  const tabs = $$(".group-tab");
  tabs.forEach(t => t.classList.remove("active-aeon", "active-max"));
  if (group === "AEONMALL") $(".group-tab[data-group='AEONMALL']").classList.add("active-aeon");
  else                       $(".group-tab[data-group='MAXVALUE']").classList.add("active-max");

  const sites = state.sitesData[group] || {};

  Object.keys(sites).forEach(siteKey => {
    const item = document.createElement("div");
    item.className = "site-item";
    const siteSlug = siteKey.replace(/[^a-zA-Z0-9]/g, "-"); // slug an toan cho id

    const btn = document.createElement("button");
    btn.className = "site-btn";
    btn.innerHTML = `<span>${siteKey}</span><span class="chevron">›</span>`;
    btn.onclick = () => toggleSiteItems(siteKey, siteSlug, item, btn);

    const subList = document.createElement("div");
    subList.className = "item-list";
    subList.id = `items-${siteSlug}`;

    item.appendChild(btn);
    item.appendChild(subList);
    list.appendChild(item);
  });
}

async function toggleSiteItems(siteKey, siteSlug, container, btn) {
  const subList = $(`#items-${siteSlug}`);
  const isOpen  = subList.classList.contains("visible");

  // Close all
  $$(".item-list.visible").forEach(l => l.classList.remove("visible"));
  $$(".site-btn.open").forEach(b => b.classList.remove("open"));

  if (isOpen) return;

  btn.classList.add("open");
  subList.classList.add("visible");
  state.currentSiteKey = siteKey;

  // Load items if empty
  if (!subList.children.length) {
    subList.innerHTML = `<div style="padding:4px 8px; color:var(--text-muted); font-size:11px;"><span class="spinner"></span></div>`;
    try {
      const items = await apiFetch(`/api/sites/${encodeURIComponent(siteKey)}/items`);
      subList.innerHTML = "";
      if (!items.length) {
        subList.innerHTML = `<div style="padding:4px 8px; color:var(--text-muted); font-size:11px;">Chưa có file nào trong site này.</div>`;
        return;
      }
      items.forEach(it => {
        const b = document.createElement("button");
        b.className = "item-btn";
        const short = it.label.includes("_") ? it.label.split("_").slice(1).join("_") : it.label;
        b.textContent = short;
        b.title = it.label;
        b.onclick = () => selectItem(b, it.file_id, it.file_name, it.label);
        subList.appendChild(b);
      });
    } catch (err) {
      const message = err?.message || "Lỗi tải";
      subList.innerHTML = `<div style="padding:4px 8px; color:var(--red); font-size:11px;">${message}</div>`;
    }
  }
}

function _resetForms() {
  // Reset toan bo Contact form
  const contactDevice = $("#contact-device");
  if (contactDevice) contactDevice.value = "";
  ["contact-time-start-h","contact-time-start-m",
   "contact-time-end-h","contact-time-end-m"].forEach(id => {
    const el = $(`#${id}`); if (el) el.value = "";
  });
  const contactStatus = $("#contact-status");
  if (contactStatus) contactStatus.value = "Normal";
  const contactProcessing = $("#contact-processing");
  if (contactProcessing) contactProcessing.value = "None";

  // Reset toan bo Status form
  const statusDept   = $("#status-dept");   if (statusDept)   statusDept.value   = "";
  const statusDevice = $("#status-device"); if (statusDevice) statusDevice.value = "";
  const statusDesc   = $("#status-desc");   if (statusDesc)   statusDesc.value   = "";
  ["status-start-h","status-start-m",
   "status-end-h","status-end-m"].forEach(id => {
    const el = $(`#${id}`); if (el) el.value = "";
  });

  // Reset originalReportText
  state.originalReportText = "";
}

async function selectItem(btn, fileId, fileName, label) {
  // Deactivate previous
  if (state.activeItemBtn) state.activeItemBtn.classList.remove("active");
  btn.classList.add("active");
  state.activeItemBtn = btn;

  state.currentFileId  = fileId;
  state.currentFileName = fileName;

  // Reset form khi chon item moi
  _resetForms();

  // First box fill
  handleFirstBoxFill();

  const isNoError = label.toUpperCase().includes("NO_ERROR");
  setOutputText("⏳ Đang tải...");

  try {
    const res = await apiFetch("/api/report/text", {
      method: "POST",
      body: JSON.stringify({ file_id: fileId, file_name: fileName, is_no_error: isNoError }),
    });
    if (res.error) {
      setOutputText(`[Lỗi] ${res.error}`);
    } else {
      setOutputText(res.text);
      state.originalReportText = res.text; // luu bao cao goc
      if (!isNoError) startCountdown();
    }
  } catch {
    setOutputText("[Lỗi kết nối backend]");
  }
}

/* ── Site search ────────────────────────────────────────────── */
function bindSiteSearch() {
  $("#site-search").addEventListener("input", function () {
    const kw = this.value.toLowerCase();
    $$(".site-item").forEach(el => {
      const name = $(".site-btn span", el).textContent.toLowerCase();
      el.style.display = kw === "" || name.includes(kw) ? "" : "none";
    });
  });
}

/* ── Output area ────────────────────────────────────────────── */
function setOutputText(text) {
  $("#output-text").value = text;
}

function bindOutputActions() {
  $("#btn-copy-text").onclick = () => {
    const t = $("#output-text").value;
    if (!t || t.startsWith("⏳") || t.startsWith("[")) return;
    copyToClipboard(t);
  };
  $("#btn-clear-text").onclick = () => {
    setOutputText("");
    clearCountdown();
    // Don't reset process tracker — user decides
  };
}

/* ── Process tracker ────────────────────────────────────────── */
const HINTS = [
  "Đang chờ sự cố...",
  "Đã ghi nhận. Báo cáo lên group chung, tiếp tục theo dõi. Trong 5 phút không có thông báo → liên hệ Site. Nhấn [Contact] để cập nhật thông tin liên hệ.",
  "Tiếp tục theo dõi. Sau 1–2 tiếng chưa có thông tin → liên hệ lại xác minh tình trạng. Nhấn [Status] để cập nhật.",
  "Sự cố sau 1–2 tiếng chưa giải quyết → liên hệ theo số ưu tiên, báo cáo lên group. Nhấn [Xác nhận] để tiếp tục.",
  "Sự cố đã giải quyết → báo cáo lên group cho các bên liên quan. Nhấn [Xác nhận].",
  "Cập nhật lên bảng Alarm List. Nhấn [Xác nhận].",
  "✅ Toàn bộ quy trình hoàn tất. Làm tốt lắm!",
];

function handleFirstBoxFill() {
  if (!state.boxFilled[0]) {
    state.boxFilled[0] = true;
    updateProcessUI();
  }
}

function fillBox(index) {
  if (index === 0 || state.boxFilled[index - 1]) {
    state.boxFilled[index] = true;
    updateProcessUI();
    return true;
  }
  showToast("Chú ý", `Vui lòng hoàn thành bước ${index} trước.`);
  return false;
}

function updateProcessUI() {
  const count = state.boxFilled.filter(Boolean).length;
  $$(".process-step").forEach((el, i) => {
    el.classList.toggle("filled", state.boxFilled[i]);
  });
  const hint = HINTS[count] || HINTS[0];
  $("#hint-text").textContent = hint;

  if (count === 6) {
    setTimeout(() => {
      state.boxFilled = [false, false, false, false, false, false];
      updateProcessUI();
    }, 5000);
  }
}

/* ── Action strip ────────────────────────────────────────────── */
function bindActionStrip() {
  $("#btn-confirm").onclick = () => {
    for (let i = 3; i < 6; i++) {
      if (!state.boxFilled[i]) {
        if (fillBox(i)) break;
        else break;
      }
    }
  };

  $$(".strip-btn[data-modal]").forEach(btn => {
    btn.onclick = () => {
      if (btn.dataset.modal === "contact") openContactModal();
      else openModal(btn.dataset.modal);
    };
  });
}

/* ── Modals ─────────────────────────────────────────────────── */
function _setTimePicker(prefix, value) {
  // Set HH:MM selects tu string "HH:MM"
  if (!value) return;
  const clean = value.trim().replace(/[^0-9:]/g, "").substring(0, 5);
  const parts = clean.split(":");
  if (parts.length < 2) return;
  const hEl = $(`#${prefix}-h`);
  const mEl = $(`#${prefix}-m`);
  if (hEl) hEl.value = parts[0].padStart(2, "0");
  if (mEl) mEl.value = parts[1].padStart(2, "0");
}

function _getTimePicker(prefix) {
  const h = ($(`#${prefix}-h`) || {}).value || "";
  const m = ($(`#${prefix}-m`) || {}).value || "";
  if (!h || !m) return "";
  return `${h}:${m}`;
}

function _getDatePicker(prefix) {
  const el = $(`#${prefix}-date`);
  return el ? el.value : "";
}

function openModal(name) {
  const overlay = $(`#${name}-modal`);
  if (!overlay) return;
  overlay.classList.add("open");

  if (name === "note") loadNotesList();
  if (name === "daviteq") initDaviteqViewer();
  if (name === "document") initDocumentViewer();

  // Auto-fill Status form tu output text
  if (name === "status") {
    // Bat tat ca fields
    $$(".status-field").forEach(el => {
      el.disabled = false;
      el.style.opacity = "1";
    });
    const dept   = _extractFromReport("bộ phận") || _extractFromReport("khu vực");
    const device = _extractFromReport("thiết bị");
    const time   = _extractTimeFromReport();

    if (dept)   { const el = $("#status-dept");   if (el) el.value = dept; }
    if (device) { const el = $("#status-device"); if (el) el.value = device; }
    if (time)   { _setTimePicker("status-start", time); }

    // Auto-fill ngay hom nay cho ca 2 date picker
    const todayVal = new Date().toLocaleDateString("en-CA"); // YYYY-MM-DD
    const sd = $("#status-start-date"); if (sd) sd.value = todayVal;
    const ed = $("#status-end-date");   if (ed) ed.value = todayVal;
  }
}

function closeModal(name) {
  $(`#${name}-modal`).classList.remove("open");
}

function bindModalCloses() {
  $$(".modal-overlay").forEach(overlay => {
    overlay.addEventListener("click", e => {
      if (e.target === overlay) overlay.classList.remove("open");
    });
  });
  $$(".btn-close-modal").forEach(btn => {
    btn.onclick = () => btn.closest(".modal-overlay").classList.remove("open");
  });
}

/* ── Admin user management ─────────────────────────────────── */
function _adminActionsHtml(user) {
  const actions = [];
  if (!user.approved) {
    actions.push(`<button class="topbar-btn admin-approve" data-id="${user.id}">Duyệt</button>`);
  }
  actions.push(`<button class="topbar-btn admin-delete" data-id="${user.id}">Xóa</button>`);
  return actions.join(" ");
}

function renderAdminUsers(users) {
  const tbody = $("#admin-users-tbody");
  if (!tbody) return;

  if (!Array.isArray(users) || users.length === 0) {
    tbody.innerHTML = '<tr><td colspan="6" style="text-align:center;color:var(--text-muted);">Không có user</td></tr>';
    return;
  }

  tbody.innerHTML = users.map(user => {
    const badge = user.approved
      ? '<span class="admin-pill ok">approved</span>'
      : '<span class="admin-pill pending">pending</span>';

    return `
      <tr>
        <td>${user.email || ""}</td>
        <td>${user.name || ""}</td>
        <td>${user.provider || ""}</td>
        <td>${user.role || "user"}</td>
        <td>${badge}</td>
        <td>${_adminActionsHtml(user)}</td>
      </tr>
    `;
  }).join("");

  $$(".admin-approve", tbody).forEach(btn => {
    btn.onclick = async () => {
      const id = btn.dataset.id;
      const res = await apiFetch(`/api/auth/admin/users/${id}/approve`, { method: "POST" });
      if (res.error) {
        showToast("Lỗi", res.error);
      } else {
        showToast("Thành công", "Đã duyệt user.");
        loadAdminUsers();
      }
    };
  });

  $$(".admin-delete", tbody).forEach(btn => {
    btn.onclick = async () => {
      const id = btn.dataset.id;
      const ok = window.confirm("Bạn chắc chắn muốn xóa user này?");
      if (!ok) return;

      const res = await apiFetch(`/api/auth/admin/users/${id}`, { method: "DELETE" });
      if (res.error) {
        showToast("Lỗi", res.error);
      } else {
        showToast("Thành công", "Đã xóa user.");
        loadAdminUsers();
      }
    };
  });
}

async function loadAdminUsers() {
  const tbody = $("#admin-users-tbody");
  if (tbody) {
    tbody.innerHTML = '<tr><td colspan="6" style="text-align:center;color:var(--text-muted);"><span class="spinner"></span></td></tr>';
  }
  const res = await apiFetch("/api/auth/admin/users");
  if (res.error) {
    if (tbody) {
      tbody.innerHTML = `<tr><td colspan="6" style="text-align:center;color:var(--red);">${res.error}</td></tr>`;
    }
    return;
  }
  renderAdminUsers(res);
}

function bindAdminModal() {
  const btn = $("#admin-add-user");
  if (!btn) return;

  btn.onclick = async () => {
    const email = ($("#admin-new-email")?.value || "").trim();
    const name = ($("#admin-new-name")?.value || "").trim();

    if (!email) {
      showToast("Thiếu thông tin", "Vui lòng nhập email user.");
      return;
    }

    const res = await apiFetch("/api/auth/admin/users", {
      method: "POST",
      body: JSON.stringify({ email, name, approved: true }),
    });

    if (res.error) {
      showToast("Lỗi", res.error);
      return;
    }

    $("#admin-new-email").value = "";
    $("#admin-new-name").value = "";
    showToast("Thành công", `Đã thêm user ${res.email}.`);
    loadAdminUsers();
  };
}

/* ── Contact modal ────────────────────────────────────────────── */
function _extractFromReport(keyword) {
  // Trich xuat gia tri tu bao cao goc (khong bi ghi de boi Contact/Status)
  const text = state.originalReportText || $("#output-text").value || "";
  const lines = text.split("\n");
  for (const line of lines) {
    const lower = line.toLowerCase();
    if (lower.includes(keyword.toLowerCase())) {
      const idx = line.indexOf(":");
      if (idx !== -1) return line.slice(idx + 1).trim();
    }
  }
  return "";
}

function _extractTimeFromReport() {
  // Tim dong "Thoi gian" va lay gia tri HH:MM tu bao cao goc
  const text = state.originalReportText || $("#output-text").value || "";
  const lines = text.split("\n");
  for (const line of lines) {
    if (line.toLowerCase().includes("thời gian") || line.toLowerCase().includes("time")) {
      const match = line.match(/\b(\d{1,2}:\d{2})\b/);
      if (match) return match[1];
    }
  }
  return "";
}

function _formatContactRecoveryTime(start, end) {
  if (!start && !end) return "...";
  if (!start || !end) return start || end;

  const [sh, sm] = start.split(":").map(Number);
  const [eh, em] = end.split(":").map(Number);
  if ([sh, sm, eh, em].some(n => Number.isNaN(n))) return `${start} - ${end}`;

  let totalMinutes = (eh * 60 + em) - (sh * 60 + sm);
  if (totalMinutes < 0) totalMinutes += 24 * 60;
  return `(${totalMinutes} phút) ${start} - ${end}`;
}

function _buildContactText() {
  const device = $("#contact-device").value.trim();
  const status = $("#contact-status").value;
  const processing = $("#contact-processing").value;
  const timeStart = _getTimePicker("contact-time-start");
  const timeEnd = _getTimePicker("contact-time-end");

  if (!device) {
    showToast("Thiếu thông tin", "Vui lòng nhập tên thiết bị.");
    return null;
  }

  const timeStr = _formatContactRecoveryTime(timeStart, timeEnd);
  return (
    `Dear anh/ chị tại site, em xin phép cập nhập tình trạng thiết bị:\n` +
    `+ Tên thiết bị liên quan: ${device}\n` +
    `+ Tình trạng thiết bị: ${status}\n` +
    `+ Processing Results: ${processing}\n` +
    `+ Thời gian khắc phục: ${timeStr}`
  );
}

function openContactModal() {
  // Mo modal truoc
  openModal("contact");

  // Sau do dien thong tin (dam bao DOM da san sang)
  const device    = _extractFromReport("thiết bị");
  const timeStart = _extractTimeFromReport();

  const deviceInput = $("#contact-device");
  if (deviceInput && device) deviceInput.value = device;
  if (timeStart) _setTimePicker("contact-time-start", timeStart);

  // Bind submit moi lan mo de tranh mat onclick
  const btn = $("#contact-submit");
  if (btn) {
    btn.onclick = null;
    btn.onclick = () => {
      const text = _buildContactText();
      if (!text) return;

      setOutputText(text);
      fillBox(1);
      startCountdown();
      closeModal("contact");
    };
  }
}

function bindContactModal() {
  $("#contact-submit").onclick = () => {
    const text = _buildContactText();
    if (!text) return;

    setOutputText(text);
    fillBox(1);
    startCountdown();

    // Reset time pickers
    ["contact-time-start-h","contact-time-start-m",
     "contact-time-end-h","contact-time-end-m"].forEach(id => {
      const el = $(`#${id}`);
      if (el) el.value = "";
    });
    closeModal("contact");
  };
}

/* ── Status modal ─────────────────────────────────────────────── */
function bindStatusModal() {
  // Khong con confirmed/not_confirmed - tat ca fields luon enabled
  $$(".status-field").forEach(el => {
    el.disabled = false;
    el.style.opacity = "1";
  });

  $("#status-submit").onclick = async () => {
    const body = {
      confirmed:   false,
      dept:        $("#status-dept").value.trim(),
      device:      $("#status-device").value.trim(),
      pic:         $("#status-pic").value,
      alarm_type:  $("#status-alarm-type").value,
      alarm_level: $("#status-alarm-level").value,
      status:      $("#status-done").value,
      processing:  $("#status-processing").value,
      week:        $("#status-week").value,
      start_time:  _getTimePicker("status-start"),
      start_date:  _getDatePicker("status-start"),
      end_time:    _getTimePicker("status-end"),
      end_date:    _getDatePicker("status-end"),
      desc:        $("#status-desc").value.trim(),
    };

    // Validate bat buoc
    const missing = [];
    if (!body.dept)        missing.push("Tên bộ phận / Site");
    if (!body.device)      missing.push("Tên thiết bị");
    if (!body.pic)         missing.push("Người phụ trách");
    if (!body.alarm_type)  missing.push("Alarm Type");
    if (!body.alarm_level) missing.push("Alarm Level");
    if (!body.start_time)  missing.push("Thời gian bắt đầu");
    if (!body.start_date)  missing.push("Ngày bắt đầu");
    if (!body.end_time)    missing.push("Thời gian kết thúc");
    if (!body.end_date)    missing.push("Ngày kết thúc");
    if (!body.desc)        missing.push("Mô tả (Reason)");

    if (missing.length > 0) {
      showToast("Thiếu thông tin", "Vui lòng điền đủ:\n• " + missing.join("\n• "));
      return;
    }

    try {
      const notice = $("#status-excel-notice");
      if (notice) notice.style.display = "block";
      const res = await apiFetch("/api/status", { method: "POST", body: JSON.stringify(body) });
      if (res.error) {
        if (notice) notice.style.display = "none";
        showToast("Lỗi", res.error);
        return;
      }
      if (res.text) setOutputText(res.text);
      if (res.excel === "writing") {
        showToast("Excel", "Đang ghi dữ liệu vào Excel trên OneDrive...");
      }
      fillBox(2);
      // Reset form
      ["status-dept","status-device","status-desc"].forEach(id => {
        const el = $(`#${id}`); if (el) el.value = "";
      });
      ["status-start-h","status-start-m","status-end-h","status-end-m"].forEach(id => {
        const el = $(`#${id}`); if (el) el.value = "";
      });
      if (notice) notice.style.display = "none";
      closeModal("status");
    } catch { showToast("Lỗi", "Không thể kết nối API"); }
  };
}

/* ── Notification modal ─────────────────────────────────────── */
function bindNotificationForm() {
  $("#notif-submit").onclick = async () => {
    const today = new Date().toISOString().split("T")[0];
    const body = {
      site:        $("#notif-site").value.trim(),
      description: $("#notif-description").value.trim(),
      start_time:  $("#notif-start-time").value.trim(),
      start_date:  $("#notif-start-date").value || today,
      end_time:    $("#notif-end-time").value.trim(),
      end_date:    $("#notif-end-date").value || today,
      devices:     $("#notif-devices").value.trim(),
      note:        $("#notif-note").value.trim(),
    };
    try {
      const res = await apiFetch("/api/notification", { method: "POST", body: JSON.stringify(body) });
      if (res.error) { showToast("Lỗi", res.error); return; }
      setOutputText(res.text);
      closeModal("notification");
    } catch { showToast("Lỗi", "Không thể kết nối API"); }
  };
}

/* ── Note modal ──────────────────────────────────────────────── */
function bindNoteTabs() {
  $$(".note-tab").forEach(tab => {
    tab.onclick = () => {
      $$(".note-tab").forEach(t => t.classList.remove("active"));
      tab.classList.add("active");
      $$(".note-panel").forEach(p => p.classList.add("hidden"));
      $(`#note-panel-${tab.dataset.tab}`).classList.remove("hidden");
      if (tab.dataset.tab === "view") loadNotesList();
    };
  });
}

function parseTimesInput(val) {
  return val.split(",").map(t => t.trim()).filter(Boolean);
}
function parseDaysInput(val) {
  if (val.trim().toLowerCase() === "all") return Array.from({length:31}, (_,i)=>String(i+1));
  return val.split(",").map(t => t.trim()).filter(Boolean);
}
function parseMonthsInput(val) {
  if (val.trim().toLowerCase() === "all") return Array.from({length:12}, (_,i)=>String(i+1));
  return val.split(",").map(t => t.trim()).filter(Boolean);
}

function _expandTimes(baseTimesStr, repeatCount, intervalMin) {
  // Tu cac gio goc, sinh them cac gio nhac tiep theo
  const baseTimes = parseTimesInput(baseTimesStr);
  const all = [];
  baseTimes.forEach(t => {
    const [h, m] = t.split(":").map(Number);
    for (let i = 0; i < repeatCount; i++) {
      const total = h * 60 + m + i * intervalMin;
      const nh = Math.floor(total / 60) % 24;
      const nm = total % 60;
      all.push(`${String(nh).padStart(2,"0")}:${String(nm).padStart(2,"0")}`);
    }
  });
  // Loai trung lap
  return [...new Set(all)];
}

function bindNoteCreate() {
  $("#note-create-submit").onclick = async () => {
    const repeatCount    = parseInt($("#note-repeat-count").value) || 1;
    const intervalMin    = parseInt($("#note-repeat-interval").value) || 5;
    const times  = _expandTimes($("#note-times").value, repeatCount, intervalMin);
    const days   = parseDaysInput($("#note-days").value);
    const months = parseMonthsInput($("#note-months").value);
    const daysRaw   = $("#note-days").value.trim().toLowerCase();
    const monthsRaw = $("#note-months").value.trim().toLowerCase();
    const daysIsAll   = daysRaw === "all";
    const monthsIsAll = monthsRaw === "all";

    // Neu co bat ky truong nao la All -> khong xoa (con nhac lai)
    // Chi xoa khi ca ngay va thang deu cu the (1 lan duy nhat)
    const isRecurring = daysIsAll || monthsIsAll;

    const body = {
      keyword:     $("#note-keyword").value.trim(),
      content:     $("#note-content").value.trim(),
      times, days, months,
      mode:        isRecurring ? "Cố định" : "1 lần",
      delete_mode: isRecurring ? "keep"    : "delete",
    };
    if (!body.keyword || !body.content) { showToast("Thiếu thông tin", "Nhập keyword và nội dung."); return; }
    if (!body.times.length)             { showToast("Thiếu thông tin", "Nhập giờ báo."); return; }
    if (!body.days.length)              { showToast("Thiếu thông tin", "Nhập ngày báo."); return; }
    if (!body.months.length)            { showToast("Thiếu thông tin", "Nhập tháng báo."); return; }
    try {
      const res = await apiFetch("/api/notes", { method: "POST", body: JSON.stringify(body) });
      if (res.error) { showToast("Lỗi", res.error); return; }
      showToast("Thành công", `Đã tạo note #${res.stt} (${times.length} lần nhắc: ${times.join(", ")})`);
      ["note-keyword","note-content","note-times","note-days","note-months"].forEach(id => $(`#${id}`).value = "");
      loadNotesList();
    } catch { showToast("Lỗi", "Không thể kết nối API"); }
  };
}

async function loadNotesList() {
  try {
    const notes = await apiFetch("/api/notes");
    state.notesList = notes;
    renderNotesTable(notes);
  } catch { showToast("Lỗi", "Không tải được danh sách notes"); }
}

function renderNotesTable(notes) {
  const tbody = $("#notes-tbody");
  tbody.innerHTML = "";
  const now = new Date();

  notes.forEach(n => {
    const tr = document.createElement("tr");

    // Row tag
    let rowClass = "";
    if (n.mode === "1 lần") {
      const hasValid = n.months.some(m => n.days.some(d => n.times.some(t => {
        try {
          const [h, mn] = t.split(":").map(Number);
          const dt = new Date(now.getFullYear(), Number(m)-1, Number(d), h, mn);
          return dt >= now;
        } catch { return false; }
      })));
      rowClass = (hasValid && !n.done) ? "tag-valid" : "tag-expired";
    } else {
      rowClass = "tag-recurring";
    }
    if (n.done) rowClass = "tag-done";
    tr.className = rowClass;

    tr.innerHTML = `
      <td>${n.stt}</td>
      <td>${n.keyword}</td>
      <td style="max-width:240px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;" title="${n.content}">${n.content}</td>
      <td style="font-size:11px;">${n.times.join(", ")}</td>
      <td>${n.days.join(", ")}</td>
      <td>${n.months.join(", ")}</td>
      <td><button class="delete-row-btn" data-stt="${n.stt}">✕</button></td>
    `;
    tbody.appendChild(tr);
  });

  // Delete buttons
  $$(".delete-row-btn", tbody).forEach(btn => {
    btn.onclick = async () => {
      if (!confirm(`Xóa note #${btn.dataset.stt}?`)) return;
      try {
        await apiFetch(`/api/notes/${btn.dataset.stt}`, { method: "DELETE" });
        loadNotesList();
      } catch { showToast("Lỗi", "Không xóa được"); }
    };
  });
}

function bindNoteSearch() {
  $("#note-search").addEventListener("input", function () {
    const kw = this.value.toLowerCase();
    const filtered = state.notesList.filter(n =>
      n.keyword.toLowerCase().includes(kw) || n.content.toLowerCase().includes(kw)
    );
    renderNotesTable(filtered);
  });
}

/* ── Notification form inside Note modal ────────────────────── */
function bindNotifFormInNote() {
  const todayVal = new Date().toISOString().split("T")[0];
  const sd = $("#notif-start-date");
  const ed = $("#notif-end-date");
  if (sd) sd.value = todayVal;
  if (ed) ed.value = todayVal;
}

/* ── DAVITEQ image viewer ────────────────────────────────────── */
let daviteqInited = false;
let daviteqCats   = {};

async function initDaviteqViewer() {
  if (daviteqInited) return;
  daviteqInited = true;

  const catList = $("#img-cat-list");
  catList.innerHTML = `<span class="spinner"></span>`;

  try {
    daviteqCats = await apiFetch("/api/images/categories");
    catList.innerHTML = "";

    Object.keys(daviteqCats).forEach((cat, i) => {
      const btn = document.createElement("button");
      btn.className = "img-cat-btn";
      btn.textContent = cat;
      btn.onclick = () => {
        $$(".img-cat-btn").forEach(b => b.classList.remove("active"));
        btn.classList.add("active");
        renderImgSubList(cat);
      };
      catList.appendChild(btn);
      if (i === 0) { btn.classList.add("active"); renderImgSubList(cat); }
    });
  } catch {
    catList.innerHTML = `<span style="color:var(--red);font-size:11px;">Lỗi tải</span>`;
  }
}

function renderImgSubList(cat) {
  const subList = $("#img-sub-list");
  subList.innerHTML = "";
  const sites = daviteqCats[cat] || [];

  sites.forEach((site, i) => {
    const btn = document.createElement("button");
    btn.className = "img-sub-btn";
    btn.textContent = site;
    btn.onclick = () => {
      $$(".img-sub-btn").forEach(b => b.classList.remove("active"));
      btn.classList.add("active");
      loadImgGrid(cat, site);
    };
    subList.appendChild(btn);
    if (i === 0) { btn.classList.add("active"); loadImgGrid(cat, site); }
  });
}

async function loadImgGrid(cat, site) {
  const grid = $("#img-grid");
  grid.innerHTML = `<span class="spinner"></span>`;

  try {
    const images = await apiFetch(`/api/images/${cat}/${site}`);
    grid.innerHTML = "";
    if (!images.length) {
      grid.innerHTML = `<span style="color:var(--text-muted);font-size:12px;">Không có ảnh</span>`;
      return;
    }
    images.forEach(img => {
      const el = document.createElement("div");
      el.className = "img-thumb";
      el.innerHTML = `<img src="${API}${img.url}" alt="${img.name}" loading="lazy"><span>${img.name}</span>`;
      el.onclick = () => window.open(`${API}${img.url}`, "_blank");
      grid.appendChild(el);
    });
  } catch {
    grid.innerHTML = `<span style="color:var(--red);font-size:12px;">Lỗi tải ảnh</span>`;
  }
}

/* ── Documentary viewer ──────────────────────────────────────── */
let docFiles = [];

async function initDocumentViewer() {
  await loadDocList();
  bindDocSearch();
}

async function loadDocList(q = "", mode = "name") {
  const tbody = $("#docs-tbody");
  tbody.innerHTML = `<tr><td colspan="5"><span class="spinner"></span></td></tr>`;
  try {
    const params = new URLSearchParams({ q, mode });
    docFiles = await apiFetch(`/api/docs?${params}`);
    renderDocTable(docFiles);
  } catch {
    tbody.innerHTML = `<tr><td colspan="5" style="color:var(--red)">Lỗi tải tài liệu</td></tr>`;
  }
}

function renderDocTable(files) {
  const tbody = $("#docs-tbody");
  tbody.innerHTML = "";
  files.forEach(f => {
    const tr = document.createElement("tr");
    const pill = f.is_downloaded
      ? `<span class="tag-pill pill-green">✓ Đã tải</span>`
      : `<span class="tag-pill pill-red">Chưa tải</span>`;
    tr.innerHTML = `
      <td>${f.stt}</td>
      <td>${f.tags}</td>
      <td>${f.name}</td>
      <td><button class="action-btn doc-dl-btn" data-id="${f.id}" data-name="${f.name}">⇩</button></td>
      <td>${pill}</td>
    `;
    tbody.appendChild(tr);
  });

  $$(".doc-dl-btn", tbody).forEach(btn => {
    btn.onclick = async () => {
      btn.disabled = true;
      btn.innerHTML = `<span class="spinner"></span>`;
      try {
        const res = await apiFetch(`/api/docs/download/${btn.dataset.id}`, { method: "POST" });
        if (res.error) { showToast("Lỗi", res.error); }
        else {
          showToast("Đã tải", `${btn.dataset.name}`);
          await loadDocList($("#doc-search").value, $(".doc-mode-btn.active")?.dataset.mode || "name");
        }
      } catch { showToast("Lỗi", "Tải thất bại"); }
      btn.disabled = false;
      btn.innerHTML = "⇩";
    };
  });
}

function bindDocSearch() {
  const searchInput  = $("#doc-search");
  const modeBtns     = $$(".doc-mode-btn");

  searchInput.addEventListener("input", function () {
    const mode = $(".doc-mode-btn.active")?.dataset.mode || "name";
    loadDocList(this.value.trim(), mode);
  });

  modeBtns.forEach(btn => {
    btn.onclick = () => {
      modeBtns.forEach(b => b.classList.remove("active"));
      btn.classList.add("active");
      loadDocList(searchInput.value.trim(), btn.dataset.mode);
    };
  });

  $("#doc-refresh").onclick = async () => {
    await apiFetch("/api/docs/refresh", { method: "POST" });
    loadDocList();
  };
}

/* ── Background sync ─────────────────────────────────────────── */
async function triggerBackgroundSync() {
  try {
    await apiFetch("/api/sync", { method: "POST" });
    showToast("Đồng bộ", "Đang đồng bộ dữ liệu từ OneDrive...");
  } catch {}
}

/* ── Notification poller ─────────────────────────────────────── */
function startNotificationPoller() {
  setInterval(async () => {
    try {
      const notifs = await apiFetch("/api/notes/pending");
      notifs.forEach(n => {
        showReminder(n.keyword, n.content, n.time || "");
        // Browser notification van gui de bao khi tab o nen
        if (Notification.permission === "granted") {
          new Notification(n.keyword, { body: n.content });
        }
      });
    } catch {}
  }, 30000);

  // Request notification permission
  if (Notification.permission === "default") {
    Notification.requestPermission();
  }
}

/* ── Group tabs ─────────────────────────────────────────────── */
function bindGroupTabs() {
  $$(".group-tab").forEach(tab => {
    tab.onclick = () => {
      renderSiteList(tab.dataset.group);
      // Reset active item
      if (state.activeItemBtn) state.activeItemBtn.classList.remove("active");
      state.activeItemBtn  = null;
      state.currentSiteKey = null;
    };
  });
}

/* ── Slack send ─────────────────────────────────────────────── */
function bindSlackButton() {
  const btn = $("#btn-slack");
  if (!btn) return;
  btn.onclick = async () => {
    const text = $("#output-text").value.trim();
    if (!text || text.startsWith("⏳") || text.startsWith("[")) {
      showToast("Chưa có nội dung", "Chọn báo cáo hoặc điền thông tin trước.");
      return;
    }
    // Lay site key tu active site button
    const activeSiteBtn = $(".site-btn.open");
    const siteKey = activeSiteBtn
      ? activeSiteBtn.querySelector("span")?.textContent?.trim() || ""
      : "";

    btn.disabled = true;
    btn.textContent = "⏳";
    try {
      const res = await apiFetch("/api/send-slack", {
        method: "POST",
        body: JSON.stringify({ text, site: siteKey }),
      });
      if (res.error) showToast("Lỗi Slack", res.error);
      else showToast("Đã gửi Slack ✓", `Đã gửi vào channel của ${siteKey || "mặc định"}`);
    } catch {
      showToast("Lỗi", "Không thể kết nối API");
    }
    btn.disabled = false;
    btn.textContent = "📨 Slack";
  };
}

/* ── Reminder overlay ───────────────────────────────────────── */
const _reminderQueue = [];
let _reminderShowing = false;

function showReminder(keyword, content, time) {
  _reminderQueue.push({ keyword, content, time });
  if (!_reminderShowing) _showNextReminder();
}

function _showNextReminder() {
  if (_reminderQueue.length === 0) {
    _reminderShowing = false;
    return;
  }
  _reminderShowing = true;
  const { keyword, content, time } = _reminderQueue.shift();
  $("#reminder-keyword").textContent = keyword;
  $("#reminder-content").textContent = content;
  $("#reminder-time").textContent    = `⏰ ${time}`;
  $("#reminder-overlay").classList.add("open");
}

function closeReminder() {
  $("#reminder-overlay").classList.remove("open");
  // Hien cai tiep theo neu con trong queue
  setTimeout(_showNextReminder, 300);
}

/* ── Charts ────────────────────────────────────────────────── */
function showChartsModal() {
  window.open("/charts.html", "_blank");
}

/* ── Boot ────────────────────────────────────────────────────── */
document.addEventListener("DOMContentLoaded", () => {
  handleAuthQueryHint();
  initTheme();
  bindThemeToggle();
  initSidebarResize();
  bindSlackButton();
  bindItemSearch();
  bindAuthButtons();
  bindGroupTabs();
  bindSiteSearch();
  bindOutputActions();
  bindModalCloses();
  bindAdminModal();
  bindContactModal();
  bindStatusModal();
  bindNoteCreate();
  bindNoteTabs();
  bindNoteSearch();
  bindNotifFormInNote();
  bindNotificationForm();
  checkAuth();
});

/* ── Theme toggle ────────────────────────────────────────────── */
function initTheme() {
  const saved = localStorage.getItem("rmc-theme") || "dark";
  applyTheme(saved);
}

function applyTheme(theme) {
  const btn = $("#btn-theme");
  if (theme === "light") {
    document.documentElement.setAttribute("data-theme", "light");
    if (btn) btn.textContent = "☀️";
  } else {
    document.documentElement.removeAttribute("data-theme");
    if (btn) btn.textContent = "🌙";
  }
  localStorage.setItem("rmc-theme", theme);
}

function bindThemeToggle() {
  const btn = $("#btn-theme");
  if (!btn) return;
  btn.onclick = () => {
    const current = document.documentElement.getAttribute("data-theme");
    applyTheme(current === "light" ? "dark" : "light");
  };
}

/* ── Sidebar resize ──────────────────────────────────────────── */
function initSidebarResize() {
  const sidebar  = $("#sidebar");
  const resizer  = $("#sidebar-resizer");
  const app      = $("#app");
  if (!resizer) return;

  let startX = 0;
  let startW = 0;

  resizer.addEventListener("mousedown", e => {
    startX = e.clientX;
    startW = sidebar.getBoundingClientRect().width;
    resizer.classList.add("dragging");
    document.body.style.cursor = "col-resize";
    document.body.style.userSelect = "none";

    function onMove(e) {
      const newW = Math.min(480, Math.max(150, startW + (e.clientX - startX)));
      sidebar.style.width = newW + "px";
      app.style.gridTemplateColumns = `${newW}px 1fr`;
    }
    function onUp() {
      resizer.classList.remove("dragging");
      document.body.style.cursor = "";
      document.body.style.userSelect = "";
      document.removeEventListener("mousemove", onMove);
      document.removeEventListener("mouseup", onUp);
      // Lưu width vào localStorage
      localStorage.setItem("sidebar-width", sidebar.style.width);
    }
    document.addEventListener("mousemove", onMove);
    document.addEventListener("mouseup", onUp);
  });

  // Khôi phục width đã lưu
  const saved = localStorage.getItem("sidebar-width");
  if (saved) {
    sidebar.style.width = saved;
    app.style.gridTemplateColumns = `${saved} 1fr`;
  }
}

/* ── Item search (tìm thiết bị) ──────────────────────────────── */
function bindItemSearch() {
  const input = $("#item-search");
  if (!input) return;

  input.addEventListener("input", function () {
    const kw = this.value.toLowerCase().trim();
    $$(".item-btn").forEach(btn => {
      const match = kw === "" || btn.textContent.toLowerCase().includes(kw);
      btn.style.display = match ? "" : "none";
    });
  });
}