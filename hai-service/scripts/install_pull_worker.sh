#!/usr/bin/env bash
set -euo pipefail

# 在 HAI 已有 /root/hai-service YOLO 服务上补齐 CloudBase pull worker。
# 不写入 token；token 必须放在 /root/haoqiu-worker.env（chmod 600）。

TARGET_DIR="${1:-/root/hai-service}"
SOURCE_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

if [[ ! -d "$TARGET_DIR" ]]; then
  echo "target missing: $TARGET_DIR" >&2
  exit 1
fi

cp -R "$SOURCE_DIR/pull_worker" "$TARGET_DIR/"
python -m pip install --disable-pip-version-check "httpx>=0.27,<1" "cos-python-sdk-v5>=1.9,<2"

cat <<'EOF'
worker code installed.
Next: create /root/haoqiu-worker.env with the required HAOQIU_* values,
then start it with:
  cd /root/hai-service
  source /root/haoqiu-env/bin/activate
  set -a; source /root/haoqiu-worker.env; set +a
  nohup python -m pull_worker.cloud_main > pull-worker.log 2>&1 &
EOF
