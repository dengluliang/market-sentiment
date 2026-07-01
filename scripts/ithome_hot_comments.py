#!/usr/bin/env python3
"""
IT之家热门评论爬虫 (2026重写版)

功能：
1. 爬取IT之家热榜文章（日榜/周榜/月榜）
2. 按关键词搜索文章并获取评论（舆情分析模式）
3. 获取每篇文章的热门评论
4. 支持输出到 CSV 文件或终端

API 说明：
- 热榜文章列表：https://www.ithome.com/block/rank.html
- 关键词搜索（tags页）：https://www.ithome.com/tags/{keyword}/
- 关键词搜索翻页：POST https://www.ithome.com/category/tagpage?keyword={keyword}&page={n}
- 文章评论 hash：从文章页面 <div id="post_comm" data-id="xxx"> 获取
- 评论接口：https://cmt.ithome.com/api/webcomment/getnewscomment?sn={hash}&cid=0&isInit=true&appver=900

用法：
    # 热榜模式
    python ithome_hot_comments.py                  # 爬取日榜所有文章的热门评论
    python ithome_hot_comments.py --rank week       # 爬取周榜
    python ithome_hot_comments.py --rank month      # 爬取月榜

    # 关键词搜索模式（舆情分析）
    python ithome_hot_comments.py --keyword "小米17"              # 搜索关键词
    python ithome_hot_comments.py --keyword "华为Mate70" --pages 3  # 搜索3页
    python ithome_hot_comments.py --keyword "小米17,华为Mate70"    # 多关键词

    # 通用参数
    python ithome_hot_comments.py --limit 5         # 只爬前5篇文章
    python ithome_hot_comments.py --all-comments    # 爬取所有评论（不仅是热门）
    python ithome_hot_comments.py --output result.csv  # 输出到 CSV 文件
"""

import argparse
import csv
import json
import re
import sys
import time
from datetime import datetime
from pathlib import Path
from typing import Optional

import requests
from bs4 import BeautifulSoup

# ============================================================
# 配置
# ============================================================

HEADERS = {
    "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) "
                  "AppleWebKit/537.36 (KHTML, like Gecko) "
                  "Chrome/120.0.0.0 Safari/537.36",
    "Referer": "https://www.ithome.com/",
    "Accept": "application/json, text/javascript, */*; q=0.01",
    "Accept-Language": "zh-CN,zh;q=0.9,en;q=0.8",
}

RANK_URL = "https://www.ithome.com/block/rank.html"
TAGS_URL = "https://www.ithome.com/tags/{keyword}/"
TAGS_PAGE_URL = "https://www.ithome.com/category/tagpage"
COMMENT_API = "https://cmt.ithome.com/api/webcomment/getnewscomment"
REQUEST_DELAY = 1.0  # 请求间隔（秒），避免给服务器造成压力


# ============================================================
# 获取热榜文章列表
# ============================================================

def get_rank_articles(rank_type: str = "day") -> list[dict]:
    """
    获取 IT之家热榜文章列表

    Args:
        rank_type: "day" / "week" / "month"

    Returns:
        [{"title": str, "url": str, "news_id": str}, ...]
    """
    rank_map = {"day": "d-1", "week": "d-2", "month": "d-3"}
    target_id = rank_map.get(rank_type, "d-1")

    resp = requests.get(RANK_URL, headers=HEADERS, timeout=10)
    resp.encoding = "utf-8"
    soup = BeautifulSoup(resp.text, "html.parser")

    ul = soup.find("ul", id=target_id)
    if not ul:
        print(f"[ERROR] 未找到排行榜数据 (id={target_id})")
        return []

    articles = []
    for li in ul.find_all("li"):
        a_tag = li.find("a")
        if not a_tag:
            continue
        title = a_tag.get("title") or a_tag.get_text(strip=True)
        url = a_tag.get("href", "")
        # 从 URL 提取 news_id，如 https://www.ithome.com/0/962/207.htm -> 962207
        match = re.search(r"/(\d+)/(\d+)\.htm", url)
        if match:
            news_id = match.group(1) + match.group(2)
        else:
            news_id = ""
        articles.append({"title": title, "url": url, "news_id": news_id})

    return articles


# ============================================================
# 关键词搜索文章（舆情分析模式）
# ============================================================

