import { defaultHistory, defaultSettings } from "./defaults.js";

const SETTINGS_KEY = "settings";
const HISTORY_KEY = "history";

function jsonResponse(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store"
    }
  });
}

async function readStore(env, key, fallbackValue) {
  if (!env.APP_DATA) {
    return structuredClone(fallbackValue);
  }
  const raw = await env.APP_DATA.get(key, "json");
  return raw || structuredClone(fallbackValue);
}

async function writeStore(env, key, value) {
  if (!env.APP_DATA) {
    return;
  }
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
  if (!history.length) {
    return "还没有记录，适合先从轻松问候开始。";
  }
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

  const baseTopic = {
    Monday: "轻松开场，先说说你今天的状态",
    Tuesday: "从吃饭切入，最自然也最好接",
    Wednesday: "顺带问问身体和最近作息",
    Thursday: "发一个生活碎片，降低开口成本",
    Friday: "聊聊工作或最近见闻",
    Saturday: "发起 5 到 10 分钟语音或视频",
    Sunday: "稍微深入一点，聊近况和生活安排"
  }[dayName] || "用轻松的问候开启聊天";

  const starters = [
    `我这边今天忙完有点累，你们在 ${hometown} 今天过得怎么样？`,
    `${city} 这边今天感觉挺特别的，你们今天吃什么了？`,
    "我刚想起来最近都没问你们了，今天家里有什么新鲜事吗？"
  ];

  const deeperPrompts = [
    "最近有没有哪里不太舒服？要不要我顺手帮你们查一下怎么调理？",
    `${fatherName} 最近上课或者安排多不多，累不累？`,
    `${motherName} 最近有没有和朋友出去走走？`
  ];

  const askForHelpPrompts = [
    `${motherName}，你上次说的那个家常菜怎么做来着？我想周末试一下。`,
    `${fatherName}，你以前工作累的时候一般怎么缓过来的？我最近也想学学。`,
    "我最近有点想把生活过规律一点，你们以前是怎么坚持下来的？"
  ];

  const fragments = [
    "发一张今天的晚饭、通勤路上或天气照片，再配一句轻松吐槽。",
    "如果今天没空长聊，就发一句“我刚下班，想到你们了”。",
    "如果已经连续几天都在文字聊天，今天适合把文字升级成语音。"
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
      callDay ? "周末建议发起一次 5 到 10 分钟语音/视频" : "如果对方愿意多说，顺势延长一点",
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
    wechat: { ...current.wechat, ...(body.wechat || {}) }
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

async function sendWechatTemplateMessage(settings, payload) {
  if (!settings.wechat.enabled || settings.wechat.mode === "mock") {
    return {
      ok: true,
      mode: "mock",
      message: "当前为 mock 模式，未真实发送微信服务通知。",
      payload
    };
  }

  const required = ["appId", "appSecret", "templateId", "openId"];
  const missing = required.filter((key) => !settings.wechat[key]);
  if (missing.length) {
    return {
      ok: false,
      mode: settings.wechat.mode,
      message: `缺少微信配置：${missing.join(", ")}`
    };
  }

  const tokenUrl = `https://api.weixin.qq.com/cgi-bin/token?grant_type=client_credential&appid=${encodeURIComponent(settings.wechat.appId)}&secret=${encodeURIComponent(settings.wechat.appSecret)}`;
  const tokenResponse = await fetch(tokenUrl);
  const tokenJson = await tokenResponse.json();
  if (!tokenResponse.ok || !tokenJson.access_token) {
    return {
      ok: false,
      mode: settings.wechat.mode,
      message: "获取 access token 失败",
      detail: tokenJson
    };
  }

  const messageResponse = await fetch(`https://api.weixin.qq.com/cgi-bin/message/subscribe/send?access_token=${encodeURIComponent(tokenJson.access_token)}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      touser: settings.wechat.openId,
      template_id: settings.wechat.templateId,
      page: settings.wechat.page,
      data: {
        thing1: { value: payload.title.slice(0, 20) },
        thing2: { value: payload.message.slice(0, 20) },
        time3: { value: payload.timeLabel || `${payload.date} ${settings.profile.contactWindow}` }
      }
    })
  });

  const messageJson = await messageResponse.json();
  return {
    ok: messageResponse.ok && messageJson.errcode === 0,
    mode: settings.wechat.mode,
    message: messageJson.errmsg || "发送完成",
    detail: messageJson
  };
}

function buildWechatPayload(promptPack, settings) {
  return {
    title: `今天联系${settings.parents.fatherName || "爸妈"}`,
    message: promptPack.suggestions[0],
    timeLabel: `${promptPack.date} ${settings.profile.contactWindow}`,
    date: promptPack.date
  };
}

async function handleApi(request, env) {
  const url = new URL(request.url);
  const pathname = url.pathname;
  const settings = await readStore(env, SETTINGS_KEY, defaultSettings);
  const history = await readStore(env, HISTORY_KEY, defaultHistory);

  if (request.method === "GET" && pathname === "/api/settings") {
    return jsonResponse(settings);
  }

  if (request.method === "POST" && pathname === "/api/settings") {
    const body = await request.json();
    const next = mergeSettings(settings, body);
    await writeStore(env, SETTINGS_KEY, next);
    return jsonResponse({ ok: true, settings: next });
  }

  if (request.method === "GET" && pathname === "/api/history") {
    return jsonResponse(history);
  }

  if (request.method === "POST" && pathname === "/api/history") {
    const body = await request.json();
    if (!body.summary) {
      return jsonResponse({ ok: false, message: "summary 为必填" }, 400);
    }
    const nextRecord = sanitizeHistoryRecord(body);
    const nextHistory = [nextRecord, ...history].slice(0, 50);
    await writeStore(env, HISTORY_KEY, nextHistory);
    return jsonResponse({ ok: true, record: nextRecord, history: nextHistory });
  }

  if (request.method === "GET" && pathname === "/api/dashboard") {
    const date = url.searchParams.get("date") || getTodayIso();
    return jsonResponse({
      settings,
      promptPack: buildPromptPack(settings, history, date),
      history
    });
  }

  if (request.method === "POST" && pathname === "/api/wechat/test") {
    const promptPack = buildPromptPack(settings, history, getTodayIso());
    const result = await sendWechatTemplateMessage(settings, buildWechatPayload(promptPack, settings));
    return jsonResponse(result);
  }

  if (request.method === "POST" && pathname === "/api/cron/daily") {
    const promptPack = buildPromptPack(settings, history, getTodayIso());
    const result = await sendWechatTemplateMessage(settings, buildWechatPayload(promptPack, settings));
    return jsonResponse({ ok: true, promptPack, wechat: result });
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

    if (env.ASSETS) {
      return env.ASSETS.fetch(request);
    }

    return new Response("Static assets binding is missing.", { status: 500 });
  },

  async scheduled(_event, env) {
    const settings = await readStore(env, SETTINGS_KEY, defaultSettings);
    const history = await readStore(env, HISTORY_KEY, defaultHistory);
    const promptPack = buildPromptPack(settings, history, getTodayIso());
    await sendWechatTemplateMessage(settings, buildWechatPayload(promptPack, settings));
  }
};
