import { IsString, Matches } from 'class-validator';

export class MfaCodeDto {
  @IsString()
  @Matches(/^\d{6}$/, { message: 'code must be a 6-digit authenticator code' })
  code: string;
}
