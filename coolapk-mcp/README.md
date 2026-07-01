# 酷安 API

非官方酷安 API SDK，内置防爬策略、设备指纹轮换、本地情感分析。可作为 CLI 工具、Web 舆论监测面板、或 MCP Server 使用。

## 功能

- **搜索** — 帖子/用户/应用，支持多页批量采集
- **帖子详情 + 评论** — 按热度或时间排序
- **用户主页** — 粉丝数、动态列表
- **话题/首页 Feed** — 实时内容流
- **本地情感分析** — distilbert 多语言模型，离线运行，2ms/条
- **Web 面板** — 搜索 + 评论 + 情感 + 词频可视化

## 防爬策略

不需要配置，开箱即用：

| 策略 | 说明 |
|------|------|
| 请求间隔 | 1.5–3.5s 随机延迟 |
| 设备指纹池 | 10 个随机合法指纹轮换使用 |
| 风控自动退避 | 遇到验证码/429 指数退避，换指纹重试 |
| 每分钟限速 | 最多 15 次/分钟 |
| 连续请求冷却 | 50 次后自动休息 30–60s |

## 安装

```bash
git clone https://github.com/your/coolapk-api.git
cd coolapk-api
npm install
```

要求：**Node.js >= 18**（需要 ESM 支持）

情感分析模型会在首次运行 Web 面板时自动从 HuggingFace 下载（~100MB），后续离线可用。

## 使用

### CLI

```bash
# 搜索帖子
node bin/cli.js search "HyperOS"

# 指定类型和页码
node bin/cli.js search "小米15" --type feed --page 2

# 帖子详情
node bin/cli.js feed 71992686

# 查看评论
node bin/cli.js replies 71992686 --page 1

# 用户主页
node bin/cli.js user 12345678

# 话题
node bin/cli.js topic "HyperOS3"

# 首页 Feed
node bin/cli.js index
```

全局安装后可直接用 `coolapk` 命令：

```bash
npm link
coolapk search "rust桌面"
```

### Web 舆论监测面板

```bash
npm start
# 或
./start.sh
```

打开 http://localhost:3000，支持：
- 关键词搜索（带缓存 + 后台刷新）
- 帖子评论查看
- 实时情感分析（正面/负面/中性）
- 词频统计

### 作为 SDK 引入

```javascript
const CoolapkAPI = require('./src/index');
const api = new CoolapkAPI();

// 搜索
const results = await api.search('HyperOS', 'feed', 1);

// 批量搜索（自动翻页）
const all = await api.searchAll('澎湃OS', { maxPages: 5 });

// 帖子评论
const replies = await api.feedReplies('71992686', 1, 'hot');

// 用户
const user = await api.userProfile('12345678');
```

### MCP Server（可选）

```bash
node mcp-server.js
```

提供以下 tools 供 AI 客户端调用（Claude Desktop / Cursor / Brick 等）：
- `coolapk_search` — 搜索帖子
- `coolapk_feed` — 帖子详情
- `coolapk_replies` — 帖子评论
- `coolapk_user` — 用户信息
- `coolapk_topic` — 话题详情

## 项目结构

```
src/
  index.js          API SDK 主体（搜索/帖子/用户/话题）
  token_v3.js       Token v3 签名算法（bcrypt cost=04）
  device-pool.js    设备指纹池 + 轮换策略
  rate-limiter.js   防爬限速 + 指数退避
  store.js          JSON 持久化缓存（TTL + stale 刷新）
  sentiment.mjs     本地情感分析（distilbert int8 量化）
bin/
  cli.js            命令行工具
web/
  server.mjs        Web 服务端（HTTP API）
  index.html        Web 前端（搜索/评论/情感/词频）
mcp-server.js       MCP Server（AI 工具集成）
```

## 注意事项

- 本项目仅供学习研究使用
- 请勿高频请求，内置限速已确保合理使用
- 从 Surge 等代理（尤其是香港 IP）访问可能触发验证码风控
- Token 算法逆向自酷安 v16.2.2，后续版本更新可能失效

## 技术细节

Token v3 签名流程：

1. 从 SOURCE_STRING 按时间戳偏移提取子串并 base64 解码
2. 拼接 `packageName & decoded & md5(deviceId) & timestamp & versionCode`
3. 对拼接结果做 base64 → md5 得到 bcrypt 输入
4. 用时间戳 hex + md5(combine) 生成 bcrypt salt
5. bcrypt 加密（**cost=04**，不是默认的 10）
6. 替换 `$2a` 为 `$2y`，base64 编码后加 `v3` 前缀

设备指纹（X-App-Device）：
- 170 字符长度
- base64 编码的设备信息字符串（倒序）
- 包含 brand/model/serial/androidId/mac/imei/sdkInt/分辨率等字段
