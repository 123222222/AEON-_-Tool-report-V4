/* ============================================================
   RMC Report Assistant — app.js
   ============================================================ */

const API = window.location.origin;

/* ── State ─────────────────────────────────────────────────── */
const state = {
  authenticated: false,
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
};

/* ── Helpers ────────────────────────────────────────────────── */
function $(sel, ctx = document) { return ctx.querySelector(sel); }
function $$(sel, ctx = document) { return [...ctx.querySelectorAll(sel)]; }

async function apiFetch(path, opts = {}) {
  const res = await fetch(API + path, {
    headers: { "Content-Type": "application/json" },
    ...opts,
  });
  return res.json();
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
async function checkAuth() {
  try {
    const res = await apiFetch("/api/auth/status");
    if (res.authenticated) {
      onAuthSuccess();
    } else {
      showLoginScreen();
    }
  } catch {
    showLoginScreen();
  }
}

function showLoginScreen() {
  $("#login-screen").classList.remove("hidden");
  startDeviceFlow();
}

async function startDeviceFlow() {
  try {
    const data = await apiFetch("/api/auth/device-flow", { method: "POST" });
    if (data.status === "error") {
      $("#login-status").textContent = "Lỗi: " + data.message;
      return;
    }
    $("#login-url").textContent  = data.verification_uri;
    $("#login-code").textContent = data.user_code;
    $("#login-status").className = "login-status checking";
    $("#login-status").textContent = "Đang chờ xác nhận ";

    // Poll every 2s
    const poll = setInterval(async () => {
      const r = await apiFetch("/api/auth/device-flow/poll");
      if (r.status === "success") {
        clearInterval(poll);
        onAuthSuccess();
      } else if (r.status === "error") {
        clearInterval(poll);
        $("#login-status").textContent = "Lỗi đăng nhập: " + r.message;
      }
    }, 2000);
  } catch (e) {
    $("#login-status").textContent = "Không thể kết nối backend.";
  }
}

function onAuthSuccess() {
  state.authenticated = true;
  $("#login-screen").classList.add("hidden");
  $("#auth-badge").classList.add("ok");
  $("#auth-badge .label").textContent = "Đã đăng nhập";
  initApp();
}

/* ── Copy login helpers ─────────────────────────────────────── */
function bindLoginCopy() {
  $("#copy-url-btn").onclick  = () => copyToClipboard($("#login-url").textContent);
  $("#copy-code-btn").onclick = () => copyToClipboard($("#login-code").textContent);
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

    const btn = document.createElement("button");
    btn.className = "site-btn";
    btn.innerHTML = `<span>${siteKey}</span><span class="chevron">›</span>`;
    btn.onclick = () => toggleSiteItems(siteKey, item, btn);

    const subList = document.createElement("div");
    subList.className = "item-list";
    subList.id = `items-${siteKey}`;

    item.appendChild(btn);
    item.appendChild(subList);
    list.appendChild(item);
  });
}

async function toggleSiteItems(siteKey, container, btn) {
  const subList = $(`#items-${siteKey}`);
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
      const items = await apiFetch(`/api/sites/${siteKey}/items`);
      subList.innerHTML = "";
      items.forEach(it => {
        const b = document.createElement("button");
        b.className = "item-btn";
        const short = it.label.includes("_") ? it.label.split("_").slice(1).join("_") : it.label;
        b.textContent = short;
        b.title = it.label;
        b.onclick = () => selectItem(b, it.file_id, it.file_name, it.label);
        subList.appendChild(b);
      });
    } catch {
      subList.innerHTML = `<div style="padding:4px 8px; color:var(--red); font-size:11px;">Lỗi tải</div>`;
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
      const device    = $("#contact-device").value.trim();
      const status    = $("#contact-status").value;
      const timeStart = _getTimePicker("contact-time-start");
      const timeEnd   = _getTimePicker("contact-time-end");

      if (!device) { showToast("Thiếu thông tin", "Vui lòng nhập tên thiết bị."); return; }

      const timeStr = timeStart && timeEnd
        ? `${timeStart} - ${timeEnd}`
        : timeStart || timeEnd || "...";

      const text =
        `Dear anh/ chị tại site, em xin phép cập nhập tình trạng thiết bị:\n` +
        `+ Tên thiết bị liên quan: ${device}\n` +
        `+ Tình trạng thiết bị: ${status}\n` +
        `+ Thời gian khắc phục: ${timeStr}`;

      setOutputText(text);
      fillBox(1);
      startCountdown();
      closeModal("contact");
    };
  }
}

function bindContactModal() {
  $("#contact-submit").onclick = () => {
    const device    = $("#contact-device").value.trim();
    const status    = $("#contact-status").value;
    const timeStart = _getTimePicker("contact-time-start");
    const timeEnd   = _getTimePicker("contact-time-end");

    if (!device) { showToast("Thiếu thông tin", "Vui lòng nhập tên thiết bị."); return; }

    const timeStr = timeStart && timeEnd
      ? `${timeStart} - ${timeEnd}`
      : timeStart || timeEnd || "...";

    const text =
      `Dear anh/ chị tại site, em xin phép cập nhập tình trạng thiết bị:\n` +
      `+ Tên thiết bị liên quan: ${device}\n` +
      `+ Tình trạng thiết bị: ${status}\n` +
      `+ Thời gian khắc phục: ${timeStr}`;

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

function bindNoteCreate() {
  const modeSelect = $("#note-mode");
  const deleteFrame = $("#note-delete-frame");

  modeSelect.onchange = () => {
    const isOnce = modeSelect.value === "1 lần";
    deleteFrame.style.opacity = isOnce ? "1" : "0.4";
    $$("input[name='note-delete']", deleteFrame).forEach(r => r.disabled = !isOnce);
  };

  $("#note-create-submit").onclick = async () => {
    const times  = parseTimesInput($("#note-times").value);
    const days   = parseDaysInput($("#note-days").value);
    const months = parseMonthsInput($("#note-months").value);
    const body = {
      keyword:     $("#note-keyword").value.trim(),
      content:     $("#note-content").value.trim(),
      times, days, months,
      mode:        $("#note-mode").value,
      delete_mode: $("input[name='note-delete']:checked").value,
    };
    if (!body.keyword || !body.content) { showToast("Thiếu thông tin", "Nhập keyword và nội dung."); return; }
    try {
      const res = await apiFetch("/api/notes", { method: "POST", body: JSON.stringify(body) });
      if (res.error) { showToast("Lỗi", res.error); return; }
      showToast("Thành công", `Đã tạo note #${res.stt}`);
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
      <td style="max-width:280px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;" title="${n.content}">${n.content}</td>
      <td>${n.times.join(", ")}</td>
      <td>${n.days.join(", ")}</td>
      <td>${n.months.join(", ")}</td>
      <td>${n.mode}</td>
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
        showToast(`🔔 ${n.keyword}`, n.content, 10000);
        // Browser notification
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

/* ── Boot ────────────────────────────────────────────────────── */
document.addEventListener("DOMContentLoaded", () => {
  initTheme();
  bindThemeToggle();
  initSidebarResize();
  bindItemSearch();
  bindLoginCopy();
  bindGroupTabs();
  bindSiteSearch();
  bindOutputActions();
  bindModalCloses();
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