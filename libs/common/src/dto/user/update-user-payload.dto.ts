import { Type } from 'class-transformer';
import { IsDefined, IsUUID, ValidateNested } from 'class-validator';
import { UpdateUserDto } from './update-user.dto';

/**
 * Payload message `user.update`: `{ id, data }`.
 * `@ValidateNested` + `@Type` bắt buộc để ValidationPipe validate cả object `data`
 * (thiếu chúng thì các field bên trong `data` không được kiểm tra).
 */
export class UpdateUserPayloadDto {
  @IsUUID()
  id: string;

  @IsDefined()
  @ValidateNested()
  @Type(() => UpdateUserDto)
  data: UpdateUserDto;
}
