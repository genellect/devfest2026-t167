import { expect, it } from 'vitest';
import { classroomMock } from '../../src/classroom-mock.js';
import { classroomFields, classroomIdentity } from '../../src/classroom-routes.js';
import type { AuthRequest } from '../../src/http.js';
it('ローカルモックは架空クラスだけを返し、Driveや実データを使わない', async () => {
  await expect(classroomMock.identity('invalid')).rejects.toMatchObject({code:'google_reconnect'});
  await expect(classroomMock.identity('classroom-mock:')).rejects.toMatchObject({code:'google_reconnect'});
  expect(await classroomMock.identity('classroom-mock:local-teacher')).toBe('local-teacher');
  expect((await classroomMock.courses('classroom-mock:local-teacher'))[0].role).toBe('teacher');
  expect((await classroomMock.courses('classroom-mock:local-student'))[0].role).toBe('student');
  expect(await classroomMock.roster('mock','mock')).toHaveLength(2);
  await expect(classroomMock.material('mock','file')).rejects.toMatchObject({code:'mock_not_supported'});
});
it('クラスIDと全名を維持し、従来のクラス名だけ40文字へ収める', () => {
  expect(classroomFields({id:'c',name:'数学',role:'teacher'})).toEqual({classroomCourseId:'c',classroomCourseName:'数学',className:'数学'});
  const value=classroomFields({id:'c',name:'あ'.repeat(60),section:'1年',role:'teacher'});
  expect(value.className).toHaveLength(40);expect(value.classroomCourseName).toHaveLength(60);expect(value.classroomCourseSection).toBe('1年');
});
it('欠落・過大・空白のGoogleトークンをGoogleへ送らず拒否する', async () => {
  for(const token of [undefined,'x'.repeat(4097),'x y']) {
    const req={header:()=>token,ctx:{}} as unknown as AuthRequest;
    await expect(classroomIdentity(req,classroomMock)).rejects.toMatchObject({code:'google_reconnect'});
  }
});
