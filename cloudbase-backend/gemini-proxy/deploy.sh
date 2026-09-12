#!/usr/bin/env bash
# 一键部署 Gemini 中转 Worker 到 Cloudflare（纯 API，不需要浏览器）
#
# 用法：
#   export CF_API_TOKEN="你的Cloudflare令牌"
#   export GEMINI_API_KEY="AIza..."
#   export PROXY_TOKEN="随机长串"
#   export SCRIPT_NAME="haoqiu-gemini"   # 可选，默认 haoqiu-gemini
#   bash deploy.sh
#
# 令牌创建：https://dash.cloudflare.com/profile/api-tokens
#   用「编辑 Cloudflare Workers」模板即可（需要 Workers Scripts:Edit 权限）

set -euo pipefail

DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SCRIPT_NAME="${SCRIPT_NAME:-haoqiu-gemini}"
COMPAT_DATE="$(date +%Y-%m-%d)"

: "${CF_API_TOKEN:?需要 CF_API_TOKEN}"
: "${GEMINI_API_KEY:?需要 GEMINI_API_KEY}"
: "${PROXY_TOKEN:?需要 PROXY_TOKEN}"

API="https://api.cloudflare.com/client/v4"
auth=(-H "Authorization: Bearer ${CF_API_TOKEN}")

echo "▸ 查账号 ID..."
ACC=$(curl -sS "${API}/accounts" "${auth[@]}" \
  | /usr/bin/python3 -c 'import sys,json;d=json.load(sys.stdin);r=d.get("result") or [];print(r[0]["id"] if r else "")')
if [ -z "$ACC" ]; then echo "✗ 拿不到 account id，检查令牌权限"; exit 1; fi
echo "  account = $ACC"

echo "▸ 部署 Worker 代码 ($SCRIPT_NAME)..."
cat > "$DIR/.metadata.json" <<EOF
{"main_module":"worker.js","compatibility_date":"${COMPAT_DATE}"}
EOF

DEPLOY=$(curl -sS -X PUT \
  "${API}/accounts/${ACC}/workers/scripts/${SCRIPT_NAME}" \
  "${auth[@]}" \
  -F "metadata=@${DIR}/.metadata.json;type=application/json" \
  -F "worker.js=@${DIR}/worker.js;type=application/javascript+module")

if ! echo "$DEPLOY" | /usr/bin/python3 -c 'import sys,json;sys.exit(0 if json.load(sys.stdin).get("success") else 1)'; then
  echo "✗ 部署失败："
  echo "$DEPLOY" | /usr/bin/python3 -m json.tool 2>/dev/null || echo "$DEPLOY"
  rm -f "$DIR/.metadata.json"
  exit 1
fi
echo "  代码已上传"

echo "▸ 开启 workers.dev 子域名..."
curl -sS -X POST \
  "${API}/accounts/${ACC}/workers/scripts/${SCRIPT_NAME}/subdomain" \
  "${auth[@]}" -H 'Content-Type: application/json' \
  -d '{"enabled":true}' > /dev/null

echo "▸ 写入密钥 GEMINI_API_KEY / PROXY_TOKEN..."
for pair in "GEMINI_API_KEY:${GEMINI_API_KEY}" "PROXY_TOKEN:${PROXY_TOKEN}"; do
  name="${pair%%:*}"
  val="${pair#*:}"
  out=$(NAME="$name" VAL="$val" curl -sS -X PUT \
    "${API}/accounts/${ACC}/workers/scripts/${SCRIPT_NAME}/secrets" \
    "${auth[@]}" -H 'Content-Type: application/json' \
    -d "$(NAME="$name" VAL="$val" /usr/bin/python3 -c '
import json, os
d = dict()
d["name"] = os.environ["NAME"]
d["text"] = os.environ["VAL"]
d["type"] = "secret_text"
print(json.dumps(d))
')")
  if echo "$out" | /usr/bin/python3 -c 'import sys,json;sys.exit(0 if json.load(sys.stdin).get("success") else 1)'; then
    echo "  ✓ $name"
  else
    echo "  ✗ $name 失败：$out"
  fi
done
rm -f "$DIR/.metadata.json"

SUB=$(curl -sS "${API}/accounts/${ACC}/workers/subdomain" "${auth[@]}" \
  | /usr/bin/python3 -c 'import sys,json;print((json.load(sys.stdin).get("result") or {}).get("subdomain",""))')

URL="https://${SCRIPT_NAME}.${SUB}.workers.dev"
echo ""
echo "▸ 探活 $URL/health"
for i in 1 2 3 4 5 6; do
  sleep 3
  body=$(curl -sS --max-time 15 "$URL/health" || true)
  if echo "$body" | grep -q '"ok":true'; then
    echo "  ✓ $body"
    echo ""
    echo "WORKER_URL=$URL"
    exit 0
  fi
  echo "  ...第 $i 次还没好 ($body)"
done

echo "✗ 探活失败，手动打开 $URL/health 看看"
exit 1
