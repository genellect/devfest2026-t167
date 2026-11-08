import { createRequire } from 'node:module';
import { spawn } from 'node:child_process';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import net from 'node:net';

const root = fileURLToPath(new URL('../', import.meta.url));
/** 認証とGoogle APIは実接続、アプリの書込先だけローカルDBへ固定する。 */
export function realGoogleEnv(input, config) {
  if (!input.PROJECT_ID || config.projectId !== input.PROJECT_ID || !config.apiKey || !config.appId || !config.authDomain) throw new Error('対象プロジェクトのFirebase公開Web設定を確認してください');
  const port = Number(input.T167_GOOGLE_PORT ?? 17100);
  if (!Number.isInteger(port) || port < 1024 || port > 65000) throw new Error('T167_GOOGLE_PORTは1024〜65000にしてください');
  const env = { ...input };
  for (const key of ['FIREBASE_AUTH_EMULATOR_HOST','FIREBASE_STORAGE_EMULATOR_HOST','DEMO_ID','GEMINI_MOCK_FAIL','FIREBASE_CONFIG','FIREBASE_WEBAPP_CONFIG']) delete env[key];
  Object.assign(env, {
    GOOGLE_CLOUD_PROJECT:input.PROJECT_ID, GOOGLE_CLOUD_QUOTA_PROJECT:input.PROJECT_ID,
    VERTEX_PROJECT:input.PROJECT_ID, GEMINI_MOCK:'0', CLASSROOM_MOCK:'0', NEXT_PUBLIC_CLASSROOM_MOCK:'0',
    FIRESTORE_EMULATOR_HOST:`127.0.0.1:${port+2}`, PORT:String(port+1), API_ORIGIN:`http://127.0.0.1:${port+1}`,
    NEXT_PUBLIC_USE_EMULATORS:'0', NEXT_PUBLIC_FIREBASE_PROJECT_ID:config.projectId,
    NEXT_PUBLIC_FIREBASE_API_KEY:config.apiKey, NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN:config.authDomain,
    NEXT_PUBLIC_FIREBASE_APP_ID:config.appId, NEXT_PUBLIC_GOOGLE_PROJECT_NUMBER:config.appId.split(':')[1],
    T167_NEXT_DIST_DIR:'.next-real', T167_BIND_LOOPBACK:'1', NEXT_TELEMETRY_DISABLED:'1',
  });
  if (!env.VERTEX_LOCATION || !env.GEMINI_MODEL) throw new Error('infra/env.shのGemini設定を読み込んでください');
  return { env, port };
}
async function waitPort(port, children) {
  for(let i=0;i<180;i++) {
    if(children.some(c=>c.exitCode!==null)) throw new Error('実接続サーバーが停止しました。起動ログを確認してください');
    if(await new Promise(r=>{const s=net.connect(port,'127.0.0.1');s.once('connect',()=>{s.destroy();r(true)});s.once('error',()=>r(false));}))return;
    await new Promise(r=>setTimeout(r,250));
  }
  throw new Error('実接続サーバーの起動を確認できません');
}
async function main() {
  const require=createRequire(join(root,'api/package.json'));
  const { GoogleAuth }=require('google-auth-library');
  const project=process.env.PROJECT_ID;
  if(!/^[a-z][a-z0-9-]+$/.test(project??'')) throw new Error('infra/env.shのPROJECT_IDを確認してください');
  const client=await new GoogleAuth({scopes:['https://www.googleapis.com/auth/cloud-platform']}).getClient();
  let config;
  try {
    const list=await client.request({url:`https://firebase.googleapis.com/v1beta1/projects/${project}/webApps`,timeout:20000});
    const app=list.data.apps?.find(a=>a.displayName===process.env.WEB_APP_NAME)??list.data.apps?.[0];
    if(!app)throw new Error();
    config=(await client.request({url:`https://firebase.googleapis.com/v1beta1/${app.name}/config`,timeout:20000})).data;
  }catch{throw new Error('Firebase公開設定を取得できません。対象プロジェクトにアクセスできる本人のADCログインを確認してください');}
  const {env,port}=realGoogleEnv(process.env,config);
  for(const p of [port,port+1,port+2,port+3,port+4,port+5]) await new Promise((ok,bad)=>{const s=net.createServer();s.once('error',()=>bad(new Error(`ポート${p}が使用中です。T167_GOOGLE_PORTを変えてください`)));s.listen(p,'127.0.0.1',()=>s.close(ok));});
  const dir=await mkdtemp(join(tmpdir(),'t167-real-google-'));
  const cfg=join(dir,'firebase.json');
  await writeFile(cfg,JSON.stringify({firestore:{rules:join(root,'firebase/firestore.rules'),indexes:join(root,'firebase/firestore.indexes.json')},emulators:{firestore:{host:'127.0.0.1',port:port+2,websocketPort:port+5},hub:{host:'127.0.0.1',port:port+3},logging:{host:'127.0.0.1',port:port+4},ui:{enabled:false},singleProjectMode:true}}));
  const children=[];let closing=false;
  const close=async()=>{if(closing)return;closing=true;for(const c of children)try{process.kill(-c.pid,'SIGTERM')}catch{};await rm(dir,{recursive:true,force:true});};
  process.once('SIGTERM',()=>{void close();});process.once('SIGINT',()=>{void close();});
  const launch=(command,args,childEnv=env)=>{const c=spawn(command,args,{cwd:root,env:childEnv,stdio:'inherit',detached:true});children.push(c);c.once('exit',()=>{if(!closing)void close();});return c;};
  try{
    const build=spawn('npm',['--prefix','api','run','build'],{cwd:root,env,stdio:'inherit'});
    await new Promise((ok,bad)=>{build.once('error',bad);build.once('exit',code=>code===0?ok():bad(new Error('APIのビルドに失敗しました')));});
    launch(join(root,'firebase/node_modules/.bin/firebase'),['emulators:start','--config',cfg,'--project',project,'--only','firestore']);
    await waitPort(port+2,children);
    launch(process.execPath,['api/dist/server.js']);await waitPort(port+1,children);
    launch('npm',['--prefix','web','run','dev','--','-H','127.0.0.1','-p',String(port)]);
    await waitPort(port,children);
    console.log(`実Google・実Gemini: http://localhost:${port} （データの保存先は専用ローカルFirestore。17000とは別環境）`);
  }catch(error){await close();throw error;}
}
if(process.argv[1] && resolve(process.argv[1])===fileURLToPath(import.meta.url))main().catch(()=>{console.error('実接続環境の起動に失敗しました。直前の設定・起動ログを確認してください。秘密値は表示しません。');process.exitCode=1;});
