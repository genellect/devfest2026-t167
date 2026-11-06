FROM node:22-bookworm-slim
RUN apt-get update && apt-get install -y --no-install-recommends python3 python3-venv libgomp1 ca-certificates && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY speech ./speech
RUN python3 -m venv /app/speaker-venv && /app/speaker-venv/bin/pip install --no-cache-dir -r speech/requirements.txt && python3 speech/setup_models.py
WORKDIR /app/api
COPY api/package*.json ./
RUN npm ci
COPY api/tsconfig.json ./
COPY api/src ./src
RUN npm run build && npm prune --omit=dev
WORKDIR /app/web
COPY web/package*.json ./
RUN npm ci
COPY web ./
ARG FIREBASE_API_KEY
ARG FIREBASE_AUTH_DOMAIN
ARG FIREBASE_PROJECT_ID
ARG FIREBASE_APP_ID
ENV API_ORIGIN=http://127.0.0.1:8081 NEXT_PUBLIC_FIREBASE_API_KEY=$FIREBASE_API_KEY NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN=$FIREBASE_AUTH_DOMAIN NEXT_PUBLIC_FIREBASE_PROJECT_ID=$FIREBASE_PROJECT_ID NEXT_PUBLIC_FIREBASE_APP_ID=$FIREBASE_APP_ID NEXT_PUBLIC_USE_EMULATORS=0
# next.config.ts is loaded by next start; keep its pinned TypeScript dependency.
RUN npm run build && chown -R node:node /app/web/.next
WORKDIR /app
COPY demo/start.sh demo/wait-for-api.mjs ./demo/
ENV NODE_ENV=production SPEAKER_PYTHON=/app/speaker-venv/bin/python SPEAKER_EMBEDDING_MODEL=/app/.local-data/speaker-models/campplus.onnx SPEAKER_VAD_MODEL=/app/.local-data/speaker-models/silero-vad.onnx
USER node
CMD ["bash", "/app/demo/start.sh"]
