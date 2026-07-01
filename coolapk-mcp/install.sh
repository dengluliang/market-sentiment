#!/bin/bash
set -e
INSTALL_DIR="${1:-$HOME/.brick/plugins/coolapk-mcp}"
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
echo "📦 安装酷安 MCP 到 $INSTALL_DIR"
mkdir -p "$INSTALL_DIR"
cp -r "$SCRIPT_DIR"/bin "$INSTALL_DIR/"
cp -r "$SCRIPT_DIR"/src "$INSTALL_DIR/"
cp -r "$SCRIPT_DIR"/web "$INSTALL_DIR/"
cp "$SCRIPT_DIR"/mcp-server.js "$INSTALL_DIR/"
cp "$SCRIPT_DIR"/start.sh "$INSTALL_DIR/"
cp "$SCRIPT_DIR"/README.md "$INSTALL_DIR/"
cp "$SCRIPT_DIR"/package.json "$INSTALL_DIR/"
if [ -d "$SCRIPT_DIR/node_modules" ]; then
  echo "📋 复制依赖..."
  rm -rf "$INSTALL_DIR/node_modules"
  cp -r "$SCRIPT_DIR"/node_modules "$INSTALL_DIR/"
else
  echo "📥 安装依赖..."
  cd "$INSTALL_DIR" && npm install 2>&1 | tail -3
fi
echo ""
echo "✅ 安装完成！"
echo "MCP: node $INSTALL_DIR/mcp-server.js"
