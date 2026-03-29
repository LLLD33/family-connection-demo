const SOURCE_ORDER = ["douyin", "bilibili", "zhihu", "youtube"];

const SOURCE_LABELS = {
  douyin: "抖音",
  bilibili: "B站",
  zhihu: "知乎",
  youtube: "YouTube"
};

const DEFAULT_HEADERS = {
  "user-agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/136.0.0.0 Safari/537.36",
  "accept-language": "zh-CN,zh;q=0.9,en;q=0.8"
};

function normalizeText(value) {
  return String(value || "")
    .replace(/\\u003C/g, "<")
    .replace(/\\u003E/g, ">")
    .replace(/\\u0026/g, "&")
    .replace(/\\n/g, " ")
    .replace(/\\t/g, " ")
    .replace(/\s+/g, " ")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .trim();
}

function decodeUnicodeEscapes(value) {
  return String(value || "")
    .replace(/\\u([0-9a-fA-F]{4})/g, (_, code) => String.fromCharCode(Number.parseInt(code, 16)))
    .replace(/\\"/g, '"')
    .replace(/\\\\/g, "\\");
}

function normalizeTopicTitle(value) {
  return normalizeText(decodeUnicodeEscapes(value))
    .replace(/^[#\d\-\.\s]+/, "")
    .replace(/[|｜]\s*(抖音|知乎|YouTube|B站).*$/i, "")
    .trim();
}

function extractVisibleLines(html) {
  return String(html || "")
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, "\n")
    .split(/\n+/)
    .map((line) => normalizeTopicTitle(line))
    .filter(Boolean);
}

function isUsefulTopic(title) {
  if (!title) return false;
  if (title.length < 6 || title.length > 80) return false;
  const blacklist = [
    "下载",
    "登录",
    "首页",
    "更多",
    "打开",
    "抖音",
    "知乎",
    "YouTube",
    "Bilibili",
    "广告",
    "服务条款",
    "隐私",
    "帮助中心",
    "创作者",
    "推荐",
    "视频",
    "直播",
    "频道"
  ];
  return !blacklist.includes(title);
}

function dedupeTopics(items) {
  const seen = new Set();
  return items.filter((item) => {
    const key = normalizeTopicTitle(item.title).toLowerCase();
    if (!key || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function collectByKey(value, targetKey, results = []) {
  if (!value) return results;
  if (Array.isArray(value)) {
    value.forEach((item) => collectByKey(item, targetKey, results));
    return results;
  }
  if (typeof value === "object") {
    Object.entries(value).forEach(([key, nested]) => {
      if (key === targetKey) results.push(nested);
      collectByKey(nested, targetKey, results);
    });
  }
  return results;
}

function extractBalancedJson(input, marker) {
  const markerIndex = input.indexOf(marker);
  if (markerIndex === -1) return null;
  const start = input.indexOf("{", markerIndex);
  if (start === -1) return null;

  let depth = 0;
  let inString = false;
  let escaped = false;

  for (let index = start; index < input.length; index += 1) {
    const char = input[index];
    if (inString) {
      if (escaped) {
        escaped = false;
      } else if (char === "\\") {
        escaped = true;
      } else if (char === '"') {
        inString = false;
      }
      continue;
    }

    if (char === '"') {
      inString = true;
      continue;
    }
    if (char === "{") depth += 1;
    if (char === "}") depth -= 1;
    if (depth === 0) return input.slice(start, index + 1);
  }

  return null;
}

async function fetchText(url, fetchImpl) {
  const response = await fetchImpl(url, { headers: DEFAULT_HEADERS });
  if (!response.ok) {
    throw new Error(`HTTP ${response.status}`);
  }
  return response.text();
}

async function fetchJson(url, fetchImpl) {
  const response = await fetchImpl(url, { headers: DEFAULT_HEADERS });
  if (!response.ok) {
    throw new Error(`HTTP ${response.status}`);
  }
  return response.json();
}

function buildTopic(source, index, title, url, meta) {
  return {
    id: `${source}_${Date.now()}_${index + 1}`,
    source,
    sourceLabel: SOURCE_LABELS[source] || source,
    rank: index + 1,
    title: normalizeTopicTitle(title),
    url,
    meta: normalizeText(meta || "")
  };
}

async function fetchBilibiliTopics(fetchImpl, limit) {
  const payload = await fetchJson("https://api.bilibili.com/x/web-interface/ranking/v2?rid=0&type=all", fetchImpl);
  const list = Array.isArray(payload?.data?.list) ? payload.data.list : [];
  const topics = list.slice(0, limit).map((item, index) =>
    buildTopic(
      "bilibili",
      index,
      item.title,
      item.short_link_v2 || item.short_link || `https://www.bilibili.com/video/${item.bvid}`,
      `${item.owner?.name || "UP 主"} · ${(item.stat?.view || 0).toLocaleString()} 播放`
    )
  );
  return {
    source: "bilibili",
    ok: topics.length > 0,
    count: topics.length,
    message: topics.length ? "已抓到 B 站排行榜" : "B 站榜单为空",
    topics
  };
}

function extractDouyinCandidateTitles(html, limit) {
  const rawMatches = [];
  const patterns = [
    /"desc":"((?:\\.|[^"\\]){6,160})"/g,
    /"title":"((?:\\.|[^"\\]){6,160})"/g,
    /"text":"((?:\\.|[^"\\]){6,160})"/g
  ];

  patterns.forEach((pattern) => {
    let match = pattern.exec(html);
    while (match) {
      rawMatches.push(normalizeTopicTitle(match[1]));
      match = pattern.exec(html);
    }
  });

  const visibleLines = extractVisibleLines(html).filter(isUsefulTopic);

  return dedupeTopics(
    [...rawMatches, ...visibleLines]
      .filter(isUsefulTopic)
      .slice(0, limit * 4)
      .map((title, index) => buildTopic("douyin", index, title, `https://www.douyin.com/search/${encodeURIComponent(title)}`, "抖音热度候选"))
  ).slice(0, limit);
}

