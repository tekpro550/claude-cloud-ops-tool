import { IsString, MinLength } from 'class-validator';

export class PortalRegisterDto {
  @IsString()
  name: string;

  @IsString()
  email: string;

  @IsString()
  @MinLength(8)
  password: string;
}

export class PortalLoginDto {
  @IsString()
  email: string;

  @IsString()
  @MinLength(1)
  password: string;
}
