export const defaultSettings = {
  profile: {
    name: "在东京工作的你",
    city: "东京",
    timezone: "Asia/Tokyo",
    contactWindow: "20:00-22:00",
    notes: "工作日下班后容易累，希望低成本维持联系。"
  },
  parents: {
    hometown: "常州",
    fatherName: "爸爸",
    motherName: "妈妈",
    fatherContext: "半退休，有教学或上课安排",
    motherContext: "生活稳定，喜欢和朋友保持联系",
    interactionStyle: "轻松、自然、有参与感"
  },
  cadence: {
    dailyTouchpoint: true,
    deeperDays: ["Wednesday", "Sunday"],
    callDay: "Saturday",
    askForHelpEvery: 3
  },
  telegram: {
    enabled: false,
    mode: "mock",
    chatId: "",
    parseMode: "Markdown",
    autoTrendPush: false
  },
  trends: {
    refreshHours: 6,
    sourceLimit: 6,
    scriptCount: 3
  },
  openai: {
    model: "gpt-5.4",
    reasoningEffort: "medium"
  }
};

export const defaultHistory = [
  {
    id: "seed_1",
    date: "2026-03-28",
    mood: "good",
    channel: "text",
    summary: "聊了周末吃饭和东京天气，妈妈说最近和朋友出门散步了。",
    nextIdea: "下次可以问妈妈最近那道菜怎么做。"
  },
  {
    id: "seed_2",
    date: "2026-03-26",
    mood: "normal",
    channel: "voice",
    summary: "和爸爸语音了 8 分钟，聊到最近上课安排和作息。",
    nextIdea: "下次顺带问问最近肩膀有没有不舒服。"
  }
];
