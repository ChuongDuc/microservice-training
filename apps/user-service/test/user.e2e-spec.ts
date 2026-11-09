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

    it('displayName null -> 400 (không lọt xuống Prisma thành 500)', async () => {
      await expect(
        sendError(USER_PATTERNS.UPDATE, {
          id: created.id,
          data: { displayName: null },
        }),
      ).resolves.toMatchObject({
        statusCode: 400,
        errors: [expect.objectContaining({ field: 'data.displayName' })],
      });
    });

    it('avatar null -> xoá ảnh đại diện', async () => {
      await send(USER_PATTERNS.UPDATE, {
        id: created.id,
        data: { avatar: 'https://example.com/a.png' },
      });
      await expect(
        send(USER_PATTERNS.UPDATE, { id: created.id, data: { avatar: null } }),
      ).resolves.toMatchObject({ avatar: null });
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

  describe('user.admin.* (chỉ ADMIN)', () => {
    // Tag riêng cho lần chạy: chỉ đếm user tạo trong describe này
    const tag = `tag${Date.now()}`;
    /** Danh tính người gọi; User Service đối chiếu role/status với DB. */
    let admin: { userId: string; role: string };
    let normal: { userId: string; role: string };
    let an: { id: string };
    let binh: { id: string };

    /** Tạo user rồi đặt role ADMIN trực tiếp trong DB (không có tag: không lọt vào kết quả tìm kiếm). */
    const createAdmin = async (name: string) => {
      const created = await send(USER_PATTERNS.CREATE, {
        email: email(`${name}-${Date.now()}`),
        displayName: name,
      });
      await prisma.user.update({
        where: { id: created.id },
        data: { role: 'ADMIN' },
      });
      return { userId: created.id as string, role: 'ADMIN' };
    };

    beforeAll(async () => {
      admin = await createAdmin('root');
      const plain = await send(USER_PATTERNS.CREATE, {
        email: email(`plain-${Date.now()}`),
        displayName: 'plain',
      });
      normal = { userId: plain.id, role: 'USER' };
      an = await send(USER_PATTERNS.CREATE, {
        email: email(`admin-an-${tag}`),
        displayName: `Nguyễn An ${tag}`,
      });
      binh = await send(USER_PATTERNS.CREATE, {
        email: email(`admin-binh-${tag}`),
        displayName: `TRẦN BÌNH 50%_off ${tag}`,
      });
    });

    it('admin.list: tìm theo email hoặc tên, không phân biệt hoa thường', async () => {
      const all = await send(USER_PATTERNS.ADMIN_LIST, {
        user: admin,
        data: { search: tag.toUpperCase() },
      });
      expect(all.total).toBe(2);

      const byName = await send(USER_PATTERNS.ADMIN_LIST, {
        user: admin,
        data: { search: `trần bình 50%_off ${tag}` },
      });
      expect(byName.items).toEqual([expect.objectContaining({ id: binh.id })]);

      const byEmail = await send(USER_PATTERNS.ADMIN_LIST, {
        user: admin,
        data: { search: `admin-an-${tag}` },
      });
      expect(byEmail.items).toEqual([expect.objectContaining({ id: an.id })]);
    });

    it('admin.list: % và _ là ký tự thường, không phải wildcard của LIKE', async () => {
      const percent = await send(USER_PATTERNS.ADMIN_LIST, {
        user: admin,
        data: { search: '%_', limit: 100 },
      });
      for (const u of percent.items) {
        expect(`${u.email} ${u.displayName}`).toContain('%_');
      }
      expect(percent.items).toEqual(
        expect.arrayContaining([expect.objectContaining({ id: binh.id })]),
      );
    });

    it('admin.list: lọc theo status/role, phân trang', async () => {
      await send(USER_PATTERNS.ADMIN_UPDATE_STATUS, {
        user: admin,
        data: { id: binh.id, status: 'BLOCKED' },
      });
      const blocked = await send(USER_PATTERNS.ADMIN_LIST, {
        user: admin,
        data: { search: tag, status: 'BLOCKED' },
      });
      expect(blocked.items).toEqual([
        expect.objectContaining({ id: binh.id, status: 'BLOCKED' }),
      ]);

      const page2 = await send(USER_PATTERNS.ADMIN_LIST, {
        user: admin,
        data: { search: tag, page: 2, limit: 1 },
      });
      expect(page2).toMatchObject({
        total: 2,
        page: 2,
        limit: 1,
        totalPages: 2,
      });
      expect(page2.items).toHaveLength(1);
    });

    it('admin.update_role / update_status: đổi được role và mở khoá', async () => {
      await expect(
        send(USER_PATTERNS.ADMIN_UPDATE_ROLE, {
          user: admin,
          data: { id: an.id, role: 'ADMIN' },
        }),
      ).resolves.toMatchObject({ id: an.id, role: 'ADMIN' });
      await expect(
        send(USER_PATTERNS.ADMIN_UPDATE_STATUS, {
          user: admin,
          data: { id: binh.id, status: 'ACTIVE' },
        }),
      ).resolves.toMatchObject({ id: binh.id, status: 'ACTIVE' });
    });

    it('người gọi role USER -> 403 với mọi message admin, DB không đổi', async () => {
      for (const [pattern, data] of [
        [USER_PATTERNS.ADMIN_LIST, {}],
        [USER_PATTERNS.ADMIN_UPDATE_ROLE, { id: binh.id, role: 'ADMIN' }],
        [USER_PATTERNS.ADMIN_UPDATE_STATUS, { id: binh.id, status: 'BLOCKED' }],
      ] as const) {
        await expect(
          sendError(pattern, { user: normal, data }),
        ).resolves.toMatchObject({ statusCode: 403 });
      }
      await expect(
        prisma.user.findUnique({ where: { id: binh.id } }),
      ).resolves.toMatchObject({ role: 'USER', status: 'ACTIVE' });
    });

    it('tự đổi role / tự khoá chính mình -> 400', async () => {
      const self = { userId: an.id, role: 'ADMIN' };
      await expect(
        sendError(USER_PATTERNS.ADMIN_UPDATE_ROLE, {
          user: self,
          data: { id: an.id, role: 'USER' },
        }),
      ).resolves.toMatchObject({ statusCode: 400 });
      await expect(
        sendError(USER_PATTERNS.ADMIN_UPDATE_STATUS, {
          user: self,
          data: { id: an.id, status: 'BLOCKED' },
        }),
      ).resolves.toMatchObject({ statusCode: 400 });
    });

    it('user không tồn tại -> 404; role/status sai -> 400', async () => {
      await expect(
        sendError(USER_PATTERNS.ADMIN_UPDATE_ROLE, {
          user: admin,
          data: { id: '00000000-0000-4000-8000-000000000000', role: 'USER' },
        }),
      ).resolves.toMatchObject({ statusCode: 404 });
      await expect(
        sendError(USER_PATTERNS.ADMIN_UPDATE_STATUS, {
          user: admin,
          data: { id: binh.id, status: 'LOCKED' },
        }),
      ).resolves.toMatchObject({ statusCode: 400 });
    });

    it('token cũ ghi ADMIN nhưng DB đã hạ xuống USER / đã khoá -> 403', async () => {
      const demoted = await createAdmin('demoted');
      const blocked = await createAdmin('blocked');
      await send(USER_PATTERNS.ADMIN_UPDATE_ROLE, {
        user: admin,
        data: { id: demoted.userId, role: 'USER' },
      });
      await send(USER_PATTERNS.ADMIN_UPDATE_STATUS, {
        user: admin,
        data: { id: blocked.userId, status: 'BLOCKED' },
      });

      // `role: 'ADMIN'` vẫn còn trong payload (giống access token chưa hết hạn)
      for (const stale of [demoted, blocked]) {
        await expect(
          sendError(USER_PATTERNS.ADMIN_UPDATE_ROLE, {
            user: stale,
            data: { id: admin.userId, role: 'USER' },
          }),
        ).resolves.toMatchObject({ statusCode: 403 });
        await expect(
          sendError(USER_PATTERNS.ADMIN_LIST, { user: stale, data: {} }),
        ).resolves.toMatchObject({ statusCode: 403 });
      }
      await expect(
        prisma.user.findUnique({ where: { id: admin.userId } }),
      ).resolves.toMatchObject({ role: 'ADMIN', status: 'ACTIVE' });
    });

    it('hai admin hạ quyền lẫn nhau cùng lúc -> chỉ một bên thành công, vẫn còn admin', async () => {
      for (let round = 0; round < 5; round++) {
        const a = await createAdmin(`race-a-${round}`);
        const b = await createAdmin(`race-b-${round}`);
        const results = await Promise.allSettled([
          send(USER_PATTERNS.ADMIN_UPDATE_ROLE, {
            user: a,
            data: { id: b.userId, role: 'USER' },
          }),
          send(USER_PATTERNS.ADMIN_UPDATE_ROLE, {
            user: b,
            data: { id: a.userId, role: 'USER' },
          }),
        ]);
        const ok = results.filter((r) => r.status === 'fulfilled');
        const failed = results.filter(
          (r): r is PromiseRejectedResult => r.status === 'rejected',
        );
        expect(ok).toHaveLength(1);
        // 409: Postgres huỷ transaction (Serializable); 403: bên kia đã commit trước
        expect([403, 409]).toContain(failed[0].reason.statusCode);
        const remaining = await prisma.user.count({
          where: {
            id: { in: [a.userId, b.userId] },
            role: 'ADMIN',
            status: 'ACTIVE',
          },
        });
        expect(remaining).toBe(1);
      }
    });
  });

  describe(USER_PATTERNS.FIND_ME, () => {
    let created: { id: string };

    beforeAll(async () => {
      created = await send(USER_PATTERNS.CREATE, {
        email: email('find-me'),
        displayName: 'Chi',
      });
    });

    it('trả hồ sơ theo userId trong danh tính người gọi', async () => {
      await expect(
        send(USER_PATTERNS.FIND_ME, {
          user: { userId: created.id, role: 'USER' },
        }),
      ).resolves.toMatchObject({ id: created.id, email: email('find-me') });
    });

    it('user không còn tồn tại -> 404', async () => {
      await expect(
        sendError(USER_PATTERNS.FIND_ME, {
          user: {
            userId: '00000000-0000-4000-8000-000000000000',
            role: 'USER',
          },
        }),
      ).resolves.toMatchObject({ statusCode: 404 });
    });

    it('lỗi validate trong user -> chỉ ra đường dẫn field (user.role)', async () => {
      const error = await sendError(USER_PATTERNS.FIND_ME, {
        user: { userId: created.id, role: 'ROOT' },
      });
      expect(error).toMatchObject({
        statusCode: 400,
        errors: [
          { field: 'user.role', constraints: { isIn: expect.any(String) } },
        ],
      });
    });

    it.each([
      ['thiếu user', {}],
      [
        'gửi id thay vì danh tính',
        { id: '00000000-0000-4000-8000-000000000000' },
      ],
      [
        'role không hợp lệ',
        {
          user: {
            userId: '00000000-0000-4000-8000-000000000000',
            role: 'ROOT',
          },
        },
      ],
    ])('payload sai (%s) -> 400', async (_case, payload) => {
      await expect(
        sendError(USER_PATTERNS.FIND_ME, payload),
      ).resolves.toMatchObject({ statusCode: 400 });
    });
  });
});
