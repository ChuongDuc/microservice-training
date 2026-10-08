import { IsEmail, IsUUID } from 'class-validator';

/** Payload message `user.find_by_id`. */
export class FindUserByIdDto {
  @IsUUID()
  id: string;
}

/** Payload message `user.find_by_email`. */
export class FindUserByEmailDto {
  @IsEmail()
  email: string;
}
