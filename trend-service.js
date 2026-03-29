const SOURCE_ORDER = ["baidu", "weibo", "zhihu", "xiaohongshu", "sina", "ifeng", "cls"];

const SOURCE_LABELS = {
  baidu: "百度热搜",
  weibo: "微博热搜",
  zhihu: "知乎",
  xiaohongshu: "小红书",
  sina: "新浪新闻",
  ifeng: "凤凰网",
  cls: "财联社"
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
    .replace(/[|｜]\s*(抖音|知乎|B站|小红书).*$/i, "")
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
    "Bilibili",
    "小红书",
    "广告",
    "服务条款",
    "隐私",
    "帮助中心",
    "创作者",
    "推荐",
    "视频",
    "直播",
    "频道",
    "发现",
    "发布",
    "通知",
    "创作中心",
    "业务合作"
  ];
  return !blacklist.includes(title);
}

function isLikelyNewsHeadline(title) {
  if (!isUsefulTopic(title)) return false;
  if (/^(hao123|查看更多|点击查看更多实时热点|新闻中心首页_新浪网|将本页面保存为书签|您也可下载桌面快捷方式|启动Power on|36Kr创新咨询|VClub投资机构库)$/i.test(title)) return false;
  if (/^(今天|昨天|刚刚)\s*\d{1,2}:\d{2}/.test(title)) return false;
  if (/^\d{1,2}:\d{2}(:\d{2})?$/.test(title)) return false;
  if (/^\d{6,}$/.test(title)) return false;
  if (/^[\/\-\s]+$/.test(title)) return false;
  if (/^(CCTV|新华社|财联社|新浪|凤凰|微博|百度|知乎)(国际时讯)?$/.test(title)) return false;
  if (/(ICP备|公网安备|许可证|举报|下载|APP|广告合作|有害信息|营业执照|公司)/.test(title)) return false;
  const chineseChars = countChineseChars(title);
  if (chineseChars < 5) return false;
  return true;
}

function countChineseChars(value) {
  return (String(value || "").match(/[\u3400-\u9fff]/g) || []).length;
}

function isLikelyXiaohongshuHeadline(title) {
  if (!isUsefulTopic(title)) return false;
  if (/^(小红书\s*-\s*你的生活兴趣社区|HOME_FEED_LAYOUT_PLACEHOLDER)$/i.test(title)) return false;
  if (
    /(ICP备|公网安备|经营许可证|资格证书|举报电话|举报中心|举报专区|经营者信息|个性化推荐算法|有限公司|地址：|电话：|备案|医疗器械|增值电信业务|互联网药品信息服务)/.test(
      title
    )
  ) {
    return false;
  }
  if (/(大尺度|色情|成人视频)/i.test(title)) return false;

  const chineseChars = countChineseChars(title);
  const hasHeadlinePunctuation = /[，。！？!?~～…｜|：:（）()【】《》]/.test(title);
  const looksTooShortLikeUsername = !hasHeadlinePunctuation && title.length < 10 && chineseChars <= 6;
  const hasEnoughBody = title.length >= 10 || chineseChars >= 8;

  if (chineseChars < 4) return false;
  if (looksTooShortLikeUsername) return false;

  return hasHeadlinePunctuation || hasEnoughBody;
}

const PUBLIC_BUCKETS = [
  { key: "politics", label: "时政" },
  { key: "military", label: "军事" },
  { key: "economy", label: "经济" },
  { key: "society", label: "社会" }
];

const EXCLUDED_TOPIC_PATTERNS = [
  /(明星|娱[乐樂]|综艺|偶像|饭圈|粉丝|演唱会|剧组|恋情|离婚|婚礼|塌房|出轨|流量|网红|博主|直播间|直播带货)/i,
  /(擦边|大尺度|性感|私密|约会|撩人|颜值|美妆|妆容|穿搭|ootd|减肥|瘦身|塑形|探店|种草|开箱|测评|好物|教程|同款)/i,
  /(广告|推广|上新|限时|折扣|优惠|品牌|购买|下单|旗舰店|门店|套餐|券后|报名|训练营|私教|酒店|民宿|旅拍|写真)/i,
  /(拍照|写真|发型|美甲|护肤|口红|香水|健身打卡|恋爱脑|脱单|cp|男友|女友|桃花|追星|影视|票房|新剧|首映)/i,
  /(打工人|年薪\d+万|工资条|银行狗|遇不到|恋爱故事|相亲|上岸日记|我的offer|转行日记|职场逆袭|景琛)/i
];

