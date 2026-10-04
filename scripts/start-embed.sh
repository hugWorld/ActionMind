#!/usr/bin/env bash
# 启动本地 embedding 服务（fastembed + bge-small-zh-v1.5，CPU）
# 注意：huggingface_hub ≥1.31 默认走 Xet 下载协议，hf-mirror 会 401，
# 必须 HF_HUB_DISABLE_XET=1 回退到传统 HTTP 下载。
set -e
export HF_ENDPOINT="${HF_ENDPOINT:-https://hf-mirror.com}"
export HF_HUB_DISABLE_XET=1
export EMBEDDING_MODEL="${EMBEDDING_MODEL:-BAAI/bge-small-zh-v1.5}"
export EMBEDDING_PORT="${EMBEDDING_PORT:-8765}"
PY="${EMBEDDING_PYTHON:-$HOME/actionmind-embed-venv/bin/python}"
cd "$(dirname "$0")/.."
exec "$PY" scripts/embed_server.py
