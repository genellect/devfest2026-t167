import { afterEach, expect, it, vi } from 'vitest';
import { retainUnsavedAudio, unsavedAudio, recoveryAudio, releaseUnsavedAudio, expireRoomRecordings, type RecoveryRecording } from './recording-recovery';
afterEach(()=>{vi.unstubAllGlobals();});
const manifest=(id:string,uid:string,deleteAfter?:number):RecoveryRecording=>({id,uid,roomId:'room',createdAt:Date.now(),mimeType:'audio/webm',complete:true,chunks:1,deleteAfter});
it('メモリに保護した録音を本人だけに表示し、期限を過ぎたら消す',async()=>{
  retainUnsavedAudio(manifest('one','a',Date.now()+60000),new Blob(['audio']));retainUnsavedAudio(manifest('old','a',Date.now()-1),new Blob(['old']));
  expect(unsavedAudio('a').map(v=>v.recording.id)).toEqual(['one']);expect(unsavedAudio('b')).toEqual([]);expect(await(await recoveryAudio('a','one')).text()).toBe('audio');releaseUnsavedAudio('one');
});
it('一覧を開かなくても期限切れの音声をダウンロードさせない',async()=>{
  retainUnsavedAudio(manifest('expired','a',Date.now()-1),new Blob(['old']));await expect(recoveryAudio('a','expired')).rejects.toThrow('保存期限');expect(unsavedAudio('a')).toEqual([]);
});
it('端末DBが利用できない場合もメモリ上の期限切れ録音を削除する',async()=>{
  vi.stubGlobal('indexedDB',{open:()=>{throw new Error('storage unavailable');}});
  retainUnsavedAudio(manifest('unwritten','a'),new Blob(['audio']));await expect(expireRoomRecordings('a','room',Date.now()-1)).rejects.toThrow();expect(unsavedAudio('a')).toEqual([]);
});
