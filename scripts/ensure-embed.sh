#!/usr/bin/env bash
# 幂等拉起 embedding 服务（WSL 后台进程可能被 VM 回收，测试/使用前先 ensure）
# 用法：scripts/ensure-embed.sh   已健康 → 立即退出 0；未运行 → 拉起并等待就绪（最长 120s）
set -e
unset ALL_PROXY HTTP_PROXY HTTPS_PROXY http_proxy https_proxy
export PATH="$HOME/.local/bin:$PATH"
export HF_ENDPOINT="${HF_ENDPOINT:-https://hf-mirror.com}"
export HF_HUB_DISABLE_XET=1
export EMBEDDING_MODEL="${EMBEDDING_MODEL:-BAAI/bge-small-zh-v1.5}"
export EMBEDDING_PORT="${EMBEDDING_PORT:-8765}"
PY="${EMBEDDING_PYTHON:-$HOME/actionmind-embed-venv/bin/python}"
cd "$(dirname "$0")/.."
URL="http://127.0.0.1:${EMBEDDING_PORT}/health"

if curl -s -m 3 "$URL" | grep -q '"ok"'; then
  echo "[ensure-embed] already healthy"
  exit 0
fi

echo "[ensure-embed] starting embed server (first run may download model, up to ~2min)..."
pkill -f embed_server.py 2>/dev/null || true
sleep 1
setsid nohup env HF_ENDPOINT="$HF_ENDPOINT" HF_HUB_DISABLE_XET=1 EMBEDDING_MODEL="$EMBEDDING_MODEL" \
  EMBEDDING_PORT="$EMBEDDING_PORT" "$PY" scripts/embed_server.py \
  > /tmp/embed-server.log 2>&1 < /dev/null &
disown 2>/dev/null || true

for i in $(seq 1 24); do
  if curl -s -m 3 "$URL" | grep -q '"ok"'; then
    echo "[ensure-embed] ready after ${i}0s"
    exit 0
  fi
  sleep 5
done
echo "[ensure-embed] FAILED to become healthy; log tail:"
tail -5 /tmp/embed-server.log 2>/dev/null || true
exit 1
