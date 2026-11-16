import {
  AdminListUsersDto,
  AuthUserDto,
  UpdateUserRoleBodyDto,
  UpdateUserStatusBodyDto,
  USER_PATTERNS,
  USER_SERVICE,
} from '@app/common';
import {
  Body,
  Controller,
  Get,
  Inject,
  Param,
  Patch,
  Query,
} from '@nestjs/common';
import { ClientProxy } from '@nestjs/microservices';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { CurrentUser } from '../auth/current-user.decorator';
import { Roles } from '../auth/roles.decorator';
import { BEARER_AUTH } from '../http/swagger';
import { sendRpc } from '../rpc/send-rpc';

/**
 * REST `/admin/users` — chỉ ADMIN (RolesGuard, user thường -> 403). Forward xuống USER
 * SERVICE với payload `{ user, data }`. Body/query được validate ở Gateway (ValidationPipe
 * toàn cục); User Service kiểm tra lại role và validate lại `data`.
 */
@Roles('ADMIN')
@ApiTags('admin')
@ApiBearerAuth(BEARER_AUTH)
@Controller('admin/users')
export class AdminUsersController {
  constructor(@Inject(USER_SERVICE) private readonly userClient: ClientProxy) {}

  /** Danh sách user: `?page=&limit=&search=&role=&status=`. */
  @ApiOperation({ summary: 'Danh sách user (ADMIN)' })
  @Get()
  list(@CurrentUser() user: AuthUserDto, @Query() query: AdminListUsersDto) {
    return this.send(USER_PATTERNS.ADMIN_LIST, user, query);
  }

  /** Đổi role: body `{ role: 'USER' | 'ADMIN' }`. */
  @ApiOperation({ summary: 'Đổi role của user (ADMIN)' })
  @Patch(':id/role')
  updateRole(
    @CurrentUser() user: AuthUserDto,
    @Param('id') id: string,
    @Body() body: UpdateUserRoleBodyDto,
  ) {
    // `id` trên URL ghi sau cùng: body có `id` cũng không đổi được user bị sửa
    return this.send(USER_PATTERNS.ADMIN_UPDATE_ROLE, user, { ...body, id });
  }

  /** Khoá / mở khoá: body `{ status: 'ACTIVE' | 'BLOCKED' }`. */
  @ApiOperation({ summary: 'Khoá / mở khoá user (ADMIN)' })
  @Patch(':id/status')
  updateStatus(
    @CurrentUser() user: AuthUserDto,
    @Param('id') id: string,
    @Body() body: UpdateUserStatusBodyDto,
  ) {
    return this.send(USER_PATTERNS.ADMIN_UPDATE_STATUS, user, { ...body, id });
  }

  private send(pattern: string, user: AuthUserDto, data: unknown) {
    return sendRpc(this.userClient, pattern, { user, data }, 'User Service');
  }
}
