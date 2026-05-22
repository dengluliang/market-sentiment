# -*- coding: utf-8 -*-
"""
酷安(Coolapk)搜索爬虫
基于酷安App API接口，通过模拟App请求获取搜索结果和评论
仅供学习研究使用
"""

import requests
import time
import hashlib
import base64
import json
import csv
import os
import uuid
from datetime import datetime

# 设备ID（随机生成）
DEVICE_ID = str(uuid.uuid4())

# 酷安API基础配置
BASE_URL = "https://api.coolapk.com/v6"
APP_VERSION = "13.4.1"
APP_VERSION_CODE = "2312121"


def get_app_token():
    """生成酷安App Token"""
    t = int(time.time())
    hex_t = hex(t)
    # 时间戳MD5
    md5_t = hashlib.md5(str(t).encode('utf-8')).hexdigest()
    # 拼接加密字符串
    a = 'token://com.coolapk.market/c67ef5943784d09750dcfbb31020f0ab?{}${}&com.coolapk.market'.format(
        md5_t, DEVICE_ID
    )
    # 二次加密
    md5_a = hashlib.md5(base64.b64encode(a.encode('utf-8'))).hexdigest()
    token = '{}{}{}'.format(md5_a, DEVICE_ID, hex_t)
    return token


def get_headers():
    """构造请求头"""
    return {
        "User-Agent": f"Dalvik/2.1.0 (Linux; U; Android 13; Pixel 7 Pro Build/TQ3A.230901.001) (#Build; Google; Pixel 7 Pro; TQ3A.230901.001; 13) +CoolMarket/{APP_VERSION}",
        "X-App-Id": "com.coolapk.market",
        "X-Requested-With": "XMLHttpRequest",
        "X-Sdk-Int": "33",
        "X-Sdk-Locale": "zh-CN",
        "X-Api-Version": "13",
        "X-App-Version": APP_VERSION,
        "X-App-Code": APP_VERSION_CODE,
        "X-App-Device": "QRTBCOgkUTgsTat9WYphFI7kWbvFWaYByO1YjOCdjOxAjOxEkOFJjODlDI7ATNxMjM5MTOxcjMwAjN0AyOxEjNwgDNxITM2kDMzcTOgsTZzkTZlJ2MwUDNhJ2MyYzM",
        "Host": "api.coolapk.com",
        "X-Dark-Mode": "0",
        "X-App-Token": get_app_token(),
        "Content-Type": "application/x-www-form-urlencoded",
    }


def search_feed(keyword, page=1, sort="default"):
    """
    搜索酷安动态/帖子
    sort: default(默认), hot(最热), reply(最多回复)
    """
    url = f"{BASE_URL}/search"
    params = {
        "type": "feed",
        "feedType": "all",
        "sort": sort,
        "searchValue": keyword,
        "page": page,
        "showAnonymous": "-1",
    }
    
    try:
        resp = requests.get(url, params=params, headers=get_headers(), timeout=10)
        if resp.status_code == 200:
            data = resp.json()
            if data.get("data"):
                return data["data"]
        print(f"  [search_feed] 请求失败: status={resp.status_code}, body={resp.text[:200]}")
    except Exception as e:
        print(f"  [search_feed] 请求异常: {e}")
    return []


def get_feed_reply(feed_id, page=1):
    """获取帖子的评论/回复"""
    url = f"{BASE_URL}/feed/replyList"
    params = {
        "id": feed_id,
        "listType": "lastupdate_desc",
        "page": page,
        "discussMode": "1",
        "feedType": "feed",
        "blockStatus": "0",
        "fromFeedAuthor": "0",
    }
    
    try:
        resp = requests.get(url, params=params, headers=get_headers(), timeout=10)
        if resp.status_code == 200:
            data = resp.json()
            if data.get("data"):
                return data["data"]
        print(f"  [get_feed_reply] 请求失败 feed_id={feed_id}: status={resp.status_code}")
    except Exception as e:
        print(f"  [get_feed_reply] 请求异常: {e}")
    return []


