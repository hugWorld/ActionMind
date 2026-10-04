#!/usr/bin/env bash
# 启动本地 embedding 服务（fastembed + bge-small-zh-v1.5，CPU）
set -e
export HF_ENDPOINT="${HF_ENDPOINT:-https://hf-mirror.com}"
export EMBEDDING_MODEL="${EMBEDDING_MODEL:-BAAI/bge-small-zh-v1.5}"
export EMBEDDING_PORT="${EMBEDDING_PORT:-8765}"
PY="${EMBEDDING_PYTHON:-$HOME/actionmind-embed-venv/bin/python}"
cd "$(dirname "$0")/.."
exec "$PY" scripts/embed_server.py
