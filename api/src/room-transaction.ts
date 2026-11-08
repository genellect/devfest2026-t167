import type { Firestore, Transaction } from 'firebase-admin/firestore';
const queues = new WeakMap<Firestore, Map<string, Promise<unknown>>>();
/** 同じプロセス内の短いDB処理を並べ、音声更新によるロックの競合を減らす。
 * モデル呼び出しはこの外で行う。別プロセスとの整合性はFirestoreのトランザクションが担う。 */
export async function roomTransaction<T>(db:Firestore, roomId:string, action:(tx:Transaction)=>Promise<T>):Promise<T>{
  let rooms=queues.get(db);if(!rooms){rooms=new Map();queues.set(db,rooms);}
  const previous=rooms.get(roomId)??Promise.resolve();
  const current=previous.catch(()=>{}).then(()=>db.runTransaction(action));
  rooms.set(roomId,current);
  try{return await current;}finally{
    if(rooms.get(roomId)===current)rooms.delete(roomId);
    if(!rooms.size)queues.delete(db);
  }
}
