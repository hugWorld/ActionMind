#!/usr/bin/env python3
"""ActionMind 本地 Embedding 服务（fastembed + bge-m3，CPU 推理，无 GPU 依赖）

POST /embed  {"texts": ["...", ...]}  -> {"ok": true, "vectors": [[...]], "dimensions": N, "model": "..."}
GET  /health                         -> {"ok": true, "model": "...", "dimensions": N}

仅使用 Python 标准库 + fastembed，不引入 FastAPI 等额外依赖。
模型下载走 HuggingFace，可用 HF_ENDPOINT=https://hf-mirror.com 指向国内镜像。
"""
import json
import os
import threading
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

MODEL = os.environ.get("EMBEDDING_MODEL", "BAAI/bge-small-zh-v1.5")
PORT = int(os.environ.get("EMBEDDING_PORT", "8765"))


def load_model():
    from fastembed import TextEmbedding

    model = TextEmbedding(model_name=MODEL)
    probe = next(iter(model.embed(["预热"])))
    dims = len(probe)
    return model, dims


model, DIMS = load_model()
# onnxruntime InferenceSession 不保证并发 run 的确定性/线程安全，
# 用全局锁串行化推理，保证同一输入总是产出同一向量（可重复运行）。
EMBED_LOCK = threading.Lock()
print(f"[embed] model={MODEL} dims={DIMS} listening on 127.0.0.1:{PORT}", flush=True)


class Handler(BaseHTTPRequestHandler):
    def log_message(self, *args):
        pass

    def _send(self, code, obj):
        data = json.dumps(obj, ensure_ascii=False).encode("utf-8")
        self.send_response(code)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(data)))
        self.end_headers()
        self.wfile.write(data)

    def do_GET(self):
        if self.path.startswith("/health"):
            self._send(200, {"ok": True, "model": MODEL, "dimensions": DIMS})
        else:
            self._send(404, {"ok": False, "error": "not found"})

    def do_POST(self):
        try:
            length = int(self.headers.get("Content-Length", 0))
            payload = json.loads(self.rfile.read(length) or b"{}")
            texts = payload.get("texts")
            if not isinstance(texts, list) or not texts:
                self._send(400, {"ok": False, "error": "texts 必须是非空字符串数组"})
                return
            if not all(isinstance(t, str) and t.strip() for t in texts):
                self._send(400, {"ok": False, "error": "texts 元素必须是非空字符串"})
                return
            if len(texts) > 100:
                self._send(400, {"ok": False, "error": "单次最多 100 条"})
                return
            with EMBED_LOCK:
                vectors = [v.tolist() for v in model.embed(texts)]
            self._send(200, {"ok": True, "vectors": vectors, "dimensions": DIMS, "model": MODEL})
        except Exception as e:  # noqa: BLE001
            self._send(500, {"ok": False, "error": str(e)})


if __name__ == "__main__":
    ThreadingHTTPServer(("127.0.0.1", PORT), Handler).serve_forever()
