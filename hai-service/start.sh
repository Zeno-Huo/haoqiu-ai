#!/usr/bin/env bash
set -euo pipefail

cd "$(dirname "$0")"
exec uvicorn app.main:app --host "${HAOQIU_HOST:-127.0.0.1}" --port "${HAOQIU_PORT:-8000}" --workers 1

