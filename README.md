# 亲情联系助手 Demo

一个可本地运行的 Web demo，用来验证“异地子女低成本维持和父母稳定联系”的产品方向。

## 功能

- 每天生成一次联系建议和可直接发送的话术
- 支持保存联系记录，形成后续话题记忆
- 提供“反向索取”节奏，避免只会机械关心
- 预留微信服务通知发送接口
- 本地 JSON 存储，适合快速演示和继续迭代

## 本地启动

```bash
node server.js
```

然后打开 [http://127.0.0.1:3000](http://127.0.0.1:3000)

## Cloudflare 部署

这个项目已经补好了 Cloudflare Worker 版本：

- `src/worker.js`: Cloudflare Worker API
- `wrangler.toml`: Cloudflare 部署配置
- `public/`: 作为静态资源直接托管

### 第一次部署前需要准备

1. 登录 Cloudflare
2. 创建一个 KV namespace
3. 把 `wrangler.toml` 里的 KV id 替换掉

### 常用命令

```bash
npx wrangler login
npx wrangler kv namespace create APP_DATA
npx wrangler kv namespace create APP_DATA --preview
npx wrangler deploy
```

### 部署结果

- 静态页面会直接在 Cloudflare 上提供
- `/api/*` 会由 Worker 处理
- 设置和联系记录会写入 KV
- 每天 `12:00 UTC` 会触发一次 cron
  - 对应东京 `21:00`
  - 对应中国 `20:00`

## 目录结构

- `server.js`: 原生 Node HTTP 服务和 API
- `public/`: 前端静态页面
- `data/settings.json`: 用户与微信配置
- `data/history.json`: 联系记录

## 微信服务通知

默认是 `mock` 模式，不会真的发消息。

如果你要接入真实微信订阅消息：

1. 把 `data/settings.json` 里的 `wechat.enabled` 改成 `true`
2. 把 `wechat.mode` 改成 `subscribe`
3. 填入下面字段
   - `appId`
   - `appSecret`
   - `templateId`
   - `openId`
4. 通过页面按钮或 `POST /api/cron/daily` 触发发送

当前模板 payload 使用的是微信订阅消息接口：

- `thing1`: 标题
- `thing2`: 建议话术
- `time3`: 建议联系时间

真实项目里你需要保证模板字段和代码里发送的数据类型一致。

## 定时任务

你可以把下面的地址挂到系统计划任务、云函数或服务器 cron：

```bash
POST http://127.0.0.1:3000/api/cron/daily
```

## GitHub

如果当前目录已经初始化为 git 仓库，可以直接：

```bash
git add .
git commit -m "feat: family connection demo"
git branch -M main
git remote add origin <your-repo-url>
git push -u origin main
```

如果你告诉我远程仓库地址，我可以继续帮你把这一步也处理掉。