def crawl_coolapk(keywords, max_pages=10, max_comments_per_feed=50, output_dir=None):
    """
    爬取酷安搜索结果和评论
    
    Args:
        keywords: 关键词列表
        max_pages: 每个关键词最大搜索页数
        max_comments_per_feed: 每个帖子最大评论数
        output_dir: 输出目录
    """
    if output_dir is None:
        output_dir = os.path.join(os.path.dirname(os.path.dirname(__file__)), "data", "coolapk", "csv")
    os.makedirs(output_dir, exist_ok=True)
    
    today = datetime.now().strftime("%Y-%m-%d")
    feeds_file = os.path.join(output_dir, f"search_contents_{today}.csv")
    comments_file = os.path.join(output_dir, f"search_comments_{today}.csv")
    
    all_feeds = []
    all_comments = []
    seen_feed_ids = set()
    
    for keyword in keywords:
        print(f"\n{'='*50}")
        print(f"  搜索关键词: {keyword}")
        print(f"{'='*50}")
        
        for page in range(1, max_pages + 1):
            print(f"  第 {page} 页...")
            feeds = search_feed(keyword, page=page, sort="default")
            
            if not feeds:
                print(f"  第 {page} 页无结果，停止翻页")
                break
            
            for feed in feeds:
                feed_id = feed.get("id") or feed.get("entityId")
                if not feed_id or feed_id in seen_feed_ids:
                    continue
                seen_feed_ids.add(feed_id)
                
                # 提取帖子信息
                feed_info = {
                    "feed_id": feed_id,
                    "title": feed.get("title", ""),
                    "message": (feed.get("message", "") or "")[:500],
                    "username": feed.get("username", ""),
                    "user_id": feed.get("uid", ""),
                    "like_count": feed.get("likenum", 0),
                    "reply_count": feed.get("replynum", 0),
                    "share_count": feed.get("forwardnum", 0),
                    "create_time": feed.get("dateline", ""),
                    "device_title": feed.get("device_title", ""),
                    "ip_location": feed.get("ip_location", ""),
                    "keyword": keyword,
                }
                all_feeds.append(feed_info)
                
                # 爬取评论
                reply_count = feed.get("replynum", 0)
                if reply_count > 0:
                    comment_page = 1
                    comments_collected = 0
                    while comments_collected < max_comments_per_feed:
                        replies = get_feed_reply(feed_id, page=comment_page)
                        if not replies:
                            break
                        
                        for reply in replies:
                            comment_info = {
                                "comment_id": reply.get("id", ""),
                                "feed_id": feed_id,
                                "content": (reply.get("message", "") or "")[:500],
                                "username": reply.get("username", ""),
                                "user_id": reply.get("uid", ""),
                                "like_count": reply.get("likenum", 0),
                                "reply_count": reply.get("replynum", 0),
                                "create_time": reply.get("dateline", ""),
                                "ip_location": reply.get("ip_location", ""),
                                "device_title": reply.get("device_title", ""),
                            }
                            all_comments.append(comment_info)
                            comments_collected += 1
                        
                        comment_page += 1
                        time.sleep(0.5)  # 避免请求过快
                    
                    if comments_collected > 0:
                        print(f"    帖子 {feed_id}: 获取 {comments_collected} 条评论")
            
            time.sleep(1)  # 翻页间隔
    
    # 保存帖子数据
    if all_feeds:
        with open(feeds_file, 'w', newline='', encoding='utf-8-sig') as f:
            writer = csv.DictWriter(f, fieldnames=all_feeds[0].keys())
            writer.writeheader()
            writer.writerows(all_feeds)
        print(f"\n帖子数据已保存: {feeds_file} ({len(all_feeds)} 条)")
    
    # 保存评论数据
    if all_comments:
        with open(comments_file, 'w', newline='', encoding='utf-8-sig') as f:
            writer = csv.DictWriter(f, fieldnames=all_comments[0].keys())
            writer.writeheader()
            writer.writerows(all_comments)
        print(f"评论数据已保存: {comments_file} ({len(all_comments)} 条)")
    
    print(f"\n{'='*50}")
    print(f"  酷安爬取完成！")
    print(f"  帖子总数: {len(all_feeds)}")
    print(f"  评论总数: {len(all_comments)}")
    print(f"{'='*50}")
    
    return all_feeds, all_comments


if __name__ == "__main__":
    # 搜索关键词
    keywords = ["小米17发热", "小米17卡顿"]
    
    # 开始爬取
    crawl_coolapk(
        keywords=keywords,
        max_pages=10,
        max_comments_per_feed=50,
    )
