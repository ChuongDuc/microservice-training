import {
  CreateTaskPayloadDto,
  ListTasksPayloadDto,
  TASK_PATTERNS,
  TaskIdPayloadDto,
  UpdateTaskPayloadDto,
} from '@app/common';
import { Controller } from '@nestjs/common';
import { MessagePattern, Payload } from '@nestjs/microservices';
import { TaskServiceService } from './task-service.service';

/**
 * Nhận message TCP cho Task Service. Payload `{ user, data }` (danh tính người gọi do
 * Gateway truyền xuống) được validate bởi createRpcValidationPipe() theo DTO. Mọi
 * handler chuyển `user` xuống service để chỉ thao tác trên task của người gọi.
 */
@Controller()
export class TaskServiceController {
  constructor(private readonly taskService: TaskServiceService) {}

  @MessagePattern(TASK_PATTERNS.CREATE)
  create(@Payload() { user, data }: CreateTaskPayloadDto) {
    return this.taskService.create(user, data);
  }

  @MessagePattern(TASK_PATTERNS.FIND_ALL)
  findAll(@Payload() { user, data }: ListTasksPayloadDto) {
    return this.taskService.findAll(user, data);
  }

  @MessagePattern(TASK_PATTERNS.FIND_ONE)
  findOne(@Payload() { user, data }: TaskIdPayloadDto) {
    return this.taskService.findOne(user, data.id);
  }

  @MessagePattern(TASK_PATTERNS.UPDATE)
  update(@Payload() { user, data }: UpdateTaskPayloadDto) {
    return this.taskService.update(user, data);
  }

  @MessagePattern(TASK_PATTERNS.DELETE)
  remove(@Payload() { user, data }: TaskIdPayloadDto) {
    return this.taskService.remove(user, data.id);
  }
}
