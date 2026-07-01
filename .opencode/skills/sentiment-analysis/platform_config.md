# 平台配置参考

## 环境变量

每次执行爬虫前必须设置：
```bash
export PATH="$HOME/.local/bin:$PATH"
```

## 项目路径

```
项目根目录:         ./
MediaCrawler:       ./MediaCrawler/
MediaCrawler配置:   ./MediaCrawler/config/base_config.py
MediaCrawler数据:   ./MediaCrawler/data/{platform}/csv/
IT之家爬虫:         ./scripts/ithome_hot_comments.py
IT之家数据:         ./MediaCrawler/data/ithome/csv/
酷安MCP:            ./coolapk-mcp/
酷安MCP入口:        ./coolapk-mcp/mcp-server.js
```

## 基础配置 (base_config.py)

每次执行前需修改的核心参数：

```python
PLATFORM = "xhs"                          # 当前爬取平台
KEYWORDS = "关键词1,关键词2"               # 英文逗号分隔
LOGIN_TYPE = "qrcode"                      # 登录方式固定为扫码
CRAWLER_TYPE = "search"                    # 搜索模式
ENABLE_CDP_MODE = False                    # 关闭CDP，使用Playwright
HEADLESS = False                           # 显示浏览器（方便扫码）
SAVE_DATA_OPTION = "csv"                   # CSV输出
CRAWLER_MAX_NOTES_COUNT = 999999           # 极高阈值，不作为业务数量限制
ENABLE_GET_COMMENTS = True                 # 开启评论爬取
CRAWLER_MAX_COMMENTS_COUNT_SINGLENOTES = 999999  # 极高阈值，尽量采完相关评论
CRAWLER_MAX_SLEEP_SEC = 2                  # 爬取间隔
```

## 各平台采集量配置

默认策略：不限制时间范围，也不设置业务数量上限；只用关键词相关性、平台无更多结果、风控/稳定性作为停止条件。分析阶段再根据内容质量、互动量和发布时间做取舍。

### IT之家 (ithome)

IT之家爬虫独立于 MediaCrawler，使用项目根目录下的 `scripts/ithome_hot_comments.py`。

**特点**：
- 无需登录，无反爬机制，执行速度快
- 通过 tags 页面按关键词搜索（精确匹配标签）
- 不限制时间范围，文章按发布时间倒序排列
- 每页约 18 篇文章，通过 `--pages` 控制采集深度
- 适合科技、数码、汽车、互联网类话题

**采集深度建议**：
- 默认从 `--pages 10` 开始
- 如果后续页面仍有相关内容，继续提高页数
- 内容过多：分析阶段按互动量、代表性和观点差异抽样，不在采集阶段提前截断

**依赖安装**（首次使用）：
```bash
pip3 install requests beautifulsoup4
```

### 酷安 (coolapk)

酷安通过 MCP Server 集成，已在 `opencode.json` 中注册，AI 可直接调用 MCP 工具。

**特点**：
- 无需登录，内置防爬策略（自动限速1.5-3.5s、设备指纹轮换、风控退避）
- 通过 MCP 工具直接调用（`coolapk_batch_search`、`coolapk_feed`、`coolapk_replies`）
- 数据直接返回到 AI 上下文，无需读取 CSV 文件
- 安卓/手机/系统/App 类话题覆盖极全
- 用户群：安卓发烧友、刷机玩家、数码爱好者

**MCP 工具列表**：

| 工具名 | 用途 | 核心参数 |
|--------|------|---------|
| `coolapk_batch_search` | 多关键词批量搜索+去重 | keywords(数组), pages_per_keyword(1-5) |
| `coolapk_search` | 单关键词搜索 | query, type(feed/user/app), max_pages(1-5) |
| `coolapk_feed` | 帖子详情+评论 | id, include_replies, reply_pages(1-3) |
| `coolapk_replies` | 单独获取评论 | id, pages(1-5), sort(hot/new) |
| `coolapk_topic` | 话题详情+帖子 | tag, include_feeds, feed_pages(1-3) |
| `coolapk_hot` | 酷安热榜 Top20 | 无参数 |

**舆情分析典型流程**：
1. `coolapk_batch_search` → 获取相关帖子列表
2. 筛选与主题相关的帖子，不用评论数做硬过滤
3. `coolapk_feed` → 获取帖子正文 + 热门评论
4. 将内容纳入情感分析

**数据格式**：MCP 工具返回 JSON 格式，核心字段：
- 帖子：id, author, title, content, likes, replies, shares
- 评论：author, content, likes, replies

**限制**：
- 每分钟最多 15 次请求（内置限速）
- 连续 50 次请求后自动冷却 30-60s
- 不限制时间范围，搜索结果按相关性排序；优先提高 `pages_per_keyword` 获取更多样本

### 微博 (wb)

配置文件: `config/weibo_config.py`

```python
WEIBO_SEARCH_TYPE = "real_time"  # 实时搜索，获取最新帖子
# 可选值: "default" | "real_time" | "popular" | "video"
```

微博不做时间截断，优先使用 "real_time" 模式按时间倒序获取更多最新内容。

### 小红书 (xhs)

配置文件: `config/xhs_config.py`

```python
SORT_TYPE = "time_descending"  # 按最新排序
# 可选值: "general" | "popularity_descending" | "time_descending"
```

小红书不做时间截断，优先使用 `time_descending` 获取更多最新内容。

### 抖音 (dy)

配置文件: `config/dy_config.py`

