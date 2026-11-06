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

const port = Number(process.env.PORT ?? 8080);
createApp({ db: getFirestore(), auth: getAuth(), gemini, observe: (event) => console.info(JSON.stringify({ event: 'api_request', ...event })) }).listen(port, () => {
  console.log(`api listening on :${port} (gemini=${describeGemini(g)})`);
});