async function fetchDouyinTopics(fetchImpl, limit) {
  let topics = [];
  try {
    const hotText = await fetchText(
      "https://www.douyin.com/aweme/v1/web/hot/search/list/?device_platform=webapp&aid=6383&channel=channel_pc_web&detail_list=1",
      fetchImpl
    );
    if (hotText.trim()) {
      const hotJson = JSON.parse(hotText);
      const words = dedupeTopics(
        collectByKey(hotJson, "word")
          .map((value, index) =>
            buildTopic("douyin", index, value, `https://www.douyin.com/search/${encodeURIComponent(normalizeTopicTitle(value))}`, "抖音热搜")
          )
          .filter((item) => isUsefulTopic(item.title))
      ).slice(0, limit);
      topics = words;
    }
  } catch (_error) {
    // fall through to page parsing
  }

  if (!topics.length) {
    const html = await fetchText("https://www.douyin.com/shipin/", fetchImpl);
    topics = extractDouyinCandidateTitles(html, limit);
  }

  return {
    source: "douyin",
    ok: topics.length > 0,
    count: topics.length,
    message: topics.length ? "已抓到抖音候选热点" : "抖音页面可访问，但没有解析出热点标题",
    topics
  };
}

function extractZhihuCandidateTitles(html, limit) {
  const visibleLines = extractVisibleLines(html)
    .filter((line) => isUsefulTopic(line) && !/^(知乎|热榜|想法|圆桌|提问|知乎热搜 - 知乎|没有更多了)$/.test(line));

  return dedupeTopics(
    visibleLines
      .slice(0, limit * 4)
      .map((title, index) => buildTopic("zhihu", index, title, `https://www.zhihu.com/search?type=content&q=${encodeURIComponent(title)}`, "知乎热榜候选"))
  ).slice(0, limit);
}

async function fetchZhihuTopics(fetchImpl, limit) {
  const html = await fetchText("https://www.zhihu.com/topsearch", fetchImpl);
  const topics = extractZhihuCandidateTitles(html, limit);
  return {
    source: "zhihu",
    ok: topics.length > 0,
    count: topics.length,
    message: topics.length ? "已抓到知乎候选热点" : "知乎返回页面，但没有解析出榜单",
    topics
  };
}

function extractYoutubeInitialData(html) {
  const patterns = [
    /var ytInitialData = (\{[\s\S]*?\});<\/script>/,
    /window\["ytInitialData"\] = (\{[\s\S]*?\});/
  ];

  for (const pattern of patterns) {
    const match = html.match(pattern);
    if (match) {
      try {
        return JSON.parse(match[1]);
      } catch (_error) {
        // ignore and continue
      }
    }
  }

  const balanced = extractBalancedJson(html, "ytInitialData");
  if (!balanced) return null;
  try {
    return JSON.parse(balanced);
  } catch (_error) {
    return null;
  }
}

