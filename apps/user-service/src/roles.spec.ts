import { USER_ROLES } from '@app/common';
import { Role } from '../generated/prisma';

/**
 * USER_ROLES (@app/common) là bản sao của enum Role trong schema Prisma: Gateway chỉ
 * chấp nhận access token có role nằm trong USER_ROLES. Thêm role vào schema mà quên
 * USER_ROLES thì user có role mới bị 401 ở mọi route — test này báo lỗi trước.
 */
describe('USER_ROLES khớp enum Role của Prisma', () => {
  it('cùng tập giá trị', () => {
    expect([...USER_ROLES].sort()).toEqual(Object.values(Role).sort());
  });
});
