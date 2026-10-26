import { IsJWT } from 'class-validator';

/** Payload message `auth.refresh` và `auth.logout`. */
export class RefreshTokenDto {
  @IsJWT()
  refreshToken: string;
}