function shouldExcludeTopic(title) {
  return EXCLUDED_TOPIC_PATTERNS.some((pattern) => pattern.test(title));
}

function classifyPublicTopic(title) {
  const bucketMatchers = [
    {
      key: "military",
      matches:
        /(军方|军队|部队|海军|空军|陆军|火箭军|导弹|战机|军演|防务|国防|舰艇|航母|战舰|袭击|冲突|停火|战争|无人机|兵棋|北约|军售)/i
    },
    {
      key: "politics",
      matches:
        /(中共中央|国务院|外交部|国常会|总书记|主席|总理|人大|政协|审议|政策|新规|方案|条例|通报|发布会|部长|副总理|地方政府|两会|民生工程|反腐|外交|领事)/i
    },
    {
      key: "economy",
      matches:
        /(经济|金融|股市|楼市|房价|汇率|利率|关税|出口|外贸|制造业|消费|财政|税收|投资|产业链|供应链|通胀|银行|券商|基金|人民币|黄金|油价|电商|企业|财报|就业|工资|内存条|芯片|新能源|车企|平台经济)/i
    },
    {
      key: "society",
      matches:
        /(社会|民生|教育|医疗|医保|养老|交通|地震|暴雨|台风|洪水|火灾|事故|救援|高考|学校|医院|治安|法院|检察院|警方|地铁|铁路|高速|食品安全|大熊猫|文旅|景区|社区|基层|结婚登记|居民|用电|用水)/i
    }
  ];
  return bucketMatchers.find((item) => item.matches.test(title))?.key || null;
}

function filterTopicItems(items) {
  return dedupeTopics(
    items.filter((item) => {
      const title = item?.title || "";
      return isUsefulTopic(title) && !shouldExcludeTopic(title) && Boolean(classifyPublicTopic(title));
    })
  );
}

