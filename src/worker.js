import { defaultHistory, defaultSettings } from "./defaults.js";

const SETTINGS_KEY = "settings";
const HISTORY_KEY = "history";
const DELIVERY_KEY = "delivery-log";

function jsonResponse(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store"
    }
  });
}

function getNowIso() {
  return new Date().toISOString();
}

function redactSettings(settings, env) {
  return {
    ...settings,
    telegram: {
      ...settings.telegram,
      botToken: "",
      botTokenConfigured: Boolean(settings.telegram.botToken || env.TELEGRAM_BOT_TOKEN)
    }
  };
}

function resolveTelegramConfig(settings, env) {
  return {
    ...settings.telegram,
    botToken: settings.telegram.botToken || env.TELEGRAM_BOT_TOKEN || ""
  };
}

async function readStore(env, key, fallbackValue) {
  if (!env.APP_DATA) return structuredClone(fallbackValue);
  const raw = await env.APP_DATA.get(key, "json");
  return raw || structuredClone(fallbackValue);
}

async function writeStore(env, key, value) {
  if (!env.APP_DATA) return;
  await env.APP_DATA.put(key, JSON.stringify(value));
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

function mergeSettings(current, body) {
  return {
    ...current,
    ...body,
    profile: { ...current.profile, ...(body.profile || {}) },
    parents: { ...current.parents, ...(body.parents || {}) },
    cadence: { ...current.cadence, ...(body.cadence || {}) },
    telegram: { ...current.telegram, ...(body.telegram || {}) }
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

function buildTelegramMessage(promptPack, settings) {
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

async function appendDeliveryLog(env, entry) {
  const logs = await readStore(env, DELIVERY_KEY, []);
  const next = [
    {
      id: `delivery_${Date.now()}`,
      createdAt: getNowIso(),
      ...entry
    },
    ...logs
  ].slice(0, 20);
  await writeStore(env, DELIVERY_KEY, next);
  return next;
}

async function sendTelegramMessage(settings, env, promptPack, trigger = "manual") {
  const telegram = resolveTelegramConfig(settings, env);
  const text = buildTelegramMessage(promptPack, settings);

  if (!telegram.enabled || telegram.mode === "mock") {
    const deliveryHistory = await appendDeliveryLog(env, {
      ok: true,
      mode: "mock",
      trigger,
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

  const required = ["botToken", "chatId"];
  const missing = required.filter((key) => !telegram[key]);
  if (missing.length) {
    const deliveryHistory = await appendDeliveryLog(env, {
      ok: false,
      mode: telegram.mode,
      trigger,
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
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      chat_id: telegram.chatId,
      text,
      parse_mode: telegram.parseMode || "Markdown",
      disable_web_page_preview: true
    })
  });

  const result = await response.json();
  const ok = response.ok && result.ok === true;
  const deliveryHistory = await appendDeliveryLog(env, {
    ok,
    mode: telegram.mode,
    trigger,
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

async function handleApi(request, env) {
  const url = new URL(request.url);
  const pathname = url.pathname;
  const settings = await readStore(env, SETTINGS_KEY, defaultSettings);
  const history = await readStore(env, HISTORY_KEY, defaultHistory);

  if (request.method === "GET" && pathname === "/api/settings") {
    return jsonResponse(redactSettings(settings, env));
  }

  if (request.method === "POST" && pathname === "/api/settings") {
    const body = await request.json();
    const next = mergeSettings(settings, body);
    if (!body.telegram?.botToken) next.telegram.botToken = settings.telegram.botToken || "";
    await writeStore(env, SETTINGS_KEY, next);
    return jsonResponse({ ok: true, settings: redactSettings(next, env) });
  }

  if (request.method === "GET" && pathname === "/api/history") {
    return jsonResponse(history);
  }

  if (request.method === "POST" && pathname === "/api/history") {
    const body = await request.json();
    if (!body.summary) return jsonResponse({ ok: false, message: "summary 为必填" }, 400);
    const nextRecord = sanitizeHistoryRecord(body);
    const nextHistory = [nextRecord, ...history].slice(0, 50);
    await writeStore(env, HISTORY_KEY, nextHistory);
    return jsonResponse({ ok: true, record: nextRecord, history: nextHistory });
  }

  if (request.method === "GET" && pathname === "/api/delivery-log") {
    return jsonResponse(await readStore(env, DELIVERY_KEY, []));
  }

  if (request.method === "GET" && pathname === "/api/dashboard") {
    const date = url.searchParams.get("date") || getTodayIso();
    return jsonResponse({
      settings: redactSettings(settings, env),
      promptPack: buildPromptPack(settings, history, date),
      history,
      deliveryHistory: await readStore(env, DELIVERY_KEY, [])
    });
  }

  if (request.method === "POST" && pathname === "/api/telegram/test") {
    const promptPack = buildPromptPack(settings, history, getTodayIso());
    return jsonResponse(await sendTelegramMessage(settings, env, promptPack, "manual"));
  }

  if (request.method === "POST" && pathname === "/api/cron/daily") {
    const promptPack = buildPromptPack(settings, history, getTodayIso());
    return jsonResponse({ ok: true, promptPack, telegram: await sendTelegramMessage(settings, env, promptPack, "scheduled") });
  }

  return null;
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (url.pathname.startsWith("/api/")) {
      try {
        const response = await handleApi(request, env);
        if (response) return response;
        return jsonResponse({ ok: false, message: "Not found" }, 404);
      } catch (error) {
        return jsonResponse({ ok: false, message: error.message }, 500);
      }
    }
    if (env.ASSETS) return env.ASSETS.fetch(request);
    return new Response("Static assets binding is missing.", { status: 500 });
  },

  async scheduled(_event, env) {
    const settings = await readStore(env, SETTINGS_KEY, defaultSettings);
    const history = await readStore(env, HISTORY_KEY, defaultHistory);
    const promptPack = buildPromptPack(settings, history, getTodayIso());
    await sendTelegramMessage(settings, env, promptPack, "scheduled");
  }
};
