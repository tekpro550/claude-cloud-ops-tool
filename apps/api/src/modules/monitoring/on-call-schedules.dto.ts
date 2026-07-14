import {
  IsArray,
  IsDateString,
  IsOptional,
  IsString,
  IsUUID,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';

export class OnCallEntryDto {
  @IsUUID()
  agentId: string;

  @IsDateString()
  startsAt: string;

  @IsDateString()
  endsAt: string;
}

export class CreateOnCallScheduleDto {
  @IsString()
  name: string;

  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => OnCallEntryDto)
  entries: OnCallEntryDto[];
}

export class UpdateOnCallScheduleDto {
  @IsOptional()
  @IsString()
  name?: string;

  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => OnCallEntryDto)
  entries?: OnCallEntryDto[];
}
