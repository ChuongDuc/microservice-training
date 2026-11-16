import {
  AuthUserDto,
  CreateTaskDto,
  ListTasksDto,
  TASK_PATTERNS,
  TASK_SERVICE,
  UpdateTaskDto,
} from '@app/common';
import {
  Body,
  Controller,
  Delete,
  Get,
  Inject,
  Param,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import { ClientProxy } from '@nestjs/microservices';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { CurrentUser } from '../auth/current-user.decorator';
import { BEARER_AUTH } from '../http/swagger';
import { sendRpc } from '../rpc/send-rpc';

/**
 * REST `/tasks` (cần access token): forward xuống TASK SERVICE qua TCP với payload
 * `{ user, data }`. `user` lấy từ token (JwtAuthGuard), không lấy từ body/query, nên
 * Task Service chỉ thao tác trên task của người gọi. Body/query được validate ở Gateway
 * (ValidationPipe toàn cục, lỗi 400 kèm chi tiết field); Task Service validate lại `data`
 * và kiểm tra `id` (không phải UUID -> 400).
 */
@ApiTags('tasks')
@ApiBearerAuth(BEARER_AUTH)
@Controller('tasks')
export class TasksController {
  constructor(@Inject(TASK_SERVICE) private readonly taskClient: ClientProxy) {}

  @ApiOperation({ summary: 'Tạo task' })
  @Post() // 201
  create(@CurrentUser() user: AuthUserDto, @Body() dto: CreateTaskDto) {
    return this.send(TASK_PATTERNS.CREATE, user, dto);
  }

  /** Danh sách task của người gọi: `?page=&limit=&status=`. */
  @ApiOperation({ summary: 'Danh sách task của người gọi' })
  @Get()
  findAll(@CurrentUser() user: AuthUserDto, @Query() query: ListTasksDto) {
    return this.send(TASK_PATTERNS.FIND_ALL, user, query);
  }

  @ApiOperation({ summary: 'Chi tiết một task' })
  @Get(':id')
  findOne(@CurrentUser() user: AuthUserDto, @Param('id') id: string) {
    return this.send(TASK_PATTERNS.FIND_ONE, user, { id });
  }

  @ApiOperation({ summary: 'Sửa một phần task' })
  @Patch(':id')
  update(
    @CurrentUser() user: AuthUserDto,
    @Param('id') id: string,
    @Body() dto: UpdateTaskDto,
  ) {
    // `id` trên URL ghi sau cùng: body có `id` cũng không đổi được task bị sửa
    return this.send(TASK_PATTERNS.UPDATE, user, { ...dto, id });
  }

  /** Xoá task, trả về task vừa xoá (200). */
  @ApiOperation({ summary: 'Xoá task' })
  @Delete(':id')
  remove(@CurrentUser() user: AuthUserDto, @Param('id') id: string) {
    return this.send(TASK_PATTERNS.DELETE, user, { id });
  }

  private send(pattern: string, user: AuthUserDto, data: unknown) {
    return sendRpc(this.taskClient, pattern, { user, data }, 'Task Service');
  }
}
