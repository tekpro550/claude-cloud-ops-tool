import {
  IsArray,
  IsBoolean,
  IsEmail,
  IsOptional,
  IsString,
  IsUUID,
} from 'class-validator';

export class CreateAgentDto {
  @IsString()
  name: string;

  @IsEmail()
  email: string;

  @IsOptional()
  @IsArray()
  @IsUUID('4', { each: true })
  groupIds?: string[];
}

export class UpdateAgentDto {
  @IsOptional()
  @IsString()
  name?: string;

  @IsOptional()
  @IsEmail()
  email?: string;

  @IsOptional()
  @IsBoolean()
  isActive?: boolean;

  @IsOptional()
  @IsArray()
  @IsUUID('4', { each: true })
  groupIds?: string[];
}
