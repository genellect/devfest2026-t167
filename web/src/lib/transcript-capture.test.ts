import { afterEach, expect, it, vi } from 'vitest';
const mocks=vi.hoisted(()=>({fetch:vi.fn()}));
vi.mock('./session',()=>({authenticatedFetch:mocks.fetch}));
import { TranscriptCapture } from './transcript-capture';
afterEach(()=>{vi.useRealTimers();mocks.fetch.mockReset();});
it('10秒ずつ、停止時の残りも送り、元のPCMを書き換えず送信後に解放する',async()=>{
  const copies:ArrayBuffer[]=[];mocks.fetch.mockImplementation(async(_path:string,init:RequestInit)=>{copies.push(init.body as ArrayBuffer);return Response.json({ok:true});});
  const capture=new TranscriptCapture('room',vi.fn()),pcm=new Int16Array(16000).fill(3);
  for(let i=0;i<12;i++)capture.feed(pcm);await capture.stop();
  expect(mocks.fetch).toHaveBeenCalledTimes(2);expect(mocks.fetch.mock.calls.map(c=>c[0])).toEqual([expect.stringContaining('sequence=0&capture='),expect.stringContaining('sequence=1&capture=')]);
  expect(copies.map(b=>b.byteLength)).toEqual([320000,64000]);expect(new Int16Array(copies[0]).every(n=>n===0)).toBe(true);expect(pcm[0]).toBe(3);
});
it('同じバッファと番号で一時失敗を再送する',async()=>{
  vi.useFakeTimers();mocks.fetch.mockResolvedValueOnce(Response.json({error:{code:'transcription_running'}},{status:409})).mockResolvedValueOnce(Response.json({ok:true}));
  const capture=new TranscriptCapture('room',vi.fn());capture.feed(new Int16Array(16000));const stopping=capture.stop();await vi.runAllTimersAsync();await stopping;
  expect(mocks.fetch.mock.calls[0][0]).toBe(mocks.fetch.mock.calls[1][0]);expect(mocks.fetch.mock.calls[0][1].body).toBe(mocks.fetch.mock.calls[1][1].body);
});
it('認証失効では繰り返し送らず、元の録音へ戻す案内を出す',async()=>{
  mocks.fetch.mockResolvedValue(Response.json({error:{code:'session_revoked'}},{status:401}));const error=vi.fn(),capture=new TranscriptCapture('room',error);
  capture.feed(new Int16Array(16000));await capture.stop();expect(mocks.fetch).toHaveBeenCalledOnce();expect(error).toHaveBeenCalledOnce();
});
