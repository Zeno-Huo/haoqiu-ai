#!/usr/bin/env bash
# 一键清理 COS 孤儿数据：自动 cd 到本项目目录、读取 .env.clean 里的腾讯云密钥、运行清理脚本。
# 用法：
#   bash run-clean.sh            # 仅预览清单（dry-run，不删）
#   bash run-clean.sh --apply    # 真正删除（终端会要求输入大写 YES 确认）
set -e
DIR="$(cd "$(dirname "$0")" && pwd)"
cd "$DIR"
if [ ! -f .env.clean ]; then
  echo "缺少 .env.clean（需含 TENCENTCLOUD_SECRETID / TENCENTCLOUD_SECRETKEY），请先创建。"
  exit 1
fi
set -a
source .env.clean
set +a
node scripts/clean-orphans.js "$@"
