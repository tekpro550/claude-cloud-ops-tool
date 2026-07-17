import { IsString, MinLength } from 'class-validator';

export class RequestPasswordResetDto {
  @IsString()
  email: string;
}

export class ResetPasswordDto {
  @IsString()
  @MinLength(1)
  token: string;

  @IsString()
  @MinLength(8)
  password: string;
}
