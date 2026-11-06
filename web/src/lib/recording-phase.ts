import type { Room, GroupStatus } from './room';

/** MVPの開始・終了はHostのセッション状態で決まる。グループ集計の配信遅れで録音を止めない。 */
export function recordingPhase(room: Pick<Room, 'flowVersion' | 'phase' | 'endedAt'>, group: number | undefined, status: GroupStatus, showResult: boolean) {
  if (!group) return false;
  if (room.flowVersion === 1) return room.phase === 'discussing' && !room.endedAt;
  return !showResult && status === 'discussing' && room.phase !== 'consensus';
}
