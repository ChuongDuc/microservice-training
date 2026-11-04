import { ArgumentMetadata } from '@nestjs/common';
import { RpcException } from '@nestjs/microservices';
import { createRpcValidationPipe } from '../../pipes';
import {
  CreateTaskDto,
  CreateTaskPayloadDto,
  ListTasksDto,
  TASK_TITLE_MAX_LENGTH,
  UpdateTaskDataDto,
  UpdateTaskDto,
} from './task.dto';

const pipe = createRpcValidationPipe();
const meta = (metatype: ArgumentMetadata['metatype']): ArgumentMetadata => ({
  type: 'body',
  metatype,
});
const UUID = '3f1c9a52-6b0e-4d8a-9c1e-2a7b5d4e8f10';
const user = { userId: UUID, role: 'USER' };

const rejects = (payload: unknown, metatype: ArgumentMetadata['metatype']) =>
  expect(pipe.transform(payload, meta(metatype))).rejects.toBeInstanceOf(
    RpcException,
  );

describe('CreateTaskDto', () => {
  it('chỉ cần title, trim khoảng trắng', async () => {
    await expect(
      pipe.transform({ title: '  Viết test  ' }, meta(CreateTaskDto)),
    ).resolves.toEqual({ title: 'Viết test' });
  });

  it('dueDate chuỗi ISO -> Date', async () => {
    const result = await pipe.transform(
      { title: 'x', dueDate: '2026-11-01T10:00:00+07:00' },
      meta(CreateTaskDto),
    );
    expect(result.dueDate).toBeInstanceOf(Date);
    expect(result.dueDate.toISOString()).toBe('2026-11-01T03:00:00.000Z');
  });

  it('dueDate chỉ có ngày -> nửa đêm UTC', async () => {
    const result = await pipe.transform(
      { title: 'x', dueDate: '2026-11-01' },
      meta(CreateTaskDto),
    );
    expect(result.dueDate.toISOString()).toBe('2026-11-01T00:00:00.000Z');
  });

  it('chấp nhận đủ field hợp lệ, description/dueDate null', async () => {
    await expect(
      pipe.transform(
        {
          title: 'x',
          description: null,
          status: 'IN_PROGRESS',
          priority: 'HIGH',
          dueDate: null,
        },
        meta(CreateTaskDto),
      ),
    ).resolves.toMatchObject({ description: null, dueDate: null });
  });

  it.each([
    ['thiếu title', {}],
    ['title chỉ có khoảng trắng', { title: '   ' }],
    ['title quá dài', { title: 'a'.repeat(TASK_TITLE_MAX_LENGTH + 1) }],
    ['status sai', { title: 'x', status: 'DOING' }],
    ['priority sai', { title: 'x', priority: 'URGENT' }],
    ['dueDate không phải ngày', { title: 'x', dueDate: 'mai' }],
    // Trước đây @Type(() => Date) biến các giá trị này thành ngày 1970
    ['dueDate là boolean', { title: 'x', dueDate: true }],
    ['dueDate là số 0', { title: 'x', dueDate: 0 }],
    ['dueDate là timestamp số', { title: 'x', dueDate: 1700000000000 }],
    ['dueDate ngày không tồn tại', { title: 'x', dueDate: '2026-02-30' }],
    ['tự chọn ownerId', { title: 'x', ownerId: UUID }],
  ])('từ chối: %s', async (_case, payload) => {
    await rejects(payload, CreateTaskDto);
  });
});

describe('UpdateTaskDto', () => {
  it('chấp nhận body rỗng và xoá description/dueDate bằng null', async () => {
    await expect(pipe.transform({}, meta(UpdateTaskDto))).resolves.toEqual({});
    await expect(
      pipe.transform({ description: null, dueDate: null }, meta(UpdateTaskDto)),
    ).resolves.toEqual({ description: null, dueDate: null });
  });

  it.each([
    ['title null', { title: null }],
    ['status null', { status: null }],
    ['priority null', { priority: null }],
    ['title rỗng', { title: '' }],
    ['đổi ownerId', { ownerId: UUID }],
  ])('từ chối: %s', async (_case, payload) => {
    await rejects(payload, UpdateTaskDto);
  });

  it('UpdateTaskDataDto bắt buộc id là UUID', async () => {
    await rejects({ title: 'x' }, UpdateTaskDataDto);
    await rejects({ id: '1', title: 'x' }, UpdateTaskDataDto);
    await expect(
      pipe.transform({ id: UUID, title: 'x' }, meta(UpdateTaskDataDto)),
    ).resolves.toEqual({ id: UUID, title: 'x' });
  });
});

describe('ListTasksDto', () => {
  it('mặc định page=1, limit=10, lọc theo status tuỳ chọn', async () => {
    await expect(pipe.transform({}, meta(ListTasksDto))).resolves.toEqual({
      page: 1,
      limit: 10,
    });
    await expect(
      pipe.transform({ status: 'DONE', page: '2' }, meta(ListTasksDto)),
    ).resolves.toEqual({ status: 'DONE', page: 2, limit: 10 });
  });

  it('từ chối status sai và limit > 100', async () => {
    await rejects({ status: 'x' }, ListTasksDto);
    await rejects({ limit: 101 }, ListTasksDto);
  });
});

describe('CreateTaskPayloadDto', () => {
  it('{ user, data } hợp lệ', async () => {
    await expect(
      pipe.transform(
        { user, data: { title: 'x' } },
        meta(CreateTaskPayloadDto),
      ),
    ).resolves.toMatchObject({ user, data: { title: 'x' } });
  });

  it('lỗi trong data báo đường dẫn data.title', async () => {
    await expect(
      pipe.transform({ user, data: { title: '' } }, meta(CreateTaskPayloadDto)),
    ).rejects.toMatchObject({
      error: {
        errors: [expect.objectContaining({ field: 'data.title' })],
      },
    });
  });
});
