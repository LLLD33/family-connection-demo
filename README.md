# 亲情联系助手 Demo

一个可本地运行、也可部署到 Cloudflare 的 Web demo，用来验证“异地子女低成本维持和父母稳定联系”的产品方向。

## 功能

- 每天生成一次联系建议和可直接发送的话术
- 支持保存联系记录，形成后续话题记忆
- 提供“反向索取”节奏，避免只会机械关心
- 支持 Telegram Bot 推送
- 本地 JSON 存储，Cloudflare 线上使用 KV

## 本地启动

```bash
node server.js
```

然后打开 [http://127.0.0.1:3000](http://127.0.0.1:3000)

## Telegram 推送

默认是 `mock` 模式，不会真的发消息。

如果你要接入真实 Telegram 推送：

1. 在页面设置里填入：
   - `chatId`
   - `parseMode`
2. 把 `telegram.enabled` 设为 `true`
3. 把 `telegram.mode` 设为 `bot`
4. 把 `Bot Token` 作为服务端密钥保存，不要暴露到前端

### 本地 Node 版

```bash
set TELEGRAM_BOT_TOKEN=你的_bot_token
node server.js
```

### Cloudflare 线上版

```bash
npx wrangler secret put TELEGRAM_BOT_TOKEN
```

当前使用的 Telegram Bot API 是：

- `POST https://api.telegram.org/bot<TOKEN>/sendMessage`

你需要保证：

- 机器人由 `@BotFather` 创建并可用
- 目标用户或群已经和机器人产生过一次会话
- `chatId` 真实可用

## Cloudflare 部署

这个项目已经补好了 Cloudflare Worker 版本：

- `src/worker.js`: Cloudflare Worker API
- `wrangler.toml`: Cloudflare 部署配置
- `public/`: 作为静态资源直接托管

### 常用命令

```bash
npx wrangler login
npx wrangler deploy
```

### 部署结果

- 静态页面会直接在 Cloudflare 上提供
- `/api/*` 会由 Worker 处理
- 设置和联系记录会写入 KV
- 每天 `12:00 UTC` 会触发一次 cron
  - 对应东京 `21:00`
  - 对应中国 `20:00`

## GitHub

当前目录已经初始化为 git 仓库，可以直接：

```bash
git add .
git commit -m "feat: switch notification to telegram"
git push
```
