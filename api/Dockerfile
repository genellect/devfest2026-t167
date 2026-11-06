FROM node:22-bookworm-slim AS build
WORKDIR /app/api
COPY api/package*.json ./
RUN npm ci
COPY api/tsconfig.json ./
COPY api/src ./src
RUN npm run build

FROM node:22-bookworm-slim
RUN apt-get update && apt-get install -y --no-install-recommends python3 python3-venv libgomp1 ca-certificates && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY speech ./speech
# 固定版の依存とSHA-256検証済みモデルをビルド時に準備する。起動時に取得しない。
RUN python3 -m venv /app/speaker-venv && /app/speaker-venv/bin/pip install --no-cache-dir -r speech/requirements.txt && python3 speech/setup_models.py
WORKDIR /app/api
ENV NODE_ENV=production
ENV SPEAKER_PYTHON=/app/speaker-venv/bin/python SPEAKER_EMBEDDING_MODEL=/app/.local-data/speaker-models/campplus.onnx SPEAKER_VAD_MODEL=/app/.local-data/speaker-models/silero-vad.onnx
COPY api/package*.json ./
RUN npm ci --omit=dev
COPY --from=build /app/api/dist ./dist
USER node
CMD ["node", "dist/server.js"]
