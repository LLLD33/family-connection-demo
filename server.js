const http = require("http");
const fs = require("fs");
const path = require("path");
const { URL } = require("url");
const { defaultSettings, defaultHistory } = require("./defaults");
const { generateTrendReport, buildTrendTelegramMessage } = require("./trend-service");

const HOST = "127.0.0.1";
const PORT = Number(process.env.PORT || 3000);
const ROOT = __dirname;
const PUBLIC_DIR = path.join(ROOT, "public");
const DATA_DIR = path.join(ROOT, "data");
const SETTINGS_FILE = path.join(DATA_DIR, "settings.json");
const HISTORY_FILE = path.join(DATA_DIR, "history.json");
const DELIVERY_FILE = path.join(DATA_DIR, "delivery-log.json");
const TREND_REPORTS_FILE = path.join(DATA_DIR, "trend-reports.json");

ensureDir(DATA_DIR);
ensureDir(PUBLIC_DIR);
ensureFile(SETTINGS_FILE, defaultSettings);
ensureFile(HISTORY_FILE, defaultHistory);
ensureFile(DELIVERY_FILE, []);
ensureFile(TREND_REPORTS_FILE, []);

function ensureDir(dirPath) {
  if (!fs.existsSync(dirPath)) fs.mkdirSync(dirPath, { recursive: true });
}

function ensureFile(filePath, fallbackValue) {
  if (!fs.existsSync(filePath)) {
    fs.writeFileSync(filePath, JSON.stringify(fallbackValue, null, 2), "utf8");
  }
}

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

function writeJson(filePath, value) {
  fs.writeFileSync(filePath, JSON.stringify(value, null, 2), "utf8");
}

function getNowIso() {
  return new Date().toISOString();
}

function getTodayIso() {
  return new Intl.DateTimeFormat("sv-SE", {
    timeZone: "Asia/Tokyo",
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  }).format(new Date());
}

function getDayName(dateString) {
  const date = dateString ? new Date(dateString) : new Date();
  return date.toLocaleDateString("en-US", { weekday: "long", timeZone: "Asia/Tokyo" });
}

function resolveTelegramConfig(settings) {
  return {
    ...settings.telegram,
    botToken: settings.telegram.botToken || process.env.TELEGRAM_BOT_TOKEN || ""
  };
}

function normalizeAiSettings(settings) {
  const next = {
    ...settings,
    openai: { ...(settings.openai || {}) }
  };
  const provider = next.openai.provider || "google";
  let model = next.openai.model || "";

  if (provider === "google" && (!model || /^gpt-/i.test(model))) {
    model = "gemma-3-27b-it";
  }
  if (provider === "openai" && (!model || /^gemma/i.test(model))) {
    model = "gpt-5.4";
  }

  next.openai.provider = provider;
  next.openai.model = model;
  next.openai.reasoningEffort = next.openai.reasoningEffort || "medium";

  return next;
}

function resolveAiConfig(settings) {
  const normalized = normalizeAiSettings(settings);
  return {
    ...normalized.openai,
    googleApiKey: process.env.GOOGLE_API_KEY || "",
    openAiApiKey: process.env.OPENAI_API_KEY || ""
  };
}

function getSettings() {
  return normalizeAiSettings(mergeSettings(defaultSettings, readJson(SETTINGS_FILE)));
}

function redactSettings(settings) {
  const normalized = normalizeAiSettings(settings);
  const provider = normalized.openai.provider;
  return {
    ...normalized,
    telegram: {
      ...normalized.telegram,
      botToken: "",
      botTokenConfigured: Boolean(normalized.telegram.botToken || process.env.TELEGRAM_BOT_TOKEN)
    },
    openai: {
      ...normalized.openai,
      apiKeyConfigured: provider === "google" ? Boolean(process.env.GOOGLE_API_KEY) : Boolean(process.env.OPENAI_API_KEY),
      googleApiKeyConfigured: Boolean(process.env.GOOGLE_API_KEY),
      openAiApiKeyConfigured: Boolean(process.env.OPENAI_API_KEY)
    }
  };
}

function sendJson(res, statusCode, data) {
  res.writeHead(statusCode, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store"
  });
  res.end(JSON.stringify(data));
}

function sendText(res, statusCode, text, contentType) {
  res.writeHead(statusCode, {
    "Content-Type": contentType,
    "Cache-Control": "no-store"
  });
  res.end(text);
}

function parseBody(req) {
  return new Promise((resolve, reject) => {
    let raw = "";
    req.on("data", (chunk) => {
      raw += chunk;
      if (raw.length > 1024 * 1024) {
        reject(new Error("Payload too large"));
        req.destroy();
      }
    });
    req.on("end", () => {
      if (!raw) return resolve({});
      try {
        resolve(JSON.parse(raw));
      } catch (_error) {
        reject(new Error("Invalid JSON body"));
      }
    });
    req.on("error", reject);
  });
}