async function fetchYoutubeTopics(fetchImpl, limit) {
  const html = await fetchText("https://www.youtube.com/feed/trending", fetchImpl);
  const initialData = extractYoutubeInitialData(html);
  const renderers = dedupeTopics(
    collectByKey(initialData, "videoRenderer")
      .map((renderer, index) => {
        const title = renderer?.title?.runs?.map((item) => item.text).join("") || renderer?.title?.simpleText || "";
        const videoId = renderer?.videoId || "";
        const channelName =
          renderer?.ownerText?.runs?.map((item) => item.text).join("") ||
          renderer?.shortBylineText?.runs?.map((item) => item.text).join("") ||
          "YouTube";
        return buildTopic(
          "youtube",
          index,
          title,
          videoId ? `https://www.youtube.com/watch?v=${videoId}` : "https://www.youtube.com/feed/trending",
          channelName
        );
      })
      .filter((item) => isUsefulTopic(item.title))
  ).slice(0, limit);

  return {
    source: "youtube",
    ok: renderers.length > 0,
    count: renderers.length,
    message: renderers.length ? "已抓到 YouTube trending" : "YouTube 匿名 trending 页面当前只返回搜索引导，没有可解析的视频标题",
    topics: renderers
  };
}

async function settleSource(source, fetcher) {
  try {
    return await fetcher();
  } catch (error) {
    return {
      source,
      ok: false,
      count: 0,
      message: error.message,
      topics: []
    };
  }
}

async function fetchTrendSnapshot(fetchImpl, settings) {
  const limit = Number(settings?.trends?.sourceLimit || 6);
  const results = await Promise.all([
    settleSource("douyin", () => fetchDouyinTopics(fetchImpl, limit)),
    settleSource("bilibili", () => fetchBilibiliTopics(fetchImpl, limit)),
    settleSource("zhihu", () => fetchZhihuTopics(fetchImpl, limit)),
    settleSource("youtube", () => fetchYoutubeTopics(fetchImpl, limit))
  ]);

  const sourceTopics = {};
  const sourceStatus = [];

  SOURCE_ORDER.forEach((source) => {
    const result = results.find((item) => item.source === source) || {
      source,
      ok: false,
      count: 0,
      message: "未执行",
      topics: []
    };
    sourceTopics[source] = result.topics;
    sourceStatus.push({
      source,
      sourceLabel: SOURCE_LABELS[source] || source,
      ok: result.ok,
      count: result.count,
      message: result.message
    });
  });

  const flatTopics = dedupeTopics(
    SOURCE_ORDER.flatMap((source) => sourceTopics[source] || []).filter((item) => isUsefulTopic(item.title))
  );

  return {
    createdAt: new Date().toISOString(),
    sourceStatus,
    sourceTopics,
    flatTopics
  };
}

function classifyTopic(title) {
  const categories = [
    { type: "sports", matches: /(比赛|冠军|球队|球员|奥运|足球|篮球|马拉松|世界杯)/ },
    { type: "tech", matches: /(AI|人工智能|机器人|手机|芯片|汽车|特斯拉|苹果|华为|小米|科技|模型)/i },
    { type: "society", matches: /(警方|官方|政策|高铁|学校|医院|社会|安全|司机|地震|天气|航班)/ },
    { type: "culture", matches: /(电影|电视剧|综艺|歌手|演唱会|演员|动漫|游戏|音乐|舞台)/ },
    { type: "lifestyle", matches: /(美食|旅游|穿搭|做饭|减肥|运动|宠物|家庭|日常|春天|樱花|露营)/ }
  ];
  return categories.find((item) => item.matches.test(title))?.type || "general";
}

function buildParentAngle(category) {
  const map = {
    sports: "可以顺带聊聊他们年轻时最爱看的比赛，或者最近有没有坚持运动。",
    tech: "适合问问他们对 AI、手机、汽车这些新变化的看法，让他们有参与感。",
    society: "可以从“你们那边有人聊这个吗”切入，听他们的现实观察。",
    culture: "适合问他们年轻时最爱看的电影、歌手或节目，话题很容易延展。",
    lifestyle: "可以延伸到吃饭、散步、旅游、朋友聚会这些轻松日常。",
    general: "先轻松复述热点，再问他们“你们怎么看”，不要一上来太严肃。"
  };
  return map[category];
}

function buildConversationStarter(title, category) {
  const prefix = {
    sports: "你们最近有刷到这个比赛吗？",
    tech: "你们会不会觉得现在这些新技术变化太快了？",
    society: "这件事你们那边有人在聊吗？",
    culture: "这个人/节目你们会不会也认识？",
    lifestyle: "这件事放到我们自己生活里，你们会怎么选？",
    general: "这个热点你们有刷到吗？"
  }[category];
  return `${prefix} 我刚看到“${title}”，第一反应就想听听你们的看法。`;
}