def search_articles_by_keyword(keyword: str, pages: int = 2) -> list[dict]:
    """
    通过 IT之家 tags 页面按关键词搜索文章

    Args:
        keyword: 搜索关键词
        pages: 翻页数（第1页从 tags 页获取，后续从翻页 API 获取）

    Returns:
        [{"title": str, "url": str, "news_id": str, "publish_time": str}, ...]
    """
    articles = []

    # 第一页：直接请求 tags 页面
    url = TAGS_URL.format(keyword=keyword)
    try:
        resp = requests.get(url, headers=HEADERS, timeout=10)
        resp.encoding = "utf-8"
        if resp.status_code != 200:
            print(f"  [WARN] 关键词 '{keyword}' 搜索返回 {resp.status_code}")
            return []
    except Exception as e:
        print(f"  [WARN] 搜索请求失败: {e}")
        return []

    soup = BeautifulSoup(resp.text, "html.parser")
    ul = soup.find("ul", class_="bl")
    if ul:
        articles.extend(_parse_tag_page_articles(ul))

    # 后续页：通过翻页 API
    for page in range(1, pages):
        time.sleep(REQUEST_DELAY)
        try:
            resp = requests.post(
                TAGS_PAGE_URL,
                data={"keyword": keyword, "page": page},
                headers={**HEADERS, "X-Requested-With": "XMLHttpRequest"},
                timeout=10
            )
            data = resp.json()
            if data.get("success") and data.get("content", {}).get("html"):
                page_soup = BeautifulSoup(data["content"]["html"], "html.parser")
                page_articles = _parse_tag_page_articles(page_soup)
                if not page_articles:
                    break
                articles.extend(page_articles)
            else:
                break
        except Exception as e:
            print(f"  [WARN] 翻页请求失败 (page={page}): {e}")
            break

    return articles


def _parse_tag_page_articles(soup_element) -> list[dict]:
    """从 tags 页面 HTML 中解析文章列表"""
    articles = []
    for li in soup_element.find_all("li"):
        a_tag = li.find("a", class_="title") or li.find("h2", class_="")
        if a_tag:
            # 嵌套结构：h2 > a.title
            if a_tag.name == "h2":
                a_tag = a_tag.find("a")
            if not a_tag:
                continue
        else:
            # 简单结构的 li > a
            a_tag = li.find("a", href=True)
            if not a_tag:
                continue

        title = a_tag.get("title") or a_tag.get_text(strip=True)
        url = a_tag.get("href", "")
        if not url.startswith("http"):
            url = "https://www.ithome.com" + url

        # 提取 news_id
        match = re.search(r"/(\d+)/(\d+)\.htm", url)
        news_id = match.group(1) + match.group(2) if match else ""

        # 提取发布时间
        publish_time = ""
        time_div = li.find("div", class_="c")
        if time_div and time_div.get("data-ot"):
            publish_time = time_div["data-ot"][:19]  # 截取到秒
        if not publish_time:
            time_span = li.find("span", class_="state")
            if time_span:
                publish_time = time_span.get_text(strip=True)

        if title and url:
            articles.append({
                "title": title,
                "url": url,
                "news_id": news_id,
                "publish_time": publish_time,
            })

    return articles


# ============================================================
# 获取文章评论 hash（sn）
# ============================================================

def get_comment_hash(article_url: str) -> Optional[str]:
    """
    从文章页面获取评论区的 data-id (hash)，用于调用评论 API

    Args:
        article_url: 文章完整 URL

    Returns:
        hash 字符串，如 "d781e465b5c881b6"
    """
    try:
        resp = requests.get(article_url, headers=HEADERS, timeout=10)
        resp.encoding = "utf-8"
        # 用正则直接提取，比解析整个 HTML 快
        match = re.search(r'id="post_comm"\s+data-id="([a-f0-9]+)"', resp.text)
        if match:
            return match.group(1)
        # 备选：data-id 在前
        match = re.search(r'data-id="([a-f0-9]+)"\s+data-nid=', resp.text)
        if match:
            return match.group(1)
    except Exception as e:
        print(f"  [WARN] 获取评论 hash 失败: {e}")
    return None


# ============================================================
# 获取评论数据
# ============================================================

def parse_comment_text(elements: list) -> str:
    """从评论 elements 数组中提取纯文本内容"""
    texts = []
    for elem in elements:
        if elem.get("type") == 0:  # Text
            content = elem.get("content", "")
            if content:
                texts.append(content)
        elif elem.get("type") == 2:  # Link
            texts.append(elem.get("content") or elem.get("link", ""))
        elif elem.get("type") == 4:  # @At
            texts.append(elem.get("content", ""))
    return "".join(texts)


