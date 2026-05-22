# 平台配置参考

## 环境变量

每次执行爬虫前必须设置：
```bash
export PATH="$HOME/.local/bin:$PATH"
```

## MediaCrawler 路径

```
项目根目录: ./MediaCrawler/
配置文件:   ./MediaCrawler/config/base_config.py
数据输出:   ./MediaCrawler/data/{platform}/csv/
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
CRAWLER_MAX_NOTES_COUNT = 200              # 每平台最大帖子数
ENABLE_GET_COMMENTS = True                 # 开启评论爬取
CRAWLER_MAX_COMMENTS_COUNT_SINGLENOTES = 50  # 每帖最大评论数
CRAWLER_MAX_SLEEP_SEC = 2                  # 爬取间隔
```

## 各平台时间筛选配置

### 微博 (wb)

配置文件: `config/weibo_config.py`

```python
WEIBO_SEARCH_TYPE = "real_time"  # 实时搜索，获取最新帖子
# 可选值: "default" | "real_time" | "popular" | "video"
```

微博不支持精确时间范围筛选，但"real_time"模式会按时间倒序返回最新内容。

### 小红书 (xhs)

配置文件: `config/xhs_config.py`

```python
SORT_TYPE = "time_descending"  # 按最新排序
# 可选值: "general" | "popularity_descending" | "time_descending"
```

小红书不支持时间范围筛选，通过排序方式间接控制。

### 抖音 (dy)

配置文件: `config/dy_config.py`

```python
PUBLISH_TIME_TYPE = 7  # 最近一周
# 可选值: 0=不限 | 1=一天内 | 7=一周内 | 180=半年内
```

时间范围对照：
- 最近1天: `PUBLISH_TIME_TYPE = 1`
- 最近1周: `PUBLISH_TIME_TYPE = 7`
- 最近半年: `PUBLISH_TIME_TYPE = 180`
- 不限: `PUBLISH_TIME_TYPE = 0`

### B站 (bili)

无时间筛选参数。搜索结果默认按相关性排序。

### 知乎 (zhihu)

无时间筛选参数。搜索结果默认按相关性排序。

## 执行命令

```bash
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

### 帖子/笔记 CSV 字段

| 平台 | 文件名格式 | 核心字段 |
|------|-----------|---------|
| 微博 | search_contents_{date}.csv | note_id, title, create_time, like_count, comment_count |
| 小红书 | search_contents_{date}.csv | note_id, title, desc, liked_count, comment_count, nickname |
| 抖音 | search_contents_{date}.csv | aweme_id, title, create_time, like_count, comment_count |
| B站 | search_videos_{date}.csv | video_id, title, view_count, like_count, comment_count |
| 知乎 | search_contents_{date}.csv | content_id, title, content, like_count, comment_count |

### 评论 CSV 字段

| 平台 | 文件名格式 | 核心字段 |
|------|-----------|---------|
| 微博 | search_comments_{date}.csv | comment_id, content, nickname, ip_location, comment_like_count |
| 小红书 | search_comments_{date}.csv | comment_id, content, nickname, ip_location, like_count |
| 抖音 | search_comments_{date}.csv | comment_id, content, nickname, ip_location, like_count |
| B站 | search_comments_{date}.csv | comment_id, content, nickname, like_count |
| 知乎 | search_comments_{date}.csv | comment_id, content, user_nickname, ip_location, like_count |

## 登录态缓存

各平台登录态缓存目录：
```
MediaCrawler/browser_data/{platform}_user_data_dir/
```

缓存有效期：
- 微博：约 1-3 天
- 小红书：约 3-7 天
- 抖音：约 1-3 天
- B站：约 7-30 天
- 知乎：约 7-14 天

过期表现：爬虫启动后弹出扫码页面而不是直接开始搜索。

## 常见错误处理

| 错误 | 原因 | 处理 |
|------|------|------|
| `TargetClosedError` | 浏览器被手动关闭或崩溃 | 使用已采集数据，继续下一平台 |
| `RetryError` + "已过滤部分评论" | 微博评论被过滤（博主设置） | 正常，跳过该帖评论 |
| `RetryError` + "还没有人评论" | 帖子无评论 | 正常，跳过 |
| 登录弹窗超时 | 登录态过期 | 提醒用户扫码 |
| `DataFetchError` | 请求被限流 | 增加 CRAWLER_MAX_SLEEP_SEC |
