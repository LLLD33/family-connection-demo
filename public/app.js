const state = {
  dashboard: null,
  settings: null,
  history: [],
  deliveryHistory: [],
  latestTrendReport: null,
  trendHistory: [],
  selectedTopic: null
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
  showToast.timer = window.setTimeout(() => toast.classList.add("hidden"), 2600);
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

function formatDateTime(value) {
  if (!value) return "未生成";
  return new Date(value).toLocaleString("zh-CN", {
    hour12: false
  });
}

function getAiProviderLabel(settings) {
  return settings?.openai?.provider === "openai" ? "OpenAI" : "Google Gemma";
}

function formatAiModeLabel(ai) {
  if (!ai || ai.mode === "fallback") return "本地模板";
  return `${ai.providerLabel || "AI"} / ${ai.model}`;
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
  document.getElementById("openAiStatus").value = `${getAiProviderLabel(settings)}：${settings.openai.apiKeyConfigured ? "已配置" : "未配置"}`;
}

function renderDeliveryHistory() {
  const deliveryList = document.getElementById("deliveryList");
  const sendStatus = document.getElementById("sendStatus");
  deliveryList.innerHTML = "";

  if (!state.deliveryHistory.length) {
    deliveryList.innerHTML = '<div class="history-item"><p>还没有发送记录。</p></div>';
    sendStatus.textContent = "Telegram 发送状态会显示在这里。";
    return;
  }

  const latest = state.deliveryHistory[0];
  sendStatus.textContent = latest.ok
    ? `最近一次${latest.kind === "trend" ? "热点" : "亲情"}发送成功：${formatDateTime(latest.createdAt)}`
    : `最近一次发送失败：${latest.error || "未知错误"}`;

  state.deliveryHistory.forEach((item) => {
    const card = document.createElement("div");
    card.className = "history-item";

    const summary = document.createElement("p");
    const kindLabel = item.kind === "trend" ? "热点摘要" : "亲情提醒";
    summary.textContent = item.ok
      ? `${kindLabel} · ${item.trigger === "scheduled" ? "定时发送" : "手动发送"}已完成`
      : `${kindLabel} · ${item.trigger === "scheduled" ? "定时发送" : "手动发送"}失败`;

    const detail = document.createElement("p");
    detail.className = "muted";
    detail.textContent = item.ok ? item.preview : (item.error || "发送失败");

    const meta = document.createElement("div");
    meta.className = "history-meta";
    meta.textContent = `${formatDateTime(item.createdAt)} · ${item.mode}`;

    card.append(summary, detail, meta);
    deliveryList.appendChild(card);
  });
}

function renderFamilyDashboard() {
  if (!state.dashboard) return;
  const { promptPack, settings } = state.dashboard;

  document.getElementById("todayDate").textContent = promptPack.date;
  document.getElementById("topicSummary").textContent = promptPack.topic;
  document.getElementById("dayTag").textContent = promptPack.dayName;
  document.getElementById("lastSummary").textContent = promptPack.summary;

  if (!state.latestTrendReport) {
    document.getElementById("heroTitle").textContent = `${promptPack.dayName} 的联系节奏已经帮你排好了`;
    document.getElementById("heroSummary").textContent = `${promptPack.summary} 今天建议先以“${promptPack.topic}”切入，等你刷新完热点，再顺手把一个新话题带给爸妈。`;
  }

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

  document.getElementById("trendRefreshInfo").textContent = state.latestTrendReport
    ? `最近一轮：${formatDateTime(state.latestTrendReport.createdAt)}`
    : `默认建议 ${settings.trends.refreshHours} 小时更新一轮热点`;
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

function renderSourceBoard(report) {
  const sourceBoard = document.getElementById("sourceBoard");
  sourceBoard.innerHTML = "";

  if (!report) {
    sourceBoard.innerHTML = '<div class="history-item"><p>还没有热点报告，先点“刷新最新热点并生成 3 条文案”。</p></div>';
    return;
  }

  report.sourceStatus.forEach((status) => {
    const card = document.createElement("article");
    card.className = "source-card";

    const header = document.createElement("div");
    header.className = "source-card-header";

    const title = document.createElement("h4");
    title.textContent = `${status.sourceLabel}`;

    const badge = document.createElement("span");
    badge.className = `pill ${status.ok ? "ok" : "warn"}`;
    badge.textContent = status.ok ? `${status.count} 条` : "抓取失败";

    header.append(title, badge);

    const note = document.createElement("p");
    note.className = "muted";
    note.textContent = status.message;

    const list = document.createElement("div");
    list.className = "source-topic-list";

    const topics = report.sourceTopics[status.source] || [];
    if (!topics.length) {
      const empty = document.createElement("div");
      empty.className = "history-item";
      empty.textContent = "这一轮没有拿到可用标题。";
      list.appendChild(empty);
    } else {
      topics.forEach((topic) => {
        const item = document.createElement("a");
        item.className = "source-topic-item";
        item.href = topic.url;
        item.target = "_blank";
        item.rel = "noreferrer";
        item.textContent = `#${topic.rank} ${topic.title}`;
        item.addEventListener("click", (event) => {
          event.preventDefault();
          openTopicModal(topic);
        });
        list.appendChild(item);
      });
    }

    card.append(header, note, list);
    sourceBoard.appendChild(card);
  });
}

function renderTopicBuckets(report) {
  const bucketBoard = document.getElementById("bucketBoard");
  if (!bucketBoard) return;
  bucketBoard.innerHTML = "";

  if (!report) {
    bucketBoard.innerHTML = '<div class="history-item"><p>还没有分桶热点，刷新后会按时政、军事、经济、社会自动整理。</p></div>';
    return;
  }

  const buckets = report.allowedBuckets || [];
  buckets.forEach((bucket) => {
    const card = document.createElement("article");
    card.className = "source-card";

    const header = document.createElement("div");
    header.className = "source-card-header";

    const title = document.createElement("h4");
    title.textContent = bucket.label;

    const items = report.topicBuckets?.[bucket.key] || [];
    const badge = document.createElement("span");
    badge.className = `pill ${items.length ? "ok" : "warn"}`;
    badge.textContent = `${items.length} 条`;

    header.append(title, badge);

    const note = document.createElement("p");
    note.className = "muted";
    note.textContent = items.length ? `已筛出 ${bucket.label} 向的可聊热点` : `这一轮没有保留下可聊的${bucket.label}热点`;

    const list = document.createElement("div");
    list.className = "source-topic-list";

    if (!items.length) {
      const empty = document.createElement("div");
      empty.className = "history-item";
      empty.textContent = "当前没有适合保留的话题";
      list.appendChild(empty);
    } else {
      items.slice(0, 6).forEach((topic, index) => {
        const item = document.createElement("a");
        item.className = "source-topic-item";
        item.href = topic.url;
        item.target = "_blank";
        item.rel = "noreferrer";
        item.textContent = `#${index + 1} ${topic.title}`;
        item.addEventListener("click", (event) => {
          event.preventDefault();
          openTopicModal(topic);
        });
        list.appendChild(item);
      });
    }

    card.append(header, note, list);
    bucketBoard.appendChild(card);
  });
}

function resetInterpretationPanel() {
  document.getElementById("topicInterpretationPanel").classList.add("hidden");
  document.getElementById("topicInterpretationStatus").textContent = "点击下方按钮后，会用当前 AI 模型实时生成解读。";
  document.getElementById("topicInterpretationSummary").textContent = "";
  document.getElementById("topicInterpretationWhy").textContent = "";
  document.getElementById("topicInterpretationFamily").textContent = "";
  document.getElementById("topicInterpretationRisk").textContent = "";
  document.getElementById("topicInterpretationPoints").innerHTML = "";
}

function openTopicModal(topic) {
  state.selectedTopic = topic;
  document.getElementById("topicModalTitle").textContent = topic.title || "";
  document.getElementById("topicModalSubtitle").textContent = topic.sourceLabel || topic.source || "中文互联网";
  document.getElementById("topicModalMeta").textContent = topic.url || "";
  document.getElementById("readOriginalLink").href = topic.url || "#";
  resetInterpretationPanel();
  document.getElementById("topicModal").classList.remove("hidden");
}

function closeTopicModal() {
  state.selectedTopic = null;
  document.getElementById("topicModal").classList.add("hidden");
}

async function runTopicInterpretation() {
  if (!state.selectedTopic) return;
  const button = document.getElementById("interpretTopicBtn");
  const panel = document.getElementById("topicInterpretationPanel");
  const status = document.getElementById("topicInterpretationStatus");
  button.disabled = true;
  button.textContent = "AI 解读中...";
  panel.classList.remove("hidden");
  status.textContent = "正在调用 AI 实时解读，请稍等。";

  try {
    const result = await request("/api/topics/interpret", {
      method: "POST",
      body: JSON.stringify(state.selectedTopic)
    });
    const interpretation = result.interpretation || {};
    status.textContent = `${formatAiModeLabel(interpretation)} · ${interpretation.message || "已生成解读"}`;
    document.getElementById("topicInterpretationSummary").textContent = interpretation.summary || "";
    document.getElementById("topicInterpretationWhy").textContent = interpretation.whyHot || "";
    document.getElementById("topicInterpretationFamily").textContent = interpretation.familyAngle || "";
    document.getElementById("topicInterpretationRisk").textContent = interpretation.riskNote || "";
    const list = document.getElementById("topicInterpretationPoints");
    list.innerHTML = "";
    (interpretation.talkingPoints || []).forEach((item) => {
      const li = document.createElement("li");
      li.textContent = item;
      list.appendChild(li);
    });
  } catch (error) {
    status.textContent = error.message || "AI 解读失败，请稍后再试。";
  } finally {
    button.disabled = false;
    button.textContent = "AI 智能解读";
  }
}

function renderScriptList(report) {
  const scriptList = document.getElementById("scriptList");
  scriptList.innerHTML = "";

  if (!report || !report.scripts?.length) {
    scriptList.innerHTML = '<div class="history-item"><p>还没有口播文案，先刷新一轮热点。</p></div>';
    return;
  }

  report.scripts.forEach((item, index) => {
    const card = document.createElement("div");
    card.className = "script-card";

    const topRow = document.createElement("div");
    topRow.className = "script-card-header";

    const titleWrap = document.createElement("div");
    const title = document.createElement("h4");
    title.textContent = `${index + 1}. ${item.title}`;
    const tags = document.createElement("p");
    tags.className = "muted";
    tags.textContent = (item.sourceMix || []).join(" / ") || "中文互联网";
    titleWrap.append(title, tags);

    const button = document.createElement("button");
    button.className = "copy-button";
    button.textContent = "复制整条";
    button.addEventListener("click", async () => {
      const content = [
        item.title,
        item.hook,
        item.spokenScript,
        `带爸妈聊：${item.conversationStarter}`,
        `适合原因：${item.parentAngle}`
      ].join("\n");
      await navigator.clipboard.writeText(content);
      showToast("文案已复制");
    });

    topRow.append(titleWrap, button);

    const hotReason = document.createElement("p");
    hotReason.className = "muted";
    hotReason.textContent = item.hotReason;

    const hook = document.createElement("p");
    hook.className = "script-block";
    hook.innerHTML = `<strong>开头：</strong>${item.hook}`;

    const spokenScript = document.createElement("p");
    spokenScript.className = "script-block";
    spokenScript.innerHTML = `<strong>口播稿：</strong>${item.spokenScript}`;

    const conversation = document.createElement("p");
    conversation.className = "script-block";
    conversation.innerHTML = `<strong>带爸妈聊：</strong>${item.conversationStarter}`;

    const angle = document.createElement("p");
    angle.className = "script-block";
    angle.innerHTML = `<strong>为什么适合聊：</strong>${item.parentAngle}`;

    card.append(topRow, hotReason, hook, spokenScript, conversation, angle);
    scriptList.appendChild(card);
  });
}

function renderTrendHistory() {
  const trendHistoryList = document.getElementById("trendHistoryList");
  trendHistoryList.innerHTML = "";

  if (!state.trendHistory.length) {
    trendHistoryList.innerHTML = '<div class="history-item"><p>还没有热点生成历史。</p></div>';
    return;
  }

  state.trendHistory.forEach((report) => {
    const card = document.createElement("div");
    card.className = "history-item";

    const title = document.createElement("p");
    title.textContent = report.scripts?.length
      ? report.scripts.map((item, index) => `${index + 1}. ${item.title}`).join(" / ")
      : "这一轮没有拿到可用文案";

    const detail = document.createElement("p");
    detail.className = "muted";
    detail.textContent = `${formatAiModeLabel(report.ai)} · ${report.summary || "已完成生成"}`;

    const meta = document.createElement("div");
    meta.className = "history-meta";
    meta.textContent = `${formatDateTime(report.createdAt)} · ${report.trigger === "scheduled" ? "定时" : "手动"} · ${report.topicCount || 0} 条候选`;

    card.append(title, detail, meta);
    trendHistoryList.appendChild(card);
  });
}

function renderTrendPanel() {
  const report = state.latestTrendReport;
  const trendMetaTag = document.getElementById("trendMetaTag");
  const trendSummary = document.getElementById("trendSummary");
  const heroTitle = document.getElementById("heroTitle");
  const heroSummary = document.getElementById("heroSummary");
  const aiModeStatus = document.getElementById("aiModeStatus");

  if (!report) {
    trendMetaTag.textContent = "等待首次生成";
    trendSummary.textContent = "点击刷新后，这里会展示本轮热点摘要、AI 模式和抓取成功情况。";
    aiModeStatus.textContent = state.settings?.openai?.apiKeyConfigured
      ? `${getAiProviderLabel(state.settings)} 已就绪，默认模型 ${state.settings.openai.model}`
      : `${getAiProviderLabel(state.settings)} 还没配置 API Key，首次生成会先用本地模板保底。`;
    renderSourceBoard(null);
    renderTopicBuckets(null);
    renderScriptList(null);
    renderTrendHistory();
    return;
  }

  trendMetaTag.textContent = `${formatAiModeLabel(report.ai)} · ${report.topicCount} 条候选 · ${report.bucketCount || 0} 个分桶`;
  trendSummary.textContent = report.summary || "本轮热点已经整理完成。";
  heroTitle.textContent = "这一轮最值得和爸妈聊的 3 个热点已经备好";
  heroSummary.textContent = `${report.summary || "热点已整理完成。"} 这轮共抓到 ${report.topicCount} 个候选话题，并按时政、军事、经济、社会做了过滤和分桶，建议你优先挑一条最轻松的先开口。`;
  aiModeStatus.textContent = report.ai.mode !== "fallback"
    ? `当前用 ${formatAiModeLabel(report.ai)} 生成，${report.ai.message}`
    : `当前是本地保底生成，原因：${report.ai.message}`;

  renderSourceBoard(report);
  renderTopicBuckets(report);
  renderScriptList(report);
  renderTrendHistory();
}

function renderAll() {
  renderFamilyDashboard();
  renderHistory();
  renderDeliveryHistory();
  renderTrendPanel();
  fillSettingsForm(state.settings);
}

async function loadDashboard() {
  const data = await request("/api/dashboard");
  state.dashboard = data;
  state.settings = data.settings;
  state.history = data.history;
  state.deliveryHistory = data.deliveryHistory || [];
  state.latestTrendReport = data.latestTrendReport || null;
  state.trendHistory = data.trendHistory || [];
  renderAll();
}

function normalizeSettingValue(key, value) {
  if (value === "true") return true;
  if (value === "false") return false;
  if (["cadence.askForHelpEvery", "trends.refreshHours", "trends.sourceLimit", "trends.scriptCount"].includes(key)) {
    return Number(value || 0);
  }
  return value;
}

function bindEvents() {
  document.getElementById("closeTopicModalBtn").addEventListener("click", closeTopicModal);
  document.getElementById("interpretTopicBtn").addEventListener("click", runTopicInterpretation);
  document.getElementById("saveTopicBtn").addEventListener("click", () => showToast("收藏功能这版先预留，后面可以接历史收藏。"));
  document.getElementById("moreTopicBtn").addEventListener("click", () => showToast("其他功能这版先预留，后面可以加转发和备注。"));
  document.getElementById("topicModal").addEventListener("click", (event) => {
    if (event.target?.dataset?.closeModal === "true") closeTopicModal();
  });

  document.getElementById("refreshBtn").addEventListener("click", async () => {
    await loadDashboard();
    showToast("今日联系建议已刷新");
  });

  document.getElementById("runCronBtn").addEventListener("click", async () => {
    const result = await request("/api/cron/daily", { method: "POST" });
    await loadDashboard();
    showToast(result.telegram?.message || "已执行每日提醒");
  });

  document.getElementById("refreshTrendsBtn").addEventListener("click", async () => {
    const result = await request("/api/trends/refresh", { method: "POST" });
    await loadDashboard();
    showToast(result.report?.ai?.mode !== "fallback" ? "热点和 AI 文案都刷新好了" : (result.report?.ai?.message || "热点已刷新"));
  });

  document.getElementById("pushTrendsBtn").addEventListener("click", async () => {
    const result = await request("/api/trends/push", { method: "POST" });
    await loadDashboard();
    showToast(result.telegram?.message || "热点摘要已推送");
  });

  document.getElementById("sendTelegramBtn").addEventListener("click", async () => {
    const result = await request("/api/telegram/test", { method: "POST" });
    await loadDashboard();
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
      if (["botTokenStatus", "openAiStatus"].includes(key)) continue;
      setDeepValue(payload, key, normalizeSettingValue(key, value));
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
