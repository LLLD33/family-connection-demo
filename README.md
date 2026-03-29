# 亲情热点陪聊助手

一个可本地运行、也可部署到 Cloudflare 的 Web demo。

它会做三件事：

- 聚合最新抖音、B 站、知乎、小红书标题热点
- 默认用 Google Gemma 3 27B 生成 3 条适合和父母聊的短视频口播文案
- 记录每一轮生成历史，并支持 Telegram 推送摘要

## 当前能力

- 亲情联系节奏建议、联系记录、发送日志
- 热点抓取接口：`/api/trends/refresh`
- 热点摘要 Telegram 推送：`/api/trends/push`
- 本地 JSON 存储，Cloudflare 线上使用 KV
- Cloudflare 定时任务默认每 6 小时刷新一轮热点

## 本地启动

```bash
node server.js
```

打开 [http://127.0.0.1:3000](http://127.0.0.1:3000)

## 环境变量

### Telegram

默认是 `mock` 模式，不会真的发消息。

本地：

```bash
set TELEGRAM_BOT_TOKEN=你的_bot_token
node server.js
```

Cloudflare：

```bash
npx wrangler secret put TELEGRAM_BOT_TOKEN
```

### Google Gemma 3 27B

热点文案生成默认接 Google Gemini API 托管的 `gemma-3-27b-it`。

本地：

```bash
set GOOGLE_API_KEY=你的_google_ai_studio_key
node server.js
```

Cloudflare：

```bash
npx wrangler secret put GOOGLE_API_KEY
```

如果没有配置 `GOOGLE_API_KEY`，系统会退回本地模板保底生成，方便先跑通流程。

### OpenAI（可选兼容）

如果你想切回 OpenAI，也可以把设置页里的 AI 提供方改成 `openai`，再配置：

```bash
set OPENAI_API_KEY=你的_openai_api_key
node server.js
```

Cloudflare：

```bash
npx wrangler secret put OPENAI_API_KEY
```

## 主要接口

- `GET /api/dashboard`
- `POST /api/history`
- `POST /api/telegram/test`
- `POST /api/trends/refresh`
- `POST /api/trends/push`
- `POST /api/cron/daily`
- `POST /api/cron/trends`

## Cloudflare 部署

- `src/worker.js`: Worker API
- `src/trend-service.js`: 热点抓取与 AI 文案生成
- `public/`: 静态页面
- `wrangler.toml`: Worker 配置

常用命令：

```bash
npx wrangler login
npx wrangler deploy
```

当前定时策略：

- 每 6 小时刷新一次热点
- 是否自动把热点摘要推到 Telegram，由页面设置里的 `telegram.autoTrendPush` 控制

## 数据文件

- `data/settings.json`
- `data/history.json`
- `data/delivery-log.json`
- `data/trend-reports.json`

## 说明

- 当前四个平台统一只抓标题，不抓正文内容，目的是更稳地生成“和父母聊什么”
- 抖音、知乎、小红书都属于强反爬平台，所以实现采用“能抓则抓，抓不到就优雅降级”的策略
- 真实线上效果取决于源站访问情况、地区限制以及 Google AI / OpenAI / Telegram 密钥是否已配置
