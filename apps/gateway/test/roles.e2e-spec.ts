import { JWT_ALGORITHM, UserRole } from '@app/common';
import { Controller, Get, INestApplication } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { Test } from '@nestjs/testing';
import { randomUUID } from 'crypto';
import * as request from 'supertest';
import { Public } from '../src/auth/public.decorator';
import { Roles } from '../src/auth/roles.decorator';
import { GatewayModule } from '../src/gateway.module';

/**
 * E2E: RolesGuard toàn cục chạy thật trong Gateway, sau JwtAuthGuard. Route dùng để
 * kiểm tra chỉ khai báo trong test (không thêm route giả vào Gateway); endpoint admin
 * thật là /admin/users (#22). Không cần service nào phía trong.
 */
@Roles('ADMIN')
@Controller('rbac-probe/admin')
class AdminProbeController {
  /** Kế thừa @Roles('ADMIN') của controller. */
  @Get()
  adminOnly() {
    return { ok: 'admin' };
  }

  /** Route ghi đè: mở cho cả USER. */
  @Roles('USER', 'ADMIN')
  @Get('shared')
  shared() {
    return { ok: 'shared' };
  }
}

@Controller('rbac-probe')
class ProbeController {
  /** Không @Roles(): chỉ cần đăng nhập. */
  @Get('any')
  any() {
    return { ok: 'any' };
  }

  /** @Roles() thắng @Public(): vẫn cần đăng nhập với đúng role. */
  @Public()
  @Roles('ADMIN')
  @Get('public-admin')
  publicAdmin() {
    return { ok: 'public-admin' };
  }
}

describe('RolesGuard (e2e)', () => {
  let gateway: INestApplication;
  let secret: string;
  const jwt = new JwtService();

  const tokenFor = (role: UserRole) =>
    jwt.signAsync(
      { sub: randomUUID(), role },
      { secret, algorithm: JWT_ALGORITHM, expiresIn: '5m' },
    );
  const get = async (path: string, role?: UserRole) => {
    const req = request(gateway.getHttpServer()).get(path);
    return role
      ? req.set('Authorization', `Bearer ${await tokenFor(role)}`)
      : req;
  };

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [GatewayModule],
      controllers: [AdminProbeController, ProbeController],
    }).compile();
    gateway = moduleRef.createNestApplication();
    await gateway.init();
    secret = gateway.get(ConfigService).getOrThrow('JWT_ACCESS_SECRET');
  });

  afterAll(async () => {
    await gateway?.close();
  });

  it('@Roles("ADMIN"): ADMIN -> 200', async () => {
    const res = await get('/rbac-probe/admin', 'ADMIN');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ ok: 'admin' });
  });

  it('@Roles("ADMIN"): USER -> 403', async () => {
    const res = await get('/rbac-probe/admin', 'USER');
    expect(res.status).toBe(403);
    expect(res.body).toEqual({
      statusCode: 403,
      message: 'Bạn không có quyền truy cập tài nguyên này',
    });
  });

  it('thiếu token -> 401 (JwtAuthGuard chặn trước, không phải 403)', async () => {
    const res = await get('/rbac-probe/admin');
    expect(res.status).toBe(401);
    expect(res.headers['www-authenticate']).toBe('Bearer');
  });

  it('@Roles() ở route ghi đè controller: USER và ADMIN đều 200', async () => {
    expect((await get('/rbac-probe/admin/shared', 'USER')).status).toBe(200);
    expect((await get('/rbac-probe/admin/shared', 'ADMIN')).status).toBe(200);
  });

  it('route không @Roles(): mọi role đã đăng nhập -> 200', async () => {
    expect((await get('/rbac-probe/any', 'USER')).status).toBe(200);
    expect((await get('/rbac-probe/any', 'ADMIN')).status).toBe(200);
  });

  it('@Public() + @Roles("ADMIN"): không token 401, USER 403, ADMIN 200', async () => {
    expect((await get('/rbac-probe/public-admin')).status).toBe(401);
    expect((await get('/rbac-probe/public-admin', 'USER')).status).toBe(403);
    expect((await get('/rbac-probe/public-admin', 'ADMIN')).status).toBe(200);
  });

  it('route có sẵn của Gateway (GET /auth/me) vẫn chạy với USER', async () => {
    const res = await get('/auth/me', 'USER');
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ role: 'USER' });
  });
});
