#!/bin/bash
# 批量爬取所有平台的「小米17发热卡顿」相关评论
# 每个平台依次运行，首次需要扫码登录

export PATH="$HOME/.local/bin:$PATH"
cd "$(dirname "$0")"

echo "======================================"
echo "  舆情数据采集 - 小米17发热卡顿"
echo "  平台: 微博 -> 小红书 -> 抖音 -> B站 -> 知乎"
echo "======================================"

echo ""
echo "[1/5] 开始爬取 微博..."
echo "请准备微博App扫码登录"
uv run main.py --platform wb --lt qrcode --type search
echo "微博爬取完成!"

echo ""
echo "[2/5] 开始爬取 小红书..."
echo "请准备小红书App扫码登录"
uv run main.py --platform xhs --lt qrcode --type search
echo "小红书爬取完成!"

echo ""
echo "[3/5] 开始爬取 抖音..."
echo "请准备抖音App扫码登录"
uv run main.py --platform dy --lt qrcode --type search
echo "抖音爬取完成!"

echo ""
echo "[4/5] 开始爬取 B站..."
echo "请准备B站App扫码登录"
uv run main.py --platform bili --lt qrcode --type search
echo "B站爬取完成!"

echo ""
echo "[5/5] 开始爬取 知乎..."
echo "请准备知乎App扫码登录"
uv run main.py --platform zhihu --lt qrcode --type search
echo "知乎爬取完成!"

echo ""
echo "======================================"
echo "  所有平台爬取完成！"
echo "  数据保存在 ./data 目录下"
echo "======================================"
