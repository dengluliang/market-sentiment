# Market Sentiment - AI 舆情分析工具包

基于 [opencode](https://opencode.ai) + MediaCrawler 的全网舆情分析工具。

只需一句话描述你想分析的产品/事件，AI 自动完成：多平台数据采集 → 相关性筛查去噪 → 情感分析 → 观点聚类 → 生成专业报告。

## 它能做什么

- 自动爬取 7 大平台（微博、小红书、抖音、B站、知乎、IT之家、酷安）的帖子和评论
- 数据汇总后先做相关性筛查，去除广告、误命中、灌水和同名噪声
- 对采集的评论进行情感分类（正面/负面/中性）
- 识别 KOL 和媒体的报道观点
- 自动识别竞品动态
- 生成十章结构化的舆情分析报告（输出到飞书文档）

## 快速开始

### 1. 环境准备

```bash
# 安装 opencode
curl -fsSL https://opencode.ai/install | bash

# 安装 Python 3.11+ 和 uv（Python 包管理器）
# macOS:
brew install python@3.11
pip install uv

# 安装 Playwright 浏览器
uv run playwright install chromium

# 安装酷安 MCP 依赖
cd coolapk-mcp && npm install && cd ..

# 安装 IT之家爬虫依赖
pip install requests beautifulsoup4
```

### 2. 克隆本项目

```bash
git clone <本仓库地址>
cd "Market Sentiment"
```

### 3. 安装 MediaCrawler 依赖

```bash
cd MediaCrawler
uv sync
cd ..
```

### 4. 配置模型和服务

编辑项目根目录的 `opencode.json`，填入你自己的配置：

```jsonc
{
  "$schema": "https://opencode.ai/config.json",
  // 方式一：直接用 Anthropic 官方 API
  "model": "anthropic/claude-sonnet-4-6",
  "provider": {
    "anthropic": {
      "options": {
        "apiKey": "sk-ant-你的key"
      }
    }
  },
  // 方式二：用兼容 API（如 OpenRouter、自建代理等）
  // "provider": {
  //   "my-provider": {
  //     "npm": "@ai-sdk/anthropic",
  //     "options": {
  //       "baseURL": "https://你的代理地址/v1",
  //       "apiKey": "你的key"
  //     },
  //     "models": {
  //       "claude-sonnet-4-6": { "name": "Claude Sonnet 4.6" }
  //     }
  //   }
  // },

  // 飞书 MCP（用于输出报告到飞书文档，可选）
  "mcp": {
    "feishu": {
      "type": "remote",
      "url": "{env:FEISHU_MCP_URL}",
      "enabled": true
    },
    "coolapk": {
      "type": "local",
      "command": ["node", "coolapk-mcp/mcp-server.js"],
      "enabled": true
    }
  }
}
```

**模型要求**：推荐 Claude Sonnet 4 及以上（需要强大的中文分析和长文本处理能力）。

**飞书 MCP**（可选）：用于将报告输出到飞书文档。获取方式见 [飞书 MCP 文档](https://mcp.feishu.cn)，并通过环境变量 `FEISHU_MCP_URL` 配置。如果不需要飞书输出，可以把 `feishu` 部分删掉，报告会以文本形式直接展示。

### 5. 开始使用

```bash
cd "Market Sentiment"
opencode
```

然后直接输入你的分析需求，例如：

- `帮我分析一下"华为Mate70"的全网口碑`
- `看看"小米SU7"最近一周的舆情`
- `"iPhone 16 Pro"用户反馈分析`

AI 会自动引导你确认关键词、平台范围和采集量策略，然后执行全流程。

## 使用流程

```
你输入需求 → AI 拆解关键词并确认
                    ↓
         配置爬虫 → 依次爬取 7 个平台（部分需要扫码登录）
                     ↓
         数据汇总 → 相关性筛查去噪 → 情感分析 + 观点聚类
                    ↓
         生成报告 → 输出飞书文档（或文本）
```

**注意**：微博、小红书、抖音、B站、知乎首次使用时需要用手机扫码登录（爬虫会弹出浏览器窗口），登录态会缓存数天。IT之家和酷安无需扫码登录。

## 目录结构

```
Market Sentiment/
├── opencode.json                    # opencode 配置（需要填入你的 API key）
├── .opencode/
│   └── skills/
│       └── sentiment-analysis/      # 舆情分析 Skill（核心逻辑）
│           ├── SKILL.md             # Skill 工作流定义
│           ├── platform_config.md   # 平台配置参考
│           └── kol_media_list.json  # KOL/媒体库（可替换为你的行业）
├── scripts/
│   └── ithome_hot_comments.py       # IT之家评论爬虫
├── coolapk-mcp/                     # 酷安 MCP Server
├── MediaCrawler/                    # 数据采集引擎（NanmiCoder/MediaCrawler）
│   ├── config/                      # 爬虫配置
│   ├── data/                        # 采集数据输出（自动生成）
│   ├── data_archive/                # 历史数据归档（自动生成）
│   └── ...
└── README.md
```

## 自定义

### 替换 KOL 库

编辑 `.opencode/skills/sentiment-analysis/kol_media_list.json`，替换为你所在行业的 KOL 和媒体账号。格式：

```json
{
  "media": [
    {"name": "显示名", "category": "机构媒体", "platforms": {"weibo": "微博昵称", "xhs": "小红书昵称"}}
  ],
  "kol": [
    {"name": "显示名", "category": "KOL", "platforms": {"weibo": "微博昵称", "bili": "B站昵称"}}
  ],
  "blacklist": [
    {"name": "不想要的", "reason": "原因"}
  ]
}
```

### 调整报告模板

编辑 `.opencode/skills/sentiment-analysis/SKILL.md` 中的"报告模板结构"章节，可以增删章节、修改输出格式。

### 调整爬取参数

修改 `MediaCrawler/config/base_config.py` 中的默认值（帖子数量、评论数量、爬取间隔等）。

## 常见问题

**Q: 扫码登录态多久过期？**
- 微博：1-3 天
- 小红书：3-7 天
- 抖音：1-3 天
- B站：7-30 天
- 知乎：7-14 天

**Q: 爬虫报错 `TargetClosedError` 怎么办？**
浏览器崩溃了，AI 会自动跳过该平台继续下一个。

**Q: 不想用飞书输出怎么办？**
把 `opencode.json` 中的 `mcp` 部分删掉即可。报告会直接在终端以文本形式展示。

**Q: 支持 Windows 吗？**
MediaCrawler 支持 Windows，但需自行确保 Python 3.11+ 和 uv 的安装。opencode 同样支持 Windows。

## 致谢

- [opencode](https://opencode.ai) - AI 编程助手
- [MediaCrawler](https://github.com/NanmiCoder/MediaCrawler) - 多平台社媒爬虫引擎