function buildFallbackScripts(flatTopics, settings) {
  const scriptCount = Number(settings?.trends?.scriptCount || 3);
  return flatTopics.slice(0, scriptCount).map((topic, index) => {
    const category = classifyTopic(topic.title);
    return {
      id: `fallback_${Date.now()}_${index + 1}`,
      title: topic.title,
      hotReason: `${topic.sourceLabel} 排名前列，这类题目既有新鲜感，也容易顺手问到父母自己的看法。`,
      hook: `今天我刷到一个挺火的：${topic.title}`,
      spokenScript: `今天四个平台里我最想先和你们聊的是“${topic.title}”。它现在在 ${topic.sourceLabel} 上热度很高，我看下来最大的感觉不是单纯热闹，而是它特别容易让人代入自己的生活和判断。我要是跟你们打电话，就会先用两三句把来龙去脉讲清楚，再顺手问一句“你们怎么看这件事”，这样话题就很自然地接起来了。`,
      conversationStarter: buildConversationStarter(topic.title, category),
      parentAngle: buildParentAngle(category),
      sourceMix: [topic.sourceLabel],
      sourceUrls: [topic.url]
    };
  });
}

function buildOpenAIInput(snapshot, settings) {
  const lines = [];
  snapshot.sourceStatus.forEach((item) => {
    lines.push(`${item.sourceLabel}: ${item.ok ? `成功抓到 ${item.count} 条` : `抓取失败（${item.message}）`}`);
    (snapshot.sourceTopics[item.source] || []).slice(0, 6).forEach((topic) => {
      lines.push(`- [${topic.sourceLabel} #${topic.rank}] ${topic.title}${topic.meta ? ` | ${topic.meta}` : ""}`);
    });
    lines.push("");
  });

  return [
    `用户画像：${settings.profile.name}，在 ${settings.profile.city} 工作，希望和在 ${settings.parents.hometown} 的父母聊热点新闻。`,
    "任务：从下面四个平台热点里，挑出 3 个最值得聊、最容易展开、同时适合转述给父母的话题。",
    "输出要求：返回严格 JSON，不要 markdown 代码块，不要解释。",
    `字段格式：{"summary":"一句总评","scripts":[{"title":"","hotReason":"","hook":"","spokenScript":"","conversationStarter":"","parentAngle":"","sourceMix":["抖音"],"sourceUrls":["https://..."]}]}`,
    "spokenScript 请写成抖音短视频口播文案，中文，120 到 180 字，口语化、有节奏、像真人在讲。",
    "conversationStarter 要像发给父母的开场白。",
    "parentAngle 要说明为什么这个点适合和父母聊。",
    "不要选过于血腥、色情、明显未核实谣言的话题；如果热点里存在争议，请用克制、中性方式转述。",
    "",
    ...lines
  ].join("\n");
}

function extractResponseText(payload) {
  if (typeof payload?.output_text === "string" && payload.output_text.trim()) return payload.output_text.trim();
  if (Array.isArray(payload?.output_text) && payload.output_text.length) {
    return payload.output_text.join("").trim();
  }
  const parts = [];
  (payload?.output || []).forEach((item) => {
    (item.content || []).forEach((content) => {
      if (typeof content?.text === "string") parts.push(content.text);
    });
  });
  return parts.join("\n").trim();
}

function extractJsonObject(rawText) {
  const start = rawText.indexOf("{");
  const end = rawText.lastIndexOf("}");
  if (start === -1 || end === -1 || end <= start) {
    throw new Error("模型返回里没有可解析的 JSON");
  }
  return JSON.parse(rawText.slice(start, end + 1));
}

