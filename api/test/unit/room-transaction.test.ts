import { expect, it } from 'vitest';
import type { Firestore, Transaction } from 'firebase-admin/firestore';
import { roomTransaction } from '../../src/room-transaction.js';
const fake=()=>({runTransaction:async(fn:(tx:Transaction)=>Promise<unknown>)=>fn({} as Transaction)}) as unknown as Firestore;
it('同じ部屋のDB処理だけを直列にし、別の部屋を待たせない',async()=>{
  const db=fake(),order:string[]=[];let release!:()=>void;const barrier=new Promise<void>(r=>{release=r;});
  const first=roomTransaction(db,'one',async()=>{order.push('first');await barrier;order.push('released');});
  const second=roomTransaction(db,'one',async()=>{order.push('second');});
  await roomTransaction(db,'other',async()=>{order.push('other');});expect(order).toEqual(['first','other']);release();await Promise.all([first,second]);expect(order).toEqual(['first','other','released','second']);
});
it('前の処理の失敗で次の処理や別DBの同名の部屋を止めない',async()=>{
  const db=fake(),first=roomTransaction(db,'one',async()=>{throw new Error('failure');});
  const second=roomTransaction(db,'one',async()=>42);await expect(first).rejects.toThrow('failure');expect(await second).toBe(42);
  expect(await roomTransaction(fake(),'one',async()=>7)).toBe(7);expect(await roomTransaction(db,'one',async()=>8)).toBe(8);
});
