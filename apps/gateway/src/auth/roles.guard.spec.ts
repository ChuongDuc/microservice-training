import { AuthUserDto, UserRole } from '@app/common';
import { ExecutionContext, ForbiddenException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { ROLES_KEY } from './roles.decorator';
import { RolesGuard } from './roles.guard';

/** Metadata @Roles() ở route và/hoặc controller. */
type RolesMeta = { route?: UserRole[]; controller?: UserRole[] };

describe('RolesGuard', () => {
  const guard = new RolesGuard(new Reflector());
  const USER_ID = '3f1c9a52-6b0e-4d8a-9c1e-2a7b5d4e8f10';
  const admin: AuthUserDto = { userId: USER_ID, role: 'ADMIN' };
  const user: AuthUserDto = { userId: USER_ID, role: 'USER' };

  /** ExecutionContext giả: metadata @Roles() ở route và/hoặc controller. */
  const contextOf = (
    caller: AuthUserDto | undefined,
    { route, controller }: RolesMeta = {},
  ) => {
    const handler = () => undefined;
    class Controller {}
    if (route) Reflect.defineMetadata(ROLES_KEY, route, handler);
    if (controller) Reflect.defineMetadata(ROLES_KEY, controller, Controller);
    return {
      getHandler: () => handler,
      getClass: () => Controller,
      switchToHttp: () => ({ getRequest: () => ({ user: caller }) }),
    } as unknown as ExecutionContext;
  };

  it('route không gắn @Roles() -> cho qua (chỉ cần đăng nhập)', () => {
    expect(guard.canActivate(contextOf(user))).toBe(true);
  });

  it('@Roles("ADMIN"): ADMIN qua, USER -> 403', () => {
    const roles: RolesMeta = { route: ['ADMIN'] };
    expect(guard.canActivate(contextOf(admin, roles))).toBe(true);
    expect(() => guard.canActivate(contextOf(user, roles))).toThrow(
      new ForbiddenException('Bạn không có quyền truy cập tài nguyên này'),
    );
  });

  it('@Roles() ở controller áp cho mọi route trong controller', () => {
    const roles: RolesMeta = { controller: ['ADMIN'] };
    expect(guard.canActivate(contextOf(admin, roles))).toBe(true);
    expect(() => guard.canActivate(contextOf(user, roles))).toThrow(
      ForbiddenException,
    );
  });

  it('@Roles() ở route ghi đè @Roles() ở controller', () => {
    const roles: RolesMeta = {
      controller: ['ADMIN'],
      route: ['USER', 'ADMIN'],
    };
    expect(guard.canActivate(contextOf(user, roles))).toBe(true);
  });

  it('có @Roles() nhưng không có user (guard chạy sai thứ tự) -> 403, không cho qua', () => {
    expect(() =>
      guard.canActivate(contextOf(undefined, { route: ['ADMIN'] })),
    ).toThrow(ForbiddenException);
  });
});
