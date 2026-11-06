import { demoFirestore } from './demo-firestore.js';
import { fileURLToPath } from 'node:url';
import { SpeakerWorker } from './voice-worker.js';
import type { VoiceProvider } from './dependencies.js';
import { initializeApp } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';
import { getFirestore } from 'firebase-admin/firestore';
import { googleCredential, readGoogleCredentials } from './google-auth.js';
import { createApp } from './app.js';
import { describeGemini, readConfig } from './config.js';
import { mockGemini, vertexGemini } from './gemini.js';

const config = readConfig(process.env);
const localMock = config.gemini.mock && process.env.FIRESTORE_EMULATOR_HOST && process.env.FIREBASE_AUTH_EMULATOR_HOST;
initializeApp({ projectId: config.project, ...(!localMock ? { credential: googleCredential(process.env) } : {}) });

const g = config.gemini;
const gemini = g.mock
  ? mockGemini({ fail: () => process.env.GEMINI_MOCK_FAIL === '1' })
  : vertexGemini(g.project, g.location, g.model, readGoogleCredentials(process.env));

if (!!process.env.SPEAKER_EMBEDDING_MODEL !== !!process.env.SPEAKER_VAD_MODEL) throw new Error('話者モデルとVADモデルの両方を設定してください');
let voice: VoiceProvider | undefined;
if (process.env.SPEAKER_EMBEDDING_MODEL && process.env.SPEAKER_VAD_MODEL) {
  const worker = new SpeakerWorker(process.env.SPEAKER_PYTHON ?? 'python3', fileURLToPath(new URL('../../speech/worker.py', import.meta.url)));
  voice = { version: process.env.VOICE_MODEL_VERSION ?? 'sherpa-speaker-v1', source: 'model', extract: (pcm) => worker.analyze(pcm) };
  process.once('SIGTERM', () => worker.close()); process.once('SIGINT', () => worker.close());
}
else if (localMock) voice = { version: 'mock-voice-v1', source: 'mock', extract: async (pcm) => ({ embedding: [1, 0, 0, 0], speechMs: pcm.length / 32, segments: [{ startMs: 0, endMs: pcm.length / 32 }] }) };
const port = Number(process.env.PORT ?? 8080);
createApp({ db: demoFirestore(getFirestore(), process.env.DEMO_ID), auth: getAuth(), gemini, voice, observe: (event) => console.info(JSON.stringify({ event: 'api_request', ...event })) }).listen(port, () => {
  console.log(`api listening on :${port} (gemini=${describeGemini(g)})`);
});