async function generateScriptsWithOpenAI(fetchImpl, settings, snapshot, apiKey) {
  const model = settings?.openai?.model || "gpt-5.4";
  const reasoningEffort = settings?.openai?.reasoningEffort || "medium";
  const response = await fetchImpl("https://api.openai.com/v1/responses", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${apiKey}`
    },
    body: JSON.stringify({
      model,
      reasoning: { effort: reasoningEffort },
      input: [
        {
          role: "system",
          content: [
            {
              type: "input_text",
              text: "你是资深中文短视频文案策划，同时懂怎么把热点变成适合和父母聊的轻量开场。"
            }
          ]
        },
        {
          role: "user",
          content: [
            {
              type: "input_text",
              text: buildOpenAIInput(snapshot, settings)
            }
          ]
        }
      ],
      max_output_tokens: 2200
    })
  });

  if (!response.ok) {
    const detail = await response.text();
    throw new Error(`OpenAI 请求失败：HTTP ${response.status} ${detail}`);
  }

  const payload = await response.json();
  const rawText = extractResponseText(payload);
  const parsed = extractJsonObject(rawText);
  const scripts = Array.isArray(parsed?.scripts) ? parsed.scripts : [];

  return {
    ok: true,
    mode: "openai",
    model,
    message: "已用 OpenAI 生成 3 条口播文案",
    summary: normalizeText(parsed?.summary || ""),
    scripts: scripts.map((item, index) => ({
      id: `openai_${Date.now()}_${index + 1}`,
      title: normalizeTopicTitle(item.title),
      hotReason: normalizeText(item.hotReason || ""),
      hook: normalizeText(item.hook || ""),
      spokenScript: normalizeText(item.spokenScript || ""),
      conversationStarter: normalizeText(item.conversationStarter || ""),
      parentAngle: normalizeText(item.parentAngle || ""),
      sourceMix: Array.isArray(item.sourceMix) ? item.sourceMix.map((value) => normalizeText(value)) : [],
      sourceUrls: Array.isArray(item.sourceUrls) ? item.sourceUrls.map((value) => normalizeText(value)) : []
    }))
  };
}

async function generateTrendReport(fetchImpl, settings, options = {}) {
  const snapshot = await fetchTrendSnapshot(fetchImpl, settings);
  const trigger = options.trigger || "manual";
  const scriptCount = Number(settings?.trends?.scriptCount || 3);
  const apiKey = options.openAiApiKey || "";
  const noTopicsMessage = "这一轮没有从四个平台抓到可用标题，可能是源站限流或地区访问受限。";

  let ai;
  if (apiKey) {
    try {
      ai = await generateScriptsWithOpenAI(fetchImpl, settings, snapshot, apiKey);
      ai.scripts = ai.scripts.slice(0, scriptCount);
    } catch (error) {
      ai = {
        ok: false,
        mode: "fallback",
        model: settings?.openai?.model || "gpt-5.4",
        message: snapshot.flatTopics.length ? error.message : noTopicsMessage,
        summary: snapshot.flatTopics.length ? "OpenAI 暂时不可用，已退回模板生成。" : noTopicsMessage,
        scripts: buildFallbackScripts(snapshot.flatTopics, settings)
      };
    }
  } else {
    ai = {
      ok: false,
      mode: "fallback",
      model: settings?.openai?.model || "gpt-5.4",
      message: snapshot.flatTopics.length ? "未配置 OPENAI_API_KEY，已使用本地模板生成。" : noTopicsMessage,
      summary: snapshot.flatTopics.length ? "当前没有 OpenAI 密钥，先用本地模板保底生成可聊话题。" : noTopicsMessage,
      scripts: buildFallbackScripts(snapshot.flatTopics, settings)
    };
  }

  return {
    id: `trend_${Date.now()}`,
    createdAt: snapshot.createdAt,
    trigger,
    refreshHours: Number(settings?.trends?.refreshHours || 6),
    ai: {
      ok: ai.ok,
      mode: ai.mode,
      model: ai.model,
      message: ai.message
    },
    summary: ai.summary,
    sourceStatus: snapshot.sourceStatus,
    sourceTopics: snapshot.sourceTopics,
    scripts: ai.scripts,
    topicCount: snapshot.flatTopics.length
  };
}

function escapeMarkdown(value) {
  return String(value || "").replace(/([_*`\[])/g, "\\$1");
}

function buildTrendTelegramMessage(report) {
  const lines = [
    "*热点共聊更新*",
    `生成时间：${report.createdAt}`,
    `模式：${report.ai.mode === "openai" ? `${report.ai.model}` : "本地保底模板"}`,
    report.summary || "刚帮你整理了一轮新热点。",
    ""
  ];

  report.scripts.slice(0, 3).forEach((item, index) => {
    lines.push(`${index + 1}. ${escapeMarkdown(item.title)}`);
    lines.push(`开头：${escapeMarkdown(item.hook)}`);
    lines.push(`适合带爸妈聊：${escapeMarkdown(item.conversationStarter)}`);
    lines.push("");
  });

  return lines.join("\n");
}

module.exports = {
  SOURCE_LABELS,
  fetchTrendSnapshot,
  generateTrendReport,
  buildTrendTelegramMessage
};