function summarizeLastRecord(history) {
  if (!history.length) return "还没有记录，今天适合先从轻松问候开始。";
  const last = history[0];
  return `上次在 ${last.date} 聊了：${last.summary}`;
}

function countTouchesSince(history, days) {
  const now = new Date(getTodayIso());
  return history.filter((item) => {
    const delta = now - new Date(item.date);
    return delta / (1000 * 60 * 60 * 24) <= days;
  }).length;
}

function buildPromptPack(settings, history, targetDate) {
  const dayName = getDayName(targetDate);
  const cadence = settings.cadence;
  const deeper = cadence.deeperDays.includes(dayName);
  const callDay = cadence.callDay === dayName;
  const recentCount = countTouchesSince(history, 7);
  const shouldAskForHelp = recentCount % Number(cadence.askForHelpEvery || 3) === 0;
  const fatherName = settings.parents.fatherName || "爸爸";
  const motherName = settings.parents.motherName || "妈妈";
  const hometown = settings.parents.hometown || "家里";
  const city = settings.profile.city || "东京";
  const profileName = settings.profile.name || "你";

  const baseTopic = {
    Monday: "先讲你今天的状态，再把话题带给爸妈",
    Tuesday: "从吃饭和天气切入，最自然也最容易接住",
    Wednesday: "轻轻带到身体和作息，不要一上来太沉重",
    Thursday: "发一个生活碎片，降低开口成本",
    Friday: "聊聊这周见闻，让他们参与到你的生活里",
    Saturday: "周末适合升级成 5 到 10 分钟语音或视频",
    Sunday: "稍微深入一点，聊近况和下周安排"
  }[dayName] || "用轻松的问候开启聊天";

  const starters = [
    `${profileName} 今天下班有点累，不过想到你们了。你们在 ${hometown} 今天过得怎么样？`,
    `${city} 这边今天有点小变化，你们今天吃什么了？`,
    "我刚忙完，突然想起最近都没好好问你们。家里今天有什么新鲜事吗？"
  ];

  const deeperPrompts = [
    "最近有没有哪里不太舒服？如果有的话我可以顺手帮你们查查怎么调理。",
    `${fatherName} 最近上课或者安排多不多，累不累？`,
    `${motherName} 最近有没有和朋友出去走走或者吃个饭？`
  ];

  const askForHelpPrompts = [
    `${motherName}，你上次说的那个家常菜到底怎么做来着？我这周想试一下。`,
    `${fatherName}，你以前工作累的时候一般怎么缓过来的？我最近也想学学。`,
    "我最近想把作息调整规律一点，你们以前是怎么坚持下来的？"
  ];

  const fragments = [
    "拍一张今天的晚饭、通勤路上或天气照片，配一句轻松吐槽。",
    "如果今天实在忙，就发一句“我刚下班，想到你们了”。",
    "如果已经连续几天都在文字聊天，今天适合升级成语音。"
  ];

  const suggestions = [...starters];
  if (deeper) suggestions.push(...deeperPrompts);
  if (shouldAskForHelp) suggestions.push(...askForHelpPrompts);

  return {
    date: targetDate || getTodayIso(),
    dayName,
    topic: baseTopic,
    deeper,
    callDay,
    shouldAskForHelp,
    summary: summarizeLastRecord(history),
    checklist: [
      `在 ${settings.profile.contactWindow} 内完成一次轻量联系`,
      deeper ? "今天适合轻微关心身体或生活节奏" : "今天先从轻松内容切入，不要一上来问健康",
      callDay ? "周末建议发起一次 5 到 10 分钟语音或视频" : "如果对方愿意多说，顺势多聊一点",
      shouldAskForHelp ? "今天插入一次反向索取，增强参与感" : "保持自然，不需要把关心说得太重"
    ],
    suggestions: suggestions.slice(0, 5),
    fragments
  };
}

function sanitizeHistoryRecord(input) {
  return {
    id: input.id || `log_${Date.now()}`,
    date: input.date || getTodayIso(),
    mood: input.mood || "normal",
    channel: input.channel || "text",
    summary: String(input.summary || "").trim(),
    nextIdea: String(input.nextIdea || "").trim()
  };
}

function buildFamilyTelegramMessage(promptPack, settings) {
  return [
    "*亲情联系提醒*",
    `日期：${promptPack.date} (${promptPack.dayName})`,
    `建议主题：${promptPack.topic}`,
    "",
    `首条话术：${promptPack.suggestions[0]}`,
    "",
    `最近记忆：${promptPack.summary}`,
    `建议时段：${settings.profile.contactWindow}`
  ].join("\n");
}

