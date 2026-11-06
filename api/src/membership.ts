import { HttpError } from './http.js';
import { groupNumber } from './policy.js';
export async function participantGroup(tx: FirebaseFirestore.Transaction, room: FirebaseFirestore.DocumentSnapshot, uid: string) {
    const member = await tx.get(room.ref.collection('members').doc(uid));
    if (!member.exists || member.get('status') === 'inactive' || member.get('role') !== 'participant') throw new HttpError(403, 'participant_only', '生徒だけが実行できます');
    if (room.get('schemaVersion') >= 3 && !Number.isInteger(member.get('group'))) throw new HttpError(409, 'no_group', '先にグループの割り当てを待ってください');
    const group = groupNumber(member, room.get('groups'));
    if (!group) throw new HttpError(409, 'no_group', '先にグループを選んでください');
    return group;
  }
