import { IsOptional, IsString, MinLength } from 'class-validator';

export class LoginDto {
  @IsString()
  email: string;

  @IsString()
  @MinLength(1)
  password: string;

  /** Present on the second step when the account has 2FA enabled. */
  @IsOptional()
  @IsString()
  totpCode?: string;
}