function appendDeliveryLog(entry) {
  const logs = readJson(DELIVERY_FILE);
  const next = [
    {
      id: `delivery_${Date.now()}`,
      createdAt: getNowIso(),
      ...entry
    },
    ...logs
  ].slice(0, 40);
  writeJson(DELIVERY_FILE, next);
  return next;
}

async function sendTelegramText(settings, text, trigger, kind) {
  const telegram = resolveTelegramConfig(settings);

  if (!telegram.enabled || telegram.mode === "mock") {
    const deliveryHistory = appendDeliveryLog({
      ok: true,
      mode: "mock",
      trigger,
      kind,
      chatId: telegram.chatId || "",
      preview: text
    });
    return {
      ok: true,
      mode: "mock",
      message: "当前为 mock 模式，未真实发送 Telegram 消息。",
      payload: { chatId: telegram.chatId, text },
      deliveryHistory
    };
  }

  const missing = ["botToken", "chatId"].filter((key) => !telegram[key]);
  if (missing.length) {
    const deliveryHistory = appendDeliveryLog({
      ok: false,
      mode: telegram.mode,
      trigger,
      kind,
      chatId: telegram.chatId || "",
      preview: text,
      error: `缺少 Telegram 配置：${missing.join(", ")}`
    });
    return {
      ok: false,
      mode: telegram.mode,
      message: `缺少 Telegram 配置：${missing.join(", ")}`,
      deliveryHistory
    };
  }

  const response = await fetch(`https://api.telegram.org/bot${encodeURIComponent(telegram.botToken)}/sendMessage`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      chat_id: telegram.chatId,
      text,
      parse_mode: telegram.parseMode || "Markdown",
      disable_web_page_preview: true
    })
  });

  const result = await response.json();
  const ok = response.ok && result.ok === true;
  const deliveryHistory = appendDeliveryLog({
    ok,
    mode: telegram.mode,
    trigger,
    kind,
    chatId: telegram.chatId,
    preview: text,
    messageId: result.result?.message_id || null,
    error: ok ? "" : (result.description || "发送失败")
  });

  return {
    ok,
    mode: telegram.mode,
    message: result.description || (ok ? "发送完成" : "发送失败"),
    detail: result,
    deliveryHistory
  };
}

async function sendFamilyTelegram(settings, promptPack, trigger) {
  return sendTelegramText(settings, buildFamilyTelegramMessage(promptPack, settings), trigger, "family");
}

async function sendTrendTelegram(settings, report, trigger) {
  return sendTelegramText(settings, buildTrendTelegramMessage(report), trigger, "trend");
}

function serveStatic(reqPath, res) {
  const filePath = reqPath === "/" ? path.join(PUBLIC_DIR, "index.html") : path.join(PUBLIC_DIR, reqPath);
  const normalized = path.normalize(filePath);
  if (!normalized.startsWith(PUBLIC_DIR)) return sendText(res, 403, "Forbidden", "text/plain; charset=utf-8");
  if (!fs.existsSync(normalized) || fs.statSync(normalized).isDirectory()) {
    return sendText(res, 404, "Not found", "text/plain; charset=utf-8");
  }

  const ext = path.extname(normalized).toLowerCase();
  const contentType = {
    ".html": "text/html; charset=utf-8",
    ".css": "text/css; charset=utf-8",
    ".js": "application/javascript; charset=utf-8",
    ".json": "application/json; charset=utf-8"
  }[ext] || "application/octet-stream";

  sendText(res, 200, fs.readFileSync(normalized), contentType);
}

async function refreshTrendReports(settings, trigger) {
  const reports = readJson(TREND_REPORTS_FILE);
  const report = await generateTrendReport(fetch, settings, {
    trigger,
    aiConfig: resolveAiConfig(settings)
  });
  const nextReports = [report, ...reports].slice(0, 20);
  writeJson(TREND_REPORTS_FILE, nextReports);
  return {
    report,
    history: nextReports
  };
}

function mergeSettings(current, body) {
  return normalizeAiSettings({
    ...current,
    ...body,
    profile: { ...current.profile, ...(body.profile || {}) },
    parents: { ...current.parents, ...(body.parents || {}) },
    cadence: { ...current.cadence, ...(body.cadence || {}) },
    telegram: {
      ...current.telegram,
      ...(body.telegram || {}),
      botToken: body.telegram?.botToken ? body.telegram.botToken : current.telegram.botToken
    },
    trends: { ...current.trends, ...(body.trends || {}) },
    openai: { ...current.openai, ...(body.openai || {}) }
  });
}

