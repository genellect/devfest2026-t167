import { initializeApp } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';
import { getFirestore } from 'firebase-admin/firestore';
import { createApp } from './app.js';
import { describeGemini, readConfig } from './config.js';
import { mockGemini, vertexGemini } from './gemini.js';

const config = readConfig(process.env);
initializeApp({ projectId: config.project });

const g = config.gemini;
const gemini = g.mock
  ? mockGemini({ fail: () => process.env.GEMINI_MOCK_FAIL === '1' })
  : vertexGemini(g.project, g.location, g.model);

const port = Number(process.env.PORT ?? 8080);
createApp({ db: getFirestore(), auth: getAuth(), gemini, observe: (event) => console.info(JSON.stringify({ event: 'api_request', ...event })) }).listen(port, () => {
  console.log(`api listening on :${port} (gemini=${describeGemini(g)})`);
});
