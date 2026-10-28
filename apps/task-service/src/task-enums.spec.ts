import { TASK_PRIORITIES, TASK_STATUSES } from '@app/common';
import { TaskPriority, TaskStatus } from '../generated/prisma';

/**
 * TASK_STATUSES / TASK_PRIORITIES (@app/common, dùng để validate DTO) là bản sao của
 * enum trong schema Prisma. Thêm giá trị vào schema mà quên @app/common thì DTO từ
 * chối giá trị mới — test này báo lỗi trước.
 */
describe('Enum task trong @app/common khớp schema Prisma', () => {
  it('TASK_STATUSES = TaskStatus', () => {
    expect([...TASK_STATUSES].sort()).toEqual(Object.values(TaskStatus).sort());
  });

  it('TASK_PRIORITIES = TaskPriority', () => {
    expect([...TASK_PRIORITIES].sort()).toEqual(
      Object.values(TaskPriority).sort(),
    );
  });
});