def get_comments(sn: str, fetch_all: bool = False) -> dict:
    """
    获取文章评论

    Args:
        sn: 文章评论 hash
        fetch_all: 是否获取所有评论（否则只取热门）

    Returns:
        {"hot_comments": [...], "comments": [...], "news_id": int}
    """
    result = {"hot_comments": [], "comments": [], "news_id": 0}

    params = {"sn": sn, "cid": 0, "isInit": "true", "appver": "900"}
    try:
        resp = requests.get(COMMENT_API, params=params, headers=HEADERS, timeout=15)
        data = resp.json()
    except Exception as e:
        print(f"  [WARN] 评论接口请求失败: {e}")
        return result

    if not data.get("success"):
        print(f"  [WARN] 评论接口返回失败: {data.get('message')}")
        return result

    content = data.get("content", {})
    result["news_id"] = content.get("newsId", 0)

    # 解析热门评论
    for c in content.get("hotComments", []):
        result["hot_comments"].append(_parse_single_comment(c))

    # 解析普通评论（第一页）
    for c in content.get("comments", []):
        result["comments"].append(_parse_single_comment(c))

    # 如果需要所有评论，继续翻页
    if fetch_all and content.get("comments"):
        last_id = content["comments"][-1]["id"]
        while True:
            time.sleep(REQUEST_DELAY)
            params["cid"] = last_id
            params["isInit"] = "false"
            try:
                resp = requests.get(COMMENT_API, params=params, headers=HEADERS, timeout=15)
                page_data = resp.json()
            except Exception:
                break

            if not page_data.get("success"):
                break
            page_comments = page_data.get("content", {}).get("comments", [])
            if not page_comments:
                break

            for c in page_comments:
                result["comments"].append(_parse_single_comment(c))
            last_id = page_comments[-1]["id"]
            print(f"    已获取 {len(result['comments'])} 条评论...")

    return result


def _parse_single_comment(c: dict) -> dict:
    """解析单条评论为结构化数据"""
    user_info = c.get("userInfo", {})
    device_info = c.get("deviceTailModel", {})

    return {
        "id": c.get("id"),
        "floor": c.get("floorStr", ""),
        "nickname": user_info.get("userNick", "未知用户"),
        "user_id": user_info.get("id", 0),
        "level": user_info.get("level", 0),
        "city": c.get("city", ""),
        "post_time": c.get("postTime", ""),
        "content": parse_comment_text(c.get("elements", [])),
        "support": c.get("support", 0),
        "against": c.get("against", 0),
        "device": device_info.get("name", "") if device_info else "",
        "reply_count": c.get("expandCount", 0),
    }


# ============================================================
# 输出
# ============================================================

def print_comments(article: dict, comments_data: dict):
    """在终端打印评论"""
    print(f"\n{'='*70}")
    print(f"文章: {article['title']}")
    print(f"链接: {article['url']}")
    print(f"{'='*70}")

    if comments_data["hot_comments"]:
        print(f"\n  --- 热门评论 ({len(comments_data['hot_comments'])}条) ---")
        for i, c in enumerate(comments_data["hot_comments"], 1):
            print(f"\n  [{i}] {c['nickname']} ({c['city']}) {c['floor']}")
            print(f"      {c['content'][:200]}")
            print(f"      👍 {c['support']}  👎 {c['against']}  "
                  f"📱 {c['device']}  🕐 {c['post_time'][:16]}")

    if comments_data["comments"]:
        print(f"\n  --- 最新评论 ({len(comments_data['comments'])}条) ---")
        for i, c in enumerate(comments_data["comments"][:10], 1):
            print(f"\n  [{i}] {c['nickname']} ({c['city']}) {c['floor']}")
            print(f"      {c['content'][:200]}")
            print(f"      👍 {c['support']}  👎 {c['against']}  🕐 {c['post_time'][:16]}")
        if len(comments_data["comments"]) > 10:
            print(f"\n  ... 还有 {len(comments_data['comments']) - 10} 条评论未显示")


def save_to_csv(all_results: list[tuple[dict, dict]], output_path: str):
    """保存所有评论到 CSV 文件"""
    filepath = Path(output_path)
    filepath.parent.mkdir(parents=True, exist_ok=True)

    rows = []
    for article, comments_data in all_results:
        for comment_type in ("hot_comments", "comments"):
            for c in comments_data[comment_type]:
                rows.append({
                    "article_title": article["title"],
                    "article_url": article["url"],
                    "article_publish_time": article.get("publish_time", ""),
                    "comment_type": "热门" if comment_type == "hot_comments" else "最新",
                    "floor": c["floor"],
                    "nickname": c["nickname"],
                    "user_id": c["user_id"],
                    "level": c["level"],
                    "city": c["city"],
                    "post_time": c["post_time"],
                    "content": c["content"],
                    "support": c["support"],
                    "against": c["against"],
                    "device": c["device"],
                    "reply_count": c["reply_count"],
                })

    if not rows:
        print("[WARN] 没有获取到任何评论数据")
        return

    fieldnames = list(rows[0].keys())
    with open(filepath, "w", newline="", encoding="utf-8-sig") as f:
        writer = csv.DictWriter(f, fieldnames=fieldnames)
        writer.writeheader()
        writer.writerows(rows)

    print(f"\n[OK] 已保存 {len(rows)} 条评论到: {filepath}")