const server = http.createServer(async (req, res) => {
  const parsedUrl = new URL(req.url, `http://${req.headers.host}`);
  const pathname = parsedUrl.pathname;

  try {
    if (req.method === "GET" && pathname === "/api/settings") {
      return sendJson(res, 200, redactSettings(getSettings()));
    }

    if (req.method === "POST" && pathname === "/api/settings") {
      const body = await parseBody(req);
      const current = getSettings();
      const next = mergeSettings(current, body);
      writeJson(SETTINGS_FILE, next);
      return sendJson(res, 200, { ok: true, settings: redactSettings(next) });
    }

    if (req.method === "GET" && pathname === "/api/history") {
      return sendJson(res, 200, readJson(HISTORY_FILE));
    }

    if (req.method === "POST" && pathname === "/api/history") {
      const body = await parseBody(req);
      if (!body.summary) return sendJson(res, 400, { ok: false, message: "summary 为必填" });
      const history = readJson(HISTORY_FILE);
      const nextRecord = sanitizeHistoryRecord(body);
      const nextHistory = [nextRecord, ...history].slice(0, 50);
      writeJson(HISTORY_FILE, nextHistory);
      return sendJson(res, 200, { ok: true, record: nextRecord, history: nextHistory });
    }

    if (req.method === "GET" && pathname === "/api/delivery-log") {
      return sendJson(res, 200, readJson(DELIVERY_FILE));
    }

    if (req.method === "GET" && pathname === "/api/dashboard") {
      const settings = getSettings();
      const history = readJson(HISTORY_FILE);
      const trendHistory = readJson(TREND_REPORTS_FILE);
      const date = parsedUrl.searchParams.get("date") || getTodayIso();
      return sendJson(res, 200, {
        settings: redactSettings(settings),
        promptPack: buildPromptPack(settings, history, date),
        history,
        deliveryHistory: readJson(DELIVERY_FILE),
        latestTrendReport: trendHistory[0] || null,
        trendHistory
      });
    }

    if (req.method === "GET" && pathname === "/api/trends") {
      const settings = getSettings();
      const history = readJson(TREND_REPORTS_FILE);
      return sendJson(res, 200, {
        settings: redactSettings(settings),
        latestReport: history[0] || null,
        history
      });
    }

    if (req.method === "POST" && pathname === "/api/trends/refresh") {
      const settings = getSettings();
      const result = await refreshTrendReports(settings, "manual");
      let telegram = null;
      if (settings.telegram.autoTrendPush) {
        telegram = await sendTrendTelegram(settings, result.report, "manual");
      }
      return sendJson(res, 200, {
        ok: true,
        report: result.report,
        history: result.history,
        telegram
      });
    }

    if (req.method === "POST" && pathname === "/api/trends/push") {
      const settings = getSettings();
      let history = readJson(TREND_REPORTS_FILE);
      let report = history[0];
      if (!report) {
        const refreshed = await refreshTrendReports(settings, "manual");
        history = refreshed.history;
        report = refreshed.report;
      }
      const telegram = await sendTrendTelegram(settings, report, "manual");
      return sendJson(res, 200, {
        ok: true,
        report,
        history,
        telegram
      });
    }

    if (req.method === "POST" && pathname === "/api/telegram/test") {
      const settings = getSettings();
      const history = readJson(HISTORY_FILE);
      const promptPack = buildPromptPack(settings, history, getTodayIso());
      return sendJson(res, 200, await sendFamilyTelegram(settings, promptPack, "manual"));
    }

    if (req.method === "POST" && pathname === "/api/cron/daily") {
      const settings = getSettings();
      const history = readJson(HISTORY_FILE);
      const promptPack = buildPromptPack(settings, history, getTodayIso());
      return sendJson(res, 200, {
        ok: true,
        promptPack,
        telegram: await sendFamilyTelegram(settings, promptPack, "scheduled")
      });
    }

    if (req.method === "POST" && pathname === "/api/cron/trends") {
      const settings = getSettings();
      const result = await refreshTrendReports(settings, "scheduled");
      const telegram = settings.telegram.autoTrendPush
        ? await sendTrendTelegram(settings, result.report, "scheduled")
        : null;
      return sendJson(res, 200, {
        ok: true,
        report: result.report,
        history: result.history,
        telegram
      });
    }

    if (req.method === "GET" && (pathname === "/" || pathname.endsWith(".css") || pathname.endsWith(".js"))) {
      return serveStatic(pathname, res);
    }

    return sendJson(res, 404, { ok: false, message: "Not found" });
  } catch (error) {
    return sendJson(res, 500, { ok: false, message: error.message });
  }
});

function startServer(port = PORT, host = HOST) {
  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(port, host, () => {
      server.removeListener("error", reject);
      console.log(`Family hot news assistant running at http://${host}:${port}`);
      resolve(server);
    });
  });
}

if (require.main === module) {
  startServer().catch((error) => {
    console.error(error.message);
    process.exit(1);
  });
}

module.exports = { server, startServer, buildPromptPack };