function buildTopicBuckets(items) {
  const buckets = Object.fromEntries(PUBLIC_BUCKETS.map((bucket) => [bucket.key, []]));
  items.forEach((item) => {
    const bucketKey = classifyPublicTopic(item.title);
    if (!bucketKey) return;
    buckets[bucketKey].push({
      ...item,
      bucketKey,
      bucketLabel: PUBLIC_BUCKETS.find((bucket) => bucket.key === bucketKey)?.label || bucketKey
    });
  });
  return buckets;
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

function buildTopic(source, index, title, url) {
  return {
    id: `${source}_${Date.now()}_${index + 1}`,
    source,
    sourceLabel: SOURCE_LABELS[source] || source,
    rank: index + 1,
    title: normalizeTopicTitle(title),
    url
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
      item.short_link_v2 || item.short_link || `https://www.bilibili.com/video/${item.bvid}`
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

async function fetchBaiduTopics(fetchImpl, limit) {
  const html = await fetchText("https://top.baidu.com/board?tab=realtime", fetchImpl);
  const visibleLines = extractVisibleLines(html).filter((line) => {
    if (!isLikelyNewsHeadline(line)) return false;
    if (/^\/\s*全部类型/.test(line)) return false;
    if (line.length > 28 && /[，。,]|习近平总书记|面对新形势|真抓实干|务实功/.test(line)) return false;
    return true;
  });

  const topics = dedupeTopics(
    visibleLines
      .slice(0, limit * 4)
      .map((title, index) => buildTopic("baidu", index, title, `https://www.baidu.com/s?wd=${encodeURIComponent(title)}`))
  ).slice(0, limit);

  return {
    source: "baidu",
    ok: topics.length > 0,
    count: topics.length,
    message: topics.length ? "已抓到百度热搜标题" : "百度热搜页面可访问，但没有解析出标题",
    topics
  };
}

async function fetchWeiboTopics(fetchImpl, limit) {
  const payload = await fetchJson("https://v1.nsuuu.com/api/weibohot", fetchImpl);
  const list = Array.isArray(payload?.data) ? payload.data : [];
  const topics = list
    .map((item, index) => buildTopic("weibo", index, item.title, item.url || `https://s.weibo.com/weibo?q=${encodeURIComponent(item.title)}`))
    .filter((item) => isLikelyNewsHeadline(item.title))
    .slice(0, limit);

  return {
    source: "weibo",
    ok: topics.length > 0,
    count: topics.length,
    message: topics.length ? "已抓到微博热搜标题" : "微博热搜接口可访问，但没有解析出标题",
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
      .map((title, index) => buildTopic("douyin", index, title, `https://www.douyin.com/search/${encodeURIComponent(title)}`))
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
            buildTopic("douyin", index, value, `https://www.douyin.com/search/${encodeURIComponent(normalizeTopicTitle(value))}`)
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
      .map((title, index) => buildTopic("zhihu", index, title, `https://www.zhihu.com/search?type=content&q=${encodeURIComponent(title)}`))
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

function extractSinaCandidateTitles(html, limit) {
  const visibleLines = extractVisibleLines(html).filter((line) => {
    if (!isLikelyNewsHeadline(line)) return false;
    if (/^(点击查看更多实时热点|新闻中心首页_新浪网|将本页面保存为书签)/.test(line)) return false;
    if (/客户端$/.test(line)) return false;
    return true;
  });

  return dedupeTopics(
    visibleLines
      .slice(0, limit * 5)
      .map((title, index) => buildTopic("sina", index, title, `https://search.sina.com.cn/?q=${encodeURIComponent(title)}`))
  ).slice(0, limit);
}

async function fetchSinaTopics(fetchImpl, limit) {
  const html = await fetchText("https://news.sina.com.cn/", fetchImpl);
  const topics = extractSinaCandidateTitles(html, limit);
  return {
    source: "sina",
    ok: topics.length > 0,
    count: topics.length,
    message: topics.length ? "已抓到新浪新闻热标题" : "新浪新闻页面可访问，但没有解析出标题",
    topics
  };
}

function extractIfengCandidateTitles(html, limit) {
  const visibleLines = extractVisibleLines(html).filter((line) => {
    if (!isLikelyNewsHeadline(line)) return false;
    if (/^(今天|昨天)/.test(line)) return false;
    if (/^(资讯_凤凰网|有中华酒就有年味)/.test(line)) return false;
    return true;
  });

  return dedupeTopics(
    visibleLines
      .slice(0, limit * 5)
      .map((title, index) => buildTopic("ifeng", index, title, `https://search.ifeng.com/sofeng/search.action?q=${encodeURIComponent(title)}`))
  ).slice(0, limit);
}

async function fetchIfengTopics(fetchImpl, limit) {
  const html = await fetchText("https://news.ifeng.com/", fetchImpl);
  const topics = extractIfengCandidateTitles(html, limit);
  return {
    source: "ifeng",
    ok: topics.length > 0,
    count: topics.length,
    message: topics.length ? "已抓到凤凰网热标题" : "凤凰网页面可访问，但没有解析出标题",
    topics
  };
}

function extractClsCandidateTitles(html, limit) {
  const visibleLines = extractVisibleLines(html).filter((line) => {
    if (!isLikelyNewsHeadline(line)) return false;
    if (/^(财联社A股24小时电报|解锁直达)/.test(line)) return false;
    if (/^电报持续更新中$/.test(line)) return false;
    if (/^[、，,]/.test(line)) return false;
    return true;
  });

  return dedupeTopics(
    visibleLines
      .slice(0, limit * 5)
      .map((title, index) => buildTopic("cls", index, title.replace(/^【|】$/g, ""), `https://www.cls.cn/searchPage?keyword=${encodeURIComponent(title)}`))
  ).slice(0, limit);
}

async function fetchClsTopics(fetchImpl, limit) {
  const html = await fetchText("https://www.cls.cn/telegraph", fetchImpl);
  const topics = extractClsCandidateTitles(html, limit);
  return {
    source: "cls",
    ok: topics.length > 0,
    count: topics.length,
    message: topics.length ? "已抓到财联社电报热点" : "财联社页面可访问，但没有解析出标题",
    topics
  };
}

function extractXiaohongshuCandidateTitles(html, limit) {
  const visibleLines = extractVisibleLines(html).filter((line) => {
    if (/^(小红书|推荐|穿搭|美食|彩妆|影视|职场|情感|家居|游戏|旅行|健身)$/.test(line)) return false;
    if (/^(\d+(\.\d+)?万?|[\d.]+w)$/i.test(line)) return false;
    return isLikelyXiaohongshuHeadline(line);
  });

  return dedupeTopics(
    visibleLines
      .slice(0, limit * 6)
      .map((title, index) =>
        buildTopic("xiaohongshu", index, title, `https://www.xiaohongshu.com/search_result?keyword=${encodeURIComponent(title)}`)
      )
  ).slice(0, limit);
}

async function fetchXiaohongshuTopics(fetchImpl, limit) {
  const html = await fetchText("https://www.xiaohongshu.com/explore", fetchImpl);
  const topics = extractXiaohongshuCandidateTitles(html, limit);
  return {
    source: "xiaohongshu",
    ok: topics.length > 0,
    count: topics.length,
    message: topics.length ? "已抓到小红书首页热门标题" : "小红书页面可访问，但没有解析出可用标题",
    topics
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
    settleSource("baidu", () => fetchBaiduTopics(fetchImpl, limit)),
    settleSource("weibo", () => fetchWeiboTopics(fetchImpl, limit)),
    settleSource("zhihu", () => fetchZhihuTopics(fetchImpl, limit)),
    settleSource("xiaohongshu", () => fetchXiaohongshuTopics(fetchImpl, limit)),
    settleSource("sina", () => fetchSinaTopics(fetchImpl, limit)),
    settleSource("ifeng", () => fetchIfengTopics(fetchImpl, limit)),
    settleSource("cls", () => fetchClsTopics(fetchImpl, limit))
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
    const filteredTopics = filterTopicItems(result.topics || []);
    const filteredAll = !filteredTopics.length && (result.topics || []).length > 0;
    sourceTopics[source] = filteredTopics;
    sourceStatus.push({
      source,
      sourceLabel: SOURCE_LABELS[source] || source,
      ok: filteredTopics.length > 0,
      count: filteredTopics.length,
      message: filteredAll ? "已过滤为娱乐八卦、擦边或广告感内容" : result.message
    });
  });

  const flatTopics = filterTopicItems(SOURCE_ORDER.flatMap((source) => sourceTopics[source] || []));
  const topicBuckets = buildTopicBuckets(flatTopics);

  return {
    createdAt: new Date().toISOString(),
    sourceStatus,
    sourceTopics,
    flatTopics,
    topicBuckets,
    allowedBuckets: PUBLIC_BUCKETS
  };
}

function classifyTopic(title) {
  return classifyPublicTopic(title) || "society";
}

function buildParentAngle(category) {
  const map = {
    politics: "可以多聊政策变化怎么影响普通人生活，也适合顺带问问爸妈对这类大事怎么看。",
    military: "可以从国家安全、国际局势切入，聊聊长辈平时最关注的军情和世界变化。",
    economy: "可以把重点放在物价、就业、收入、消费这些爸妈更有感的现实问题上。",
    society: "适合从民生、教育、医疗、交通、安全这些身边话题切入，更容易自然接住。",
    general: "先轻松复述热点，再问他们“你们怎么看”，不要一上来太严肃。"
  };
  return map[category];
}

function buildConversationStarter(title, category) {
  const prefix = {
    politics: "我刚看到一条时政热点，第一反应就想和你们聊聊：",
    military: "今天刷到一条军事新闻，我觉得你们可能也会关心：",
    economy: "今天看到一条经济热点，感觉和普通人的日子挺相关：",
    society: "我刚看到一条社会热点，挺适合咱们聊两句：",
    general: "这个热点你们有刷到吗？"
  }[category];
  return `${prefix}${title}`;
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
      spokenScript: `今天中文互联网里我最想先和你们聊的是“${topic.title}”。它现在在 ${topic.sourceLabel} 上热度很高，我看下来最大的感觉不是单纯热闹，而是它特别容易让人代入自己的生活和判断。我要是跟你们打电话，就会先用两三句把来龙去脉讲清楚，再顺手问一句“你们怎么看这件事”，这样话题就很自然地接起来了。`,
      conversationStarter: buildConversationStarter(topic.title, category),
      parentAngle: buildParentAngle(category),
      sourceMix: [topic.sourceLabel],
      sourceUrls: [topic.url]
    };
  });
}

function getAiProviderLabel(provider) {
  return provider === "google" ? "Google Gemma" : provider === "openai" ? "OpenAI" : "AI";
}

function resolveAiOptions(settings, options = {}) {
  const configured = settings?.openai || {};
  const provider = options.provider || configured.provider || "google";
  let model = options.model || configured.model || "";

  if (provider === "google" && (!model || /^gpt-/i.test(model))) {
    model = "gemma-3-27b-it";
  }
  if (provider === "openai" && (!model || /^gemma/i.test(model))) {
    model = "gpt-5.4";
  }

  return {
    provider,
    providerLabel: getAiProviderLabel(provider),
    model,
    reasoningEffort: options.reasoningEffort || configured.reasoningEffort || "medium",
    googleApiKey: options.googleApiKey || "",
    openAiApiKey: options.openAiApiKey || options.apiKey || ""
  };
}

function buildAiInput(snapshot, settings) {
  const lines = [];
  snapshot.sourceStatus.forEach((item) => {
    lines.push(`${item.sourceLabel}: ${item.ok ? `成功抓到 ${item.count} 条` : `抓取失败（${item.message}）`}`);
    (snapshot.sourceTopics[item.source] || []).slice(0, 6).forEach((topic) => {
      lines.push(`- [${topic.sourceLabel} #${topic.rank}] ${topic.title}`);
    });
    lines.push("");
  });

  lines.push("分桶后的可聊热点：");
  (snapshot.allowedBuckets || []).forEach((bucket) => {
    const items = snapshot.topicBuckets?.[bucket.key] || [];
    lines.push(`${bucket.label}: ${items.length ? `${items.length} 条` : "0 条"}`);
    items.slice(0, 6).forEach((topic) => {
      lines.push(`- [${bucket.label}] ${topic.title}`);
    });
    lines.push("");
  });

  return [
    `用户画像：${settings.profile.name}，在 ${settings.profile.city} 工作，希望和在 ${settings.parents.hometown} 的父母聊热点新闻。`,
    "任务：从下面这些中文互联网热点里，挑出 3 个最值得聊、最容易展开、同时适合转述给父母的话题。",
    "输出要求：返回严格 JSON，不要 markdown 代码块，不要解释。",
    `字段格式：{"summary":"一句总评","scripts":[{"title":"","hotReason":"","hook":"","spokenScript":"","conversationStarter":"","parentAngle":"","sourceMix":["抖音"],"sourceUrls":["https://..."]}]}`,
    "spokenScript 请写成抖音短视频口播文案，中文，120 到 180 字，口语化、有节奏、像真人在讲。",
    "conversationStarter 要像发给父母的开场白。",
    "parentAngle 要说明为什么这个点适合和父母聊。",
    "只从时政、军事、经济、社会四个分桶里选题，自动避开娱乐八卦、擦边和广告感内容。",
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

function extractGeminiText(payload) {
  const parts = [];
  (payload?.candidates || []).forEach((candidate) => {
    (candidate?.content?.parts || []).forEach((part) => {
      if (typeof part?.text === "string") parts.push(part.text);
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

function buildInterpretationPrompt(topic, settings) {
  return [
    `用户在 ${settings.profile.city} 工作，想把热点转述给在 ${settings.parents.hometown} 的父母。`,
    "请对下面这个中文热点做实时智能解读，语气克制、易懂、适合家庭聊天。",
    "你只能依据我给你的标题、来源和链接文本本身进行审慎解读，不能调用外部记忆补充事实，不能把它联想成另一条新闻。",
    "返回严格 JSON，不要 markdown 代码块，不要额外解释。",
    '字段格式：{"summary":"","whyHot":"","talkingPoints":["","",""],"familyAngle":"","riskNote":""}',
    "summary 用 80 到 140 字概括这条标题大概在说什么；如果信息不足，请明确写“仅从标题判断”。",
    "whyHot 说明为什么它现在值得关注，也只能基于标题判断。",
    "talkingPoints 给 3 条简洁切口，每条 18 到 40 字。",
    "familyAngle 说明怎么把它聊给父母听，务必自然。",
    "riskNote 说明这条内容是否可能有标题党、信息不完整或仍在发展中，保持中性。",
    "不要夸张，不要写成营销文案，不要编造细节，不要出现标题里没有的人名、地名、机构或事件。",
    `标题：${topic.title}`,
    `来源：${topic.sourceLabel || topic.source || "中文互联网"}`,
    `链接：${topic.url || "无"}`
  ].join("\n");
}

function extractTopicKeywords(title) {
  return Array.from(
    new Set(
      (String(title || "").match(/[\u4e00-\u9fffA-Za-z0-9]{2,}/g) || []).filter(
        (item) => item.length >= 2 && !/^(今天|最近|这个|那个|新闻|热点|标题|出现|进行|有关|一个|什么)$/.test(item)
      )
    )
  ).slice(0, 6);
}

function validateInterpretation(topic, payload) {
  const haystack = [payload.summary, payload.whyHot, payload.familyAngle, payload.riskNote, ...(payload.talkingPoints || [])].join(" ");
  if (haystack.includes(topic.title)) return true;
  const keywords = extractTopicKeywords(topic.title);
  if (!keywords.length) return true;
  return keywords.filter((keyword) => haystack.includes(keyword)).length >= 2;
}

function buildFallbackInterpretation(topic) {
  const bucket = classifyPublicTopic(topic.title);
  const bucketLabel = PUBLIC_BUCKETS.find((item) => item.key === bucket)?.label || "公共议题";
  return {
    ok: false,
    mode: "fallback",
    provider: "fallback",
    providerLabel: "本地保底",
    model: "fallback",
    summary: `这条热点大概率属于${bucketLabel}方向，目前系统先根据标题做保守解读，适合先当作聊天引子。`,
    whyHot: "它能进入当前热点池，说明这件事在中文互联网里有一定讨论度，而且和公共生活有连接。",
    talkingPoints: [
      `先问爸妈有没有刷到“${topic.title}”`,
      "再用一两句复述标题，不急着下判断",
      "最后顺带问这事会不会影响普通人生活"
    ],
    familyAngle: "先轻松复述，再问他们怎么看，不需要一上来讲很深。",
    riskNote: "当前是按标题做的保底解读，细节可能仍在发展，最好点原文再确认。",
    message: "已使用本地模板保底解读"
  };
}

async function generateInterpretationWithOpenAI(fetchImpl, settings, topic, apiKey) {
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
          role: "user",
          content: [{ type: "input_text", text: buildInterpretationPrompt(topic, settings) }]
        }
      ],
      max_output_tokens: 1200
    })
  });

  if (!response.ok) {
    const detail = await response.text();
    throw new Error(`OpenAI 请求失败：HTTP ${response.status} ${detail}`);
  }

  const payload = await response.json();
  const parsed = extractJsonObject(extractResponseText(payload));
  if (!validateInterpretation(topic, parsed)) {
    throw new Error("AI 解读与标题不一致，已改用保守模式");
  }
  return {
    ok: true,
    mode: "openai",
    provider: "openai",
    providerLabel: "OpenAI",
    model,
    summary: normalizeText(parsed?.summary || ""),
    whyHot: normalizeText(parsed?.whyHot || ""),
    talkingPoints: Array.isArray(parsed?.talkingPoints) ? parsed.talkingPoints.map((item) => normalizeText(item)).filter(Boolean) : [],
    familyAngle: normalizeText(parsed?.familyAngle || ""),
    riskNote: normalizeText(parsed?.riskNote || ""),
    message: "已用 OpenAI 生成实时解读"
  };
}

async function generateInterpretationWithGoogleGemma(fetchImpl, settings, topic, apiKey, model) {
  const response = await fetchImpl(
    `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`,
    {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-goog-api-key": apiKey
      },
      body: JSON.stringify({
        contents: [
          {
            parts: [{ text: buildInterpretationPrompt(topic, settings) }]
          }
        ],
        generationConfig: {
          maxOutputTokens: 1200
        }
      })
    }
  );

  if (!response.ok) {
    const detail = await response.text();
    throw new Error(`Google Gemma 请求失败：HTTP ${response.status} ${detail}`);
  }

  const payload = await response.json();
  const rawText = extractGeminiText(payload);
  if (!rawText) {
    throw new Error("Google Gemma 没有返回可解析内容");
  }
  const parsed = extractJsonObject(rawText);
  if (!validateInterpretation(topic, parsed)) {
    throw new Error("AI 解读与标题不一致，已改用保守模式");
  }
  return {
    ok: true,
    mode: "google",
    provider: "google",
    providerLabel: "Google Gemma",
    model,
    summary: normalizeText(parsed?.summary || ""),
    whyHot: normalizeText(parsed?.whyHot || ""),
    talkingPoints: Array.isArray(parsed?.talkingPoints) ? parsed.talkingPoints.map((item) => normalizeText(item)).filter(Boolean) : [],
    familyAngle: normalizeText(parsed?.familyAngle || ""),
    riskNote: normalizeText(parsed?.riskNote || ""),
    message: "已用 Google Gemma 生成实时解读"
  };
}

async function interpretTopic(fetchImpl, settings, topic, options = {}) {
  const aiOptions = resolveAiOptions(settings, options.aiConfig || {});
  const normalizedTopic = {
    title: normalizeTopicTitle(topic?.title || ""),
    source: normalizeText(topic?.source || ""),
    sourceLabel: normalizeText(topic?.sourceLabel || topic?.source || ""),
    url: normalizeText(topic?.url || "")
  };

  if (!normalizedTopic.title) {
    throw new Error("缺少标题，无法解读");
  }

  try {
    if (aiOptions.provider === "google" && aiOptions.googleApiKey) {
      return await generateInterpretationWithGoogleGemma(fetchImpl, settings, normalizedTopic, aiOptions.googleApiKey, aiOptions.model);
    }
    if (aiOptions.provider === "openai" && aiOptions.openAiApiKey) {
      return await generateInterpretationWithOpenAI(fetchImpl, settings, normalizedTopic, aiOptions.openAiApiKey);
    }
    const fallback = buildFallbackInterpretation(normalizedTopic);
    fallback.message = aiOptions.provider === "google" ? "未配置 GOOGLE_API_KEY，已使用本地模板保底解读" : "未配置 OPENAI_API_KEY，已使用本地模板保底解读";
    return fallback;
  } catch (error) {
    const fallback = buildFallbackInterpretation(normalizedTopic);
    fallback.message = error.message || fallback.message;
    return fallback;
  }
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
              text: buildAiInput(snapshot, settings)
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

async function generateScriptsWithGoogleGemma(fetchImpl, settings, snapshot, apiKey, model) {
  const response = await fetchImpl(
    `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`,
    {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-goog-api-key": apiKey
      },
      body: JSON.stringify({
        contents: [
          {
            parts: [
              {
                text: [
                  "你是资深中文短视频文案策划，同时懂怎么把热点变成适合和父母聊的轻量开场。",
                  "",
                  buildAiInput(snapshot, settings)
                ].join("\n")
              }
            ]
          }
        ],
        generationConfig: {
          maxOutputTokens: 2200
        }
      })
    }
  );

  if (!response.ok) {
    const detail = await response.text();
    throw new Error(`Google Gemma 请求失败：HTTP ${response.status} ${detail}`);
  }

  const payload = await response.json();
  const rawText = extractGeminiText(payload);
  if (!rawText) {
    const reason = payload?.promptFeedback?.blockReason || payload?.candidates?.[0]?.finishReason || "模型没有返回文本";
    throw new Error(`Google Gemma 请求失败：${reason}`);
  }

  const parsed = extractJsonObject(rawText);
  const scripts = Array.isArray(parsed?.scripts) ? parsed.scripts : [];

  return {
    ok: true,
    mode: "google",
    provider: "google",
    providerLabel: "Google Gemma",
    model,
    message: "已用 Google Gemma 3 27B 生成 3 条口播文案",
    summary: normalizeText(parsed?.summary || ""),
    scripts: scripts.map((item, index) => ({
      id: `google_${Date.now()}_${index + 1}`,
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
  const aiOptions = resolveAiOptions(settings, options.aiConfig || {});
  const noTopicsMessage = "这一轮没有从中文互联网热榜池抓到可用标题，可能是源站限流或地区访问受限。";

  let ai;
  if (aiOptions.provider === "google") {
    if (aiOptions.googleApiKey) {
      try {
        ai = await generateScriptsWithGoogleGemma(fetchImpl, settings, snapshot, aiOptions.googleApiKey, aiOptions.model);
        ai.scripts = ai.scripts.slice(0, scriptCount);
      } catch (error) {
        ai = {
          ok: false,
          mode: "fallback",
          provider: aiOptions.provider,
          providerLabel: aiOptions.providerLabel,
          model: aiOptions.model,
          message: snapshot.flatTopics.length ? error.message : noTopicsMessage,
          summary: snapshot.flatTopics.length ? "Google Gemma 暂时不可用，已退回模板生成。" : noTopicsMessage,
          scripts: buildFallbackScripts(snapshot.flatTopics, settings)
        };
      }
    } else {
      ai = {
        ok: false,
        mode: "fallback",
        provider: aiOptions.provider,
        providerLabel: aiOptions.providerLabel,
        model: aiOptions.model,
        message: snapshot.flatTopics.length ? "未配置 GOOGLE_API_KEY，已使用本地模板生成。" : noTopicsMessage,
        summary: snapshot.flatTopics.length ? "当前没有 Google AI 密钥，先用本地模板保底生成可聊话题。" : noTopicsMessage,
        scripts: buildFallbackScripts(snapshot.flatTopics, settings)
      };
    }
  } else if (aiOptions.provider === "openai") {
    if (aiOptions.openAiApiKey) {
      try {
        ai = await generateScriptsWithOpenAI(
          fetchImpl,
          {
            ...settings,
            openai: {
              ...(settings.openai || {}),
              model: aiOptions.model,
              reasoningEffort: aiOptions.reasoningEffort
            }
          },
          snapshot,
          aiOptions.openAiApiKey
        );
        ai.provider = aiOptions.provider;
        ai.providerLabel = aiOptions.providerLabel;
        ai.scripts = ai.scripts.slice(0, scriptCount);
      } catch (error) {
        ai = {
          ok: false,
          mode: "fallback",
          provider: aiOptions.provider,
          providerLabel: aiOptions.providerLabel,
          model: aiOptions.model,
          message: snapshot.flatTopics.length ? error.message : noTopicsMessage,
          summary: snapshot.flatTopics.length ? "OpenAI 暂时不可用，已退回模板生成。" : noTopicsMessage,
          scripts: buildFallbackScripts(snapshot.flatTopics, settings)
        };
      }
    } else {
      ai = {
        ok: false,
        mode: "fallback",
        provider: aiOptions.provider,
        providerLabel: aiOptions.providerLabel,
        model: aiOptions.model,
        message: snapshot.flatTopics.length ? "未配置 OPENAI_API_KEY，已使用本地模板生成。" : noTopicsMessage,
        summary: snapshot.flatTopics.length ? "当前没有 OpenAI 密钥，先用本地模板保底生成可聊话题。" : noTopicsMessage,
        scripts: buildFallbackScripts(snapshot.flatTopics, settings)
      };
    }
  } else {
    ai = {
      ok: false,
      mode: "fallback",
      provider: aiOptions.provider,
      providerLabel: aiOptions.providerLabel,
      model: aiOptions.model,
      message: snapshot.flatTopics.length ? `暂不支持的 AI 提供方：${aiOptions.provider}` : noTopicsMessage,
      summary: snapshot.flatTopics.length ? "当前 AI 提供方不可用，已退回模板生成。" : noTopicsMessage,
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
      provider: ai.provider || aiOptions.provider,
      providerLabel: ai.providerLabel || aiOptions.providerLabel,
      model: ai.model,
      message: ai.message
    },
    summary: ai.summary,
    sourceStatus: snapshot.sourceStatus,
    sourceTopics: snapshot.sourceTopics,
    topicBuckets: snapshot.topicBuckets,
    allowedBuckets: snapshot.allowedBuckets,
    scripts: ai.scripts,
    topicCount: snapshot.flatTopics.length,
    bucketCount: Object.values(snapshot.topicBuckets || {}).reduce((sum, items) => sum + (items.length ? 1 : 0), 0)
  };
}

function escapeMarkdown(value) {
  return String(value || "").replace(/([_*`\[])/g, "\\$1");
}

function buildTrendTelegramMessage(report) {
  const lines = [
    "*热点共聊更新*",
    `生成时间：${report.createdAt}`,
    `模式：${report.ai.mode !== "fallback" ? `${report.ai.providerLabel || "AI"} / ${report.ai.model}` : "本地保底模板"}`,
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
  buildTrendTelegramMessage,
  interpretTopic
};