# ============================================================
# 主程序
# ============================================================

def main():
    parser = argparse.ArgumentParser(description="IT之家热门评论爬虫 (2026重写版)")
    parser.add_argument("--rank", choices=["day", "week", "month"], default="day",
                        help="排行榜类型：day(日榜)/week(周榜)/month(月榜)，默认 day")
    parser.add_argument("--keyword", "-k", type=str, default="",
                        help="关键词搜索模式，多个关键词用英文逗号分隔")
    parser.add_argument("--pages", type=int, default=2,
                        help="关键词搜索时的翻页数，默认 2")
    parser.add_argument("--limit", type=int, default=0,
                        help="限制爬取文章数量，0 表示全部")
    parser.add_argument("--all-comments", action="store_true",
                        help="获取所有评论（默认只获取热门评论和第一页最新评论）")
    parser.add_argument("--output", "-o", type=str, default="",
                        help="输出 CSV 文件路径（不指定则打印到终端）")
    parser.add_argument("--delay", type=float, default=1.0,
                        help="请求间隔秒数，默认 1.0")
    args = parser.parse_args()

    global REQUEST_DELAY
    REQUEST_DELAY = args.delay

    print(f"[*] IT之家热门评论爬虫")
    print(f"[*] 时间: {datetime.now().strftime('%Y-%m-%d %H:%M:%S')}")

    # Step 1: 获取文章列表（两种模式）
    if args.keyword:
        # 关键词搜索模式
        keywords = [kw.strip() for kw in args.keyword.split(",") if kw.strip()]
        print(f"[*] 模式: 关键词搜索")
        print(f"[*] 关键词: {', '.join(keywords)}")
        print(f"[*] 翻页数: {args.pages}")
        print()

        print("[1/3] 按关键词搜索文章...")
        articles = []
        seen_urls = set()
        for kw in keywords:
            print(f"  搜索: {kw}")
            time.sleep(REQUEST_DELAY)
            kw_articles = search_articles_by_keyword(kw, pages=args.pages)
            for a in kw_articles:
                if a["url"] not in seen_urls:
                    seen_urls.add(a["url"])
                    articles.append(a)
            print(f"    找到 {len(kw_articles)} 篇文章 (去重后累计 {len(articles)} 篇)")
    else:
        # 热榜模式
        rank_names = {"day": "日榜", "week": "周榜", "month": "月榜"}
        print(f"[*] 模式: 热榜 ({rank_names[args.rank]})")
        print()

        print("[1/3] 获取热榜文章列表...")
        articles = get_rank_articles(args.rank)

    if not articles:
        print("[ERROR] 获取文章列表失败")
        sys.exit(1)

    if args.limit > 0:
        articles = articles[:args.limit]
    print(f"  共获取 {len(articles)} 篇文章")

    # Step 2: 逐篇获取评论
    print(f"\n[2/3] 获取文章评论...")
    all_results = []
    for i, article in enumerate(articles, 1):
        print(f"\n  [{i}/{len(articles)}] {article['title'][:40]}...")

        # 获取评论 hash
        time.sleep(REQUEST_DELAY)
        sn = get_comment_hash(article["url"])
        if not sn:
            print(f"    [SKIP] 无法获取评论 hash")
            continue

        # 获取评论数据
        time.sleep(REQUEST_DELAY)
        comments_data = get_comments(sn, fetch_all=args.all_comments)
        hot_count = len(comments_data["hot_comments"])
        all_count = len(comments_data["comments"])
        print(f"    热门: {hot_count} 条, 最新: {all_count} 条")

        all_results.append((article, comments_data))

    # Step 3: 输出结果
    print(f"\n[3/3] 输出结果...")
    if args.output:
        save_to_csv(all_results, args.output)
    else:
        for article, comments_data in all_results:
            print_comments(article, comments_data)

    # 汇总统计
    total_hot = sum(len(cd["hot_comments"]) for _, cd in all_results)
    total_all = sum(len(cd["comments"]) for _, cd in all_results)
    print(f"\n{'='*70}")
    print(f"[完成] 共爬取 {len(all_results)} 篇文章, "
          f"热门评论 {total_hot} 条, 最新评论 {total_all} 条")
    print(f"{'='*70}")


if __name__ == "__main__":
    main()
