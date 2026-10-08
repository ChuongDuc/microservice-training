import { createRpcValidationPipe, USER_PATTERNS } from '@app/common';
import { INestMicroservice } from '@nestjs/common';
import {
  ClientProxy,
  ClientProxyFactory,
  Transport,
} from '@nestjs/microservices';
import { Test } from '@nestjs/testing';
import { firstValueFrom } from 'rxjs';
import { PrismaService } from '../src/prisma/prisma.service';
import { UserServiceModule } from '../src/user-service.module';

/**
 * E2E: khởi động User Service thật (TCP) và gửi message qua ClientProxy — giống cách
 * Gateway/Auth Service sẽ gọi. Cần Postgres đang chạy và đã migrate user_db.
 */
const PORT = 4102; // cổng riêng cho test, tránh đụng service đang chạy ở 4002
const EMAIL_PREFIX = 'e2e-user-';

describe('User Service (e2e qua TCP)', () => {
  let app: INestMicroservice;
  let client: ClientProxy;
  let prisma: PrismaService;

  /** Gửi message và đợi kết quả (send() trả về Observable). */
  const send = <T = any>(pattern: string, payload: unknown) =>
    firstValueFrom(client.send<T>(pattern, payload));

  /** Gửi message mong đợi lỗi, trả về object lỗi mà service ném ra. */
  const sendError = async (pattern: string, payload: unknown) => {
    try {
      await send(pattern, payload);
    } catch (error) {
      return error;
    }
    throw new Error(`Expected ${pattern} to fail`);
  };

  const email = (name: string) => `${EMAIL_PREFIX}${name}@test.com`;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [UserServiceModule],
    }).compile();

    app = moduleRef.createNestMicroservice({
      transport: Transport.TCP,
      options: { host: '127.0.0.1', port: PORT },
    });
    app.useGlobalPipes(createRpcValidationPipe());
    await app.listen();

    prisma = app.get(PrismaService);
    await prisma.user.deleteMany({
      where: { email: { startsWith: EMAIL_PREFIX } },
    });

    client = ClientProxyFactory.create({
      transport: Transport.TCP,
      options: { host: '127.0.0.1', port: PORT },
    });
    await client.connect();
  });

  afterAll(async () => {
    await prisma?.user.deleteMany({
      where: { email: { startsWith: EMAIL_PREFIX } },
    });
    await client?.close();
    await app?.close();
  });

  describe(USER_PATTERNS.CREATE, () => {
    it('tạo user với role/status mặc định', async () => {
      const user = await send(USER_PATTERNS.CREATE, {
        email: email('create'),
        displayName: 'An',
      });
      expect(user).toMatchObject({
        id: expect.any(String),
        email: email('create'),
        displayName: 'An',
        avatar: null,
        role: 'USER',
        status: 'ACTIVE',
      });
    });

    it('trùng email -> 409', async () => {
      const error = await sendError(USER_PATTERNS.CREATE, {
        email: email('create'),
        displayName: 'An',
      });
      expect(error).toMatchObject({ statusCode: 409 });
    });

    it('payload sai -> 400 kèm chi tiết field', async () => {
      const error = await sendError(USER_PATTERNS.CREATE, {
        email: 'abc',
        displayName: 'An',
        role: 'ADMIN',
      });
      expect(error).toMatchObject({ statusCode: 400 });
      expect(error.errors.map((e: { field: string }) => e.field)).toEqual(
        expect.arrayContaining(['email', 'role']),
      );
    });
  });

  describe(`${USER_PATTERNS.FIND_BY_ID} / ${USER_PATTERNS.FIND_BY_EMAIL}`, () => {
    let created: { id: string };

    beforeAll(async () => {
      created = await send(USER_PATTERNS.CREATE, {
        email: email('find'),
        displayName: 'Bình',
      });
    });

    it('tìm theo id', async () => {
      await expect(
        send(USER_PATTERNS.FIND_BY_ID, { id: created.id }),
      ).resolves.toMatchObject({ id: created.id, email: email('find') });
    });

    it('tìm theo email', async () => {
      await expect(
        send(USER_PATTERNS.FIND_BY_EMAIL, { email: email('find') }),
      ).resolves.toMatchObject({ id: created.id });
    });

    it('không tìm thấy -> 404', async () => {
      await expect(
        sendError(USER_PATTERNS.FIND_BY_ID, {
          id: '00000000-0000-4000-8000-000000000000',
        }),
      ).resolves.toMatchObject({ statusCode: 404 });
      await expect(
        sendError(USER_PATTERNS.FIND_BY_EMAIL, { email: email('none') }),
      ).resolves.toMatchObject({ statusCode: 404 });
    });

    it('id không phải UUID -> 400', async () => {
      await expect(
        sendError(USER_PATTERNS.FIND_BY_ID, { id: '123' }),
      ).resolves.toMatchObject({ statusCode: 400 });
    });
  });

  describe(USER_PATTERNS.UPDATE, () => {
    let created: { id: string };

    beforeAll(async () => {
      created = await send(USER_PATTERNS.CREATE, {
        email: email('update'),
        displayName: 'Cường',
      });
    });

    it('cập nhật displayName/avatar', async () => {
      await expect(
        send(USER_PATTERNS.UPDATE, {
          id: created.id,
          data: { displayName: 'Cường 2', avatar: 'https://x.com/a.png' },
        }),
      ).resolves.toMatchObject({
        id: created.id,
        displayName: 'Cường 2',
        avatar: 'https://x.com/a.png',
      });
    });

    it('không cho đổi email/role -> 400', async () => {
      await expect(
        sendError(USER_PATTERNS.UPDATE, {
          id: created.id,
          data: { email: email('hack'), role: 'ADMIN' },
        }),
      ).resolves.toMatchObject({ statusCode: 400 });
    });

    it('không tìm thấy -> 404', async () => {
      await expect(
        sendError(USER_PATTERNS.UPDATE, {
          id: '00000000-0000-4000-8000-000000000000',
          data: { displayName: 'X' },
        }),
      ).resolves.toMatchObject({ statusCode: 404 });
    });
  });

  describe(USER_PATTERNS.LIST, () => {
    it('trả về danh sách có phân trang', async () => {
      const result = await send(USER_PATTERNS.LIST, { page: 1, limit: 2 });
      expect(result).toMatchObject({ page: 1, limit: 2 });
      expect(result.items.length).toBeLessThanOrEqual(2);
      expect(result.total).toBeGreaterThanOrEqual(3); // đã tạo 3 user ở trên
      expect(result.totalPages).toBe(Math.ceil(result.total / 2));
    });

    it('dùng mặc định khi không truyền page/limit', async () => {
      await expect(send(USER_PATTERNS.LIST, {})).resolves.toMatchObject({
        page: 1,
        limit: 10,
      });
    });

    it('limit > 100 -> 400', async () => {
      await expect(
        sendError(USER_PATTERNS.LIST, { limit: 101 }),
      ).resolves.toMatchObject({ statusCode: 400 });
    });
  });
});
