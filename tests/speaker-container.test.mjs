import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
const read = (path) => readFileSync(new URL('../' + path, import.meta.url), 'utf8');

test('本番のAPIビルドは音声処理を含むルートcontextと専用Dockerfileを使用する', () => {
  const workflow = read('.github/workflows/deploy.yml');
  assert.match(workflow, /docker build -f api\/Dockerfile -t "\$IMAGE" \./);
  assert.match(workflow, /--cpu 2 --memory 2Gi --concurrency 8 --min-instances 0 --max-instances 2/);
});

test('本番ランタイムにPython・固定依存・モデルを同梱し非rootで起動する', () => {
  const docker = read('api/Dockerfile');
  const runtime = docker.slice(docker.lastIndexOf('\nFROM '));
  for (const value of ['python3-venv', 'libgomp1', 'COPY speech ./speech', 'pip install --no-cache-dir -r speech/requirements.txt', 'python3 speech/setup_models.py', 'WORKDIR /app/api', 'SPEAKER_PYTHON=/app/speaker-venv/bin/python', 'SPEAKER_EMBEDDING_MODEL=/app/.local-data/speaker-models/campplus.onnx', 'SPEAKER_VAD_MODEL=/app/.local-data/speaker-models/silero-vad.onnx', 'USER node']) assert.ok(runtime.includes(value), value);
  assert.match(runtime, /COPY --from=build \/app\/api\/dist \.\/dist/);
  assert.match(runtime, /CMD \["node", "dist\/server.js"\]/);
  assert.match(read('speech/setup_models.py'), /hashlib\.sha256/);
  assert.match(read('speech/requirements.txt'), /sherpa-onnx==/);
  assert.ok(existsSync(new URL('../speech/worker.py', import.meta.url)));
});

test('API専用contextは許可したソースだけを送り、端末内データや秘密を持ち込まない', () => {
  const lines = read('api/Dockerfile.dockerignore').split('\n').map((s) => s.trim()).filter((s) => s && !s.startsWith('#'));
  assert.equal(lines[0], '**');
  assert.deepEqual(lines.filter((s) => s.startsWith('!')), ['!api/', '!api/package.json', '!api/package-lock.json', '!api/tsconfig.json', '!api/src/', '!api/src/**', '!speech/', '!speech/requirements.txt', '!speech/setup_models.py', '!speech/worker.py']);
});