```python
PUBLISH_TIME_TYPE = 0  # 不限时间，优先保证样本量
# 可选值: 0=不限 | 1=一天内 | 7=一周内 | 180=半年内
```

采集策略：默认 `PUBLISH_TIME_TYPE = 0`，不限制发布时间。

### B站 (bili)

不限制时间范围。搜索结果默认按相关性排序。

### 知乎 (zhihu)

不限制时间范围。搜索结果默认按相关性排序。

## 执行命令

### IT之家（无需登录，优先执行）

```bash
# 关键词搜索模式（舆情分析用）
python3 scripts/ithome_hot_comments.py \
  --keyword "关键词1,关键词2" \
  --pages 10 \
  --all-comments \
  --output MediaCrawler/data/ithome/csv/search_comments_$(date +%Y%m%d).csv

# 热榜模式（快速了解当日科技热点舆论）
python3 scripts/ithome_hot_comments.py \
  --rank day \
  --all-comments \
  --output MediaCrawler/data/ithome/csv/hot_comments_$(date +%Y%m%d).csv
```

### 酷安（无需登录，MCP 工具调用）

酷安通过 MCP 工具调用，无需执行命令行。AI 直接使用以下工具：

```
# 批量搜索（推荐，自动去重）
coolapk_batch_search: keywords=["关键词1","关键词2"], pages_per_keyword=5

# 获取帖子详情+评论
coolapk_feed: id="帖子ID", include_replies=true, reply_pages=3

# 单独获取更多评论
coolapk_replies: id="帖子ID", pages=5, sort="hot"
```

### MediaCrawler 平台（需登录）

```bash
cd MediaCrawler

# 微博
uv run main.py --platform wb --lt qrcode --type search

# 小红书
uv run main.py --platform xhs --lt qrcode --type search

# 抖音
uv run main.py --platform dy --lt qrcode --type search

# B站
uv run main.py --platform bili --lt qrcode --type search

# 知乎
uv run main.py --platform zhihu --lt qrcode --type search
```

## 数据文件格式

### IT之家 CSV 字段

| 文件名格式 | 核心字段 |
|-----------|---------|
| search_comments_{date}.csv | article_title, article_url, article_publish_time, comment_type(热门/最新), nickname, city, post_time, content, support, against, device, reply_count |

**字段说明**：
- `comment_type`: "热门" 表示按支持数排序的高赞评论，"最新" 表示按时间倒序
- `support` / `against`: 支持数/反对数（类似点赞/点踩）
- `city`: 用户 IP 归属地，如 "IT之家浙江杭州网友"
- `device`: 用户设备型号，如 "iPhone 16 Pro Max"、"Xiaomi 17 Ultra"

### 帖子/笔记 CSV 字段（MediaCrawler）

| 平台 | 文件名格式 | 核心字段 |
|------|-----------|---------|
| 微博 | search_contents_{date}.csv | note_id, title, create_time, like_count, comment_count |
| 小红书 | search_contents_{date}.csv | note_id, title, desc, liked_count, comment_count, nickname |
| 抖音 | search_contents_{date}.csv | aweme_id, title, create_time, like_count, comment_count |
| B站 | search_videos_{date}.csv | video_id, title, view_count, like_count, comment_count |
| 知乎 | search_contents_{date}.csv | content_id, title, content, like_count, comment_count |

### 评论 CSV 字段（MediaCrawler）

| 平台 | 文件名格式 | 核心字段 |
|------|-----------|---------|
| 微博 | search_comments_{date}.csv | comment_id, content, nickname, ip_location, comment_like_count |
| 小红书 | search_comments_{date}.csv | comment_id, content, nickname, ip_location, like_count |
| 抖音 | search_comments_{date}.csv | comment_id, content, nickname, ip_location, like_count |
| B站 | search_comments_{date}.csv | comment_id, content, nickname, like_count |
| 知乎 | search_comments_{date}.csv | comment_id, content, user_nickname, ip_location, like_count |

## 登录态缓存

IT之家和酷安均无需登录，始终可用。

MediaCrawler 各平台登录态缓存目录：
```
MediaCrawler/browser_data/{platform}_user_data_dir/
```

缓存有效期：
- IT之家：无需登录，永久可用
- 酷安：无需登录，内置防爬策略自动处理
- 微博：约 1-3 天
- 小红书：约 3-7 天
- 抖音：约 1-3 天
- B站：约 7-30 天
- 知乎：约 7-14 天

过期表现：爬虫启动后弹出扫码页面而不是直接开始搜索。

## 常见错误处理

| 错误 | 原因 | 处理 |
|------|------|------|
| IT之家返回404 | 关键词无对应tags页面 | 换用更通用的关键词，或拆分关键词 |
| IT之家评论为0 | 文章较老或评论区已关闭 | 正常，自动跳过 |
| 酷安 429/验证码 | 请求频率过高触发风控 | 内置自动退避+换指纹重试，通常无需干预 |
| 酷安搜索结果为空 | 关键词在酷安无相关讨论 | 正常，在报告中标注"该平台无相关讨论" |
| `TargetClosedError` | 浏览器被手动关闭或崩溃 | 使用已采集数据，继续下一平台 |
| `RetryError` + "已过滤部分评论" | 微博评论被过滤（博主设置） | 正常，跳过该帖评论 |
| `RetryError` + "还没有人评论" | 帖子无评论 | 正常，跳过 |
| 登录弹窗超时 | 登录态过期 | 提醒用户扫码 |
| `DataFetchError` | 请求被限流 | 增加 CRAWLER_MAX_SLEEP_SEC |
