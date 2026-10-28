import { ArgumentMetadata } from '@nestjs/common';
import { RpcException } from '@nestjs/microservices';
import { IsString, MinLength } from 'class-validator';
import {
  AuthenticatedPayloadDto,
  WithAuthUser,
} from '../dto/identity/authenticated-payload.dto';
import { UpdateUserPayloadDto } from '../dto/user/update-user-payload.dto';
import { createRpcValidationPipe } from './rpc-validation.pipe';

const pipe = createRpcValidationPipe();
const meta = (metatype: ArgumentMetadata['metatype']): ArgumentMetadata => ({
  type: 'body',
  metatype,
});
const UUID = '3f1c9a52-6b0e-4d8a-9c1e-2a7b5d4e8f10';

/** Chạy pipe với payload sai, trả về danh sách `errors` trong RpcException. */
const errorsOf = async (
  payload: unknown,
  metatype: ArgumentMetadata['metatype'],
) => {
  try {
    await pipe.transform(payload, meta(metatype));
  } catch (error) {
    expect(error).toBeInstanceOf(RpcException);
    return ((error as RpcException).getError() as { errors: unknown[] }).errors;
  }
  throw new Error('Expected validation to fail');
};

describe('createRpcValidationPipe: lỗi lồng nhau', () => {
  class TitleDto {
    @IsString()
    @MinLength(1)
    title: string;
  }
  class TitlePayloadDto extends WithAuthUser(TitleDto) {}

  it('lỗi trong `user` -> đường dẫn user.userId / user.role kèm constraints', async () => {
    const errors = await errorsOf(
      { user: { userId: 'x', role: 'ROOT' } },
      AuthenticatedPayloadDto,
    );
    expect(errors).toEqual([
      { field: 'user.userId', constraints: { isUuid: expect.any(String) } },
      { field: 'user.role', constraints: { isIn: expect.any(String) } },
    ]);
  });

  it('lỗi trong `data` -> data.title, field lạ -> data.ownerId', async () => {
    const errors = await errorsOf(
      {
        user: { userId: UUID, role: 'USER' },
        data: { title: '', ownerId: UUID },
      },
      TitlePayloadDto,
    );
    expect(errors).toHaveLength(2);
    expect(errors).toEqual(
      expect.arrayContaining([
        { field: 'data.title', constraints: { minLength: expect.any(String) } },
        {
          field: 'data.ownerId',
          constraints: { whitelistValidation: expect.any(String) },
        },
      ]),
    );
  });

  it('thiếu cả object lồng nhau -> lỗi ở cấp ngoài (user / data)', async () => {
    const errors = (await errorsOf({}, TitlePayloadDto)) as {
      field: string;
    }[];
    expect(errors.map((e) => e.field).sort()).toEqual(['data', 'user']);
  });

  it('payload có sẵn trước PR (user.update) cũng có chi tiết: data.displayName', async () => {
    const errors = await errorsOf(
      { id: UUID, data: { displayName: '' } },
      UpdateUserPayloadDto,
    );
    expect(errors).toEqual([
      {
        field: 'data.displayName',
        constraints: expect.objectContaining({
          isNotEmpty: expect.any(String),
        }),
      },
    ]);
  });
});
