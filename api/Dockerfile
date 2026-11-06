FROM node:22-slim AS build
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY tsconfig.json ./
COPY src ./src
RUN npm run build

FROM node:22-slim
WORKDIR /app
ENV NODE_ENV=production
RUN apt-get update && apt-get install -y --no-install-recommends python3 python3-venv ca-certificates && rm -rf /var/lib/apt/lists/*
COPY voice ./voice
RUN python3 -m venv /app/voice/venv && /app/voice/venv/bin/pip install --no-cache-dir -r voice/requirements.txt && /app/voice/venv/bin/python voice/setup.py
ENV MVP_VOICE_PYTHON=/app/voice/venv/bin/python
COPY package*.json ./
RUN npm ci --omit=dev
COPY --from=build /app/dist ./dist
USER node
CMD ["node", "dist/server.js"]
