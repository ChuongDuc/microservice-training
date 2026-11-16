import { INestApplication, Logger } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import * as request from 'supertest';
import { GatewayModule } from '../src/gateway.module';
import { BEARER_AUTH, setupSwagger, SWAGGER_PATH } from '../src/http/swagger';

/**
 * E2E: Swagger UI ở /api và tài liệu OpenAPI ở /api-json của Gateway thật (GatewayModule
 * + setupSwagger như main.ts). Không cần service phía trong: chỉ đọc tài liệu.
 * Schema DTO sinh bởi CLI plugin @nestjs/swagger (bật cho ts-jest qua
 * swagger-plugin-transformer.js, dùng chung option trong nest-cli.json).
 */
describe('Gateway Swagger (e2e)', () => {
  let app: INestApplication;
  let doc: {
    paths: Record<string, Record<string, Operation>>;
    components: { schemas: Record<string, Schema> };
  };

  type Operation = {
    summary?: string;
    tags?: string[];
    security?: Record<string, string[]>[];
    parameters?: { name: string; in: string; required?: boolean }[];
  };
  type Schema = { properties?: Record<string, object>; required?: string[] };

  beforeAll(async () => {
    jest.spyOn(Logger.prototype, 'log').mockImplementation();
    const moduleRef = await Test.createTestingModule({
      imports: [GatewayModule],
    }).compile();
    app = moduleRef.createNestApplication();
    setupSwagger(app);
    await app.init();
    const res = await request(app.getHttpServer())
      .get(`/${SWAGGER_PATH}-json`)
      .expect(200);
    doc = res.body;
  });

  afterAll(async () => {
    await app?.close();
    jest.restoreAllMocks();
  });

  it('GET /api -> Swagger UI (HTML), không cần token', async () => {
    const res = await request(app.getHttpServer())
      .get(`/${SWAGGER_PATH}`)
      .expect(200);
    expect(res.headers['content-type']).toMatch(/text\/html/);
    expect(res.text).toContain('swagger-ui');
  });

  it('tài liệu hoá đủ mọi route REST, route nào cũng có summary + tag', () => {
    const routes = Object.entries(doc.paths).flatMap(([path, ops]) =>
      Object.keys(ops).map((method) => `${method.toUpperCase()} ${path}`),
    );
    expect(routes.sort()).toEqual(
      [
        'POST /auth/register',
        'POST /auth/login',
        'POST /auth/refresh',
        'POST /auth/logout',
        'GET /auth/me',
        'GET /users/me',
        'POST /tasks',
        'GET /tasks',
        'GET /tasks/{id}',
        'PATCH /tasks/{id}',
        'DELETE /tasks/{id}',
        'GET /admin/users',
        'PATCH /admin/users/{id}/role',
        'PATCH /admin/users/{id}/status',
        'GET /notifications',
        'GET /health',
        'GET /health/live',
      ].sort(),
    );
    for (const ops of Object.values(doc.paths)) {
      for (const op of Object.values(ops)) {
        expect(op.summary).toBeTruthy();
        expect(op.tags).toHaveLength(1);
      }
    }
  });

  it('route công khai không có khoá; route cần token có Bearer', () => {
    const security = (path: string, method: string) =>
      doc.paths[path][method].security;
    const bearer = [{ [BEARER_AUTH]: [] }];

    for (const path of [
      '/auth/register',
      '/auth/login',
      '/auth/refresh',
      '/auth/logout',
    ]) {
      expect(security(path, 'post')).toBeUndefined();
    }
    expect(security('/health', 'get')).toBeUndefined();
    expect(security('/auth/me', 'get')).toEqual(bearer);
    expect(security('/tasks', 'post')).toEqual(bearer);
    expect(security('/admin/users', 'get')).toEqual(bearer);
    expect(security('/notifications', 'get')).toEqual(bearer);
  });

  it('schema body lấy từ DTO (kể cả DTO tạo bằng PartialType/OmitType)', () => {
    const { schemas } = doc.components;
    expect(schemas.RegisterDto.required).toEqual(
      expect.arrayContaining(['email', 'password', 'displayName']),
    );
    expect(schemas.RegisterDto.properties?.password).toMatchObject({
      minLength: 8,
    });
    // UpdateTaskDto = PartialType(OmitType(CreateTaskDto) + ...): mọi field tuỳ chọn
    expect(Object.keys(schemas.UpdateTaskDto.properties ?? {})).toEqual(
      expect.arrayContaining(['title', 'status', 'priority', 'dueDate']),
    );
    expect(schemas.UpdateTaskDto.required ?? []).toEqual([]);
    expect(schemas.UpdateUserRoleBodyDto.properties?.role).toMatchObject({
      enum: ['USER', 'ADMIN'],
    });
  });

  it('query phân trang là tuỳ chọn, có giới hạn limit', () => {
    const params = doc.paths['/tasks'].get.parameters ?? [];
    const byName = Object.fromEntries(params.map((p) => [p.name, p]));
    expect(byName.page).toMatchObject({ in: 'query', required: false });
    expect(byName.limit).toMatchObject({
      in: 'query',
      required: false,
      schema: expect.objectContaining({ maximum: 100 }),
    });
    expect(byName.status).toMatchObject({ in: 'query', required: false });
  });
});
