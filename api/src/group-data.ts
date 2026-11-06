import type { DocumentSnapshot, Transaction } from 'firebase-admin/firestore';
import { groupNumber } from './policy.js';

/** 新しい複数グループ部屋は索引で絞る。旧形式はグループ省略＝1を維持する。 */
export async function groupMembers(tx: Transaction, room: DocumentSnapshot, group: number) {
  let query = room.ref.collection('members').where('role', '==', 'participant');
  if (room.get('schemaVersion') >= 3 || (room.get('schemaVersion') >= 2 && room.get('groups') > 1)) query = query.where('group', '==', group);
  return (await tx.get(query)).docs.filter((member) => member.get('status') !== 'inactive' && groupNumber(member, room.get('groups')) === group);
}
export async function groupDocuments(tx: Transaction, room: DocumentSnapshot, collection: string, uids: string[], countsOnly = false) {
  if (!uids.length) return [];
  const refs = uids.map((uid) => room.ref.collection(collection).doc(uid));
  const docs = await tx.getAll(...refs, ...(countsOnly ? [{ fieldMask: [] }] : []));
  return docs.filter((doc) => doc.exists);
}
