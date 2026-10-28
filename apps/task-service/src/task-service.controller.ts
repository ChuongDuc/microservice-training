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
 * Gateway truyền xuống) được validate bởi createRpcValidationPipe() theo DTO.
 */
@Controller()
export class TaskServiceController {
  constructor(private readonly taskService: TaskServiceService) {}

  @MessagePattern(TASK_PATTERNS.CREATE)
  create(@Payload() { user, data }: CreateTaskPayloadDto) {
    return this.taskService.create(user, data);
  }

  @MessagePattern(TASK_PATTERNS.FIND_ALL)
  findAll(@Payload() { data }: ListTasksPayloadDto) {
    return this.taskService.findAll(data);
  }

  @MessagePattern(TASK_PATTERNS.FIND_ONE)
  findOne(@Payload() { data }: TaskIdPayloadDto) {
    return this.taskService.findOne(data.id);
  }

  @MessagePattern(TASK_PATTERNS.UPDATE)
  update(@Payload() { data }: UpdateTaskPayloadDto) {
    return this.taskService.update(data);
  }

  @MessagePattern(TASK_PATTERNS.DELETE)
  remove(@Payload() { data }: TaskIdPayloadDto) {
    return this.taskService.remove(data.id);
  }
}
