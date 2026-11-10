import { createHttpValidationPipe } from '@app/common';
import {
  Body,
  Controller,
  Get,
  HttpException,
  INestApplication,
  Logger,
  NotFoundException,
  Post,
} from '@nestjs/common';
import { APP_FILTER, APP_PIPE } from '@nestjs/core';
import { Test } from '@nestjs/testing';
import { IsEmail } from 'class-validator';
import * as request from 'supertest';
import { AllHttpExceptionsFilter } from './http-exception.filter';

class EmailDto {
  @IsEmail()
  email: string;
}

@Controller()
class DummyController {
  @Post('echo')
  echo(@Body() dto: EmailDto) {
    return dto;
  }

  @Get('not-found')
  notFound() {
    throw new NotFoundException('Không thấy');
  }

  @Get('rpc-like')
  rpcLike() {
    // Dạng sendRpc() chuyển tiếp lỗi của service
    throw new HttpException(
      { statusCode: 409, message: 'Email đã được đăng ký' },
      409,
    );
  }

  @Get('boom')
  boom() {
    throw new Error('mật khẩu DB lộ ra đây');
  }
}

/**
 * Gắn ValidationPipe + filter giống GatewayModule vào một app HTTP nhỏ để kiểm tra dạng
 * lỗi trả cho client (không cần service phía trong hay DB).
 */
describe('AllHttpExceptionsFilter + ValidationPipe (HTTP)', () => {
  let app: INestApplication;
  let logError: jest.SpyInstance;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      controllers: [DummyController],
      providers: [
        { provide: APP_PIPE, useFactory: createHttpValidationPipe },
        { provide: APP_FILTER, useClass: AllHttpExceptionsFilter },
      ],
    }).compile();
    app = moduleRef.createNestApplication();
    await app.init();
  });

  afterAll(() => app.close());

  beforeEach(() => {
    logError = jest.spyOn(Logger.prototype, 'error').mockImplementation();
  });

  afterEach(() => jest.restoreAllMocks());

  const http = () => request(app.getHttpServer());

  it('body hợp lệ -> đi qua, chỉ giữ field khai báo trong DTO', async () => {
    await http()
      .post('/echo')
      .send({ email: 'a@x.com' })
      .expect(201, { email: 'a@x.com' });
  });

  it('body sai -> 400 { statusCode, message, errors }', async () => {
    const { body } = await http()
      .post('/echo')
      .send({ email: 'sai' })
      .expect(400);
    expect(body).toEqual({
      statusCode: 400,
      message: 'Validation failed',
      errors: [
        { field: 'email', constraints: { isEmail: expect.any(String) } },
      ],
    });
  });

  it('field lạ -> 400 (forbidNonWhitelisted)', async () => {
    const { body } = await http()
      .post('/echo')
      .send({ email: 'a@x.com', role: 'ADMIN' })
      .expect(400);
    expect(body.errors).toEqual([expect.objectContaining({ field: 'role' })]);
  });

  it('JSON sai cú pháp -> 400, không phải 500', async () => {
    const { body } = await http()
      .post('/echo')
      .set('Content-Type', 'application/json')
      .send('{"email":')
      .expect(400);
    expect(body).toEqual({ statusCode: 400, message: expect.any(String) });
  });

  it('HttpException mặc định -> bỏ field `error` của Nest', async () => {
    await http()
      .get('/not-found')
      .expect(404, { statusCode: 404, message: 'Không thấy' });
  });

  it('route không tồn tại -> 404 cùng dạng', async () => {
    await http()
      .get('/khong-co')
      .expect(404, { statusCode: 404, message: 'Cannot GET /khong-co' });
  });

  it('lỗi chuyển tiếp từ service -> giữ nguyên', async () => {
    await http()
      .get('/rpc-like')
      .expect(409, { statusCode: 409, message: 'Email đã được đăng ký' });
  });

  it('lỗi lạ -> 500 chung, không lộ chi tiết, có ghi log', async () => {
    await http()
      .get('/boom')
      .expect(500, { statusCode: 500, message: 'Internal server error' });
    expect(logError).toHaveBeenCalledWith(
      expect.stringContaining('GET /boom'),
      expect.stringContaining('mật khẩu DB lộ ra đây'),
    );
  });
});
