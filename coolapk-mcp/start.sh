#!/bin/bash
cd "$(dirname "$0")"
echo "🔍 启动酷安舆论监测..."
node --experimental-vm-modules web/server.mjs
