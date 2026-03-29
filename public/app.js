const state = {
  dashboard: null,
  settings: null,
  history: []
};

async function request(url, options = {}) {
  const response = await fetch(url, {
    headers: { "Content-Type": "application/json" },
    ...options
  });
  const data = await response.json();
  if (!response.ok) throw new Error(data.message || "请求失败");
  return data;
}

function showToast(message) {
  const toast = document.getElementById("toast");
  toast.textContent = message;
  toast.classList.remove("hidden");
  window.clearTimeout(showToast.timer);
  showToast.timer = window.setTimeout(() => toast.classList.add("hidden"), 2400);
}

function setDeepValue(target, path, value) {
  const keys = path.split(".");
  let cursor = target;
  keys.forEach((key, index) => {
    if (index === keys.length - 1) {
      cursor[key] = value;
      return;
    }
    cursor[key] = cursor[key] || {};
    cursor = cursor[key];
  });
}

function fillSettingsForm(settings) {
  const form = document.getElementById("settingsForm");
  Array.from(form.elements).forEach((field) => {
    if (!field.name) return;
    const value = field.name.split(".").reduce((acc, key) => acc?.[key], settings);
    if (value === undefined) return;
    field.value = String(value);
  });
  document.getElementById("botTokenStatus").value = settings.telegram.botTokenConfigured ? "已配置" : "未配置";
}

function renderDashboard() {
  if (!state.dashboard) return;
  const { promptPack, settings } = state.dashboard;

  document.getElementById("todayDate").textContent = promptPack.date;
  document.getElementById("topicSummary").textContent = promptPack.topic;
  document.getElementById("heroTitle").textContent = `${promptPack.dayName} 的联系节奏已经帮你排好了`;
  document.getElementById("heroSummary").textContent = `${promptPack.summary} 今天建议以“${promptPack.topic}”为主轴，保持自然、轻量、有回应感。`;
  document.getElementById("dayTag").textContent = promptPack.dayName;
  document.getElementById("lastSummary").textContent = promptPack.summary;
  document.getElementById("telegramMode").textContent = settings.telegram.enabled
    ? `当前为 ${settings.telegram.mode} 模式`
    : "当前未启用真实 Telegram 发送";

  const checklist = document.getElementById("checklist");
  checklist.innerHTML = "";
  promptPack.checklist.forEach((item) => {
    const li = document.createElement("li");
    li.textContent = item;
    checklist.appendChild(li);
  });

  const fragmentList = document.getElementById("fragmentList");
  fragmentList.innerHTML = "";
  promptPack.fragments.forEach((item) => {
    const div = document.createElement("div");
    div.className = "fragment-item";
    div.textContent = item;
    fragmentList.appendChild(div);
  });

  const suggestionList = document.getElementById("suggestionList");
  suggestionList.innerHTML = "";
  promptPack.suggestions.forEach((item) => {
    const row = document.createElement("div");
    row.className = "suggestion-item";
    const text = document.createElement("p");
    text.textContent = item;
    const button = document.createElement("button");
    button.className = "copy-button";
    button.textContent = "复制";
    button.addEventListener("click", async () => {
      await navigator.clipboard.writeText(item);
      showToast("已复制到剪贴板");
    });
    row.append(text, button);
    suggestionList.appendChild(row);
  });
}

function renderHistory() {
  const historyList = document.getElementById("historyList");
  historyList.innerHTML = "";
  state.history.forEach((item) => {
    const card = document.createElement("div");
    card.className = "history-item";
    const summary = document.createElement("p");
    summary.textContent = item.summary;
    const next = document.createElement("p");
    next.className = "muted";
    next.textContent = item.nextIdea ? `下次可聊：${item.nextIdea}` : "下次话题还没记录";
    const meta = document.createElement("div");
    meta.className = "history-meta";
    meta.textContent = `${item.date} · ${item.channel} · ${item.mood}`;
    card.append(summary, next, meta);
    historyList.appendChild(card);
  });
}

async function loadDashboard() {
  const data = await request("/api/dashboard");
  state.dashboard = data;
  state.settings = data.settings;
  state.history = data.history;
  renderDashboard();
  renderHistory();
  fillSettingsForm(data.settings);
}

function bindEvents() {
  document.getElementById("refreshBtn").addEventListener("click", async () => {
    await loadDashboard();
    showToast("今日建议已刷新");
  });

  document.getElementById("runCronBtn").addEventListener("click", async () => {
    const result = await request("/api/cron/daily", { method: "POST" });
    showToast(result.telegram?.message || "已执行每日发送");
  });

  document.getElementById("sendTelegramBtn").addEventListener("click", async () => {
    const result = await request("/api/telegram/test", { method: "POST" });
    showToast(result.message || "测试发送完成");
  });

  document.getElementById("historyForm").addEventListener("submit", async (event) => {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const payload = Object.fromEntries(form.entries());
    await request("/api/history", { method: "POST", body: JSON.stringify(payload) });
    event.currentTarget.reset();
    await loadDashboard();
    showToast("联系记录已保存");
  });

  document.getElementById("settingsForm").addEventListener("submit", async (event) => {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const payload = {};
    for (const [key, value] of form.entries()) {
      if (key === "botTokenStatus") continue;
      let normalized = value;
      if (value === "true") normalized = true;
      if (value === "false") normalized = false;
      if (key === "cadence.askForHelpEvery") normalized = Number(value || 3);
      setDeepValue(payload, key, normalized);
    }
    await request("/api/settings", { method: "POST", body: JSON.stringify(payload) });
    await loadDashboard();
    showToast("设置已保存");
  });
}

window.addEventListener("DOMContentLoaded", async () => {
  try {
    bindEvents();
    await loadDashboard();
  } catch (error) {
    showToast(error.message);
  }
});
