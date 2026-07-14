import { IsOptional, IsString, IsUUID } from 'class-validator';

export class CreateTicketTypeDto {
  @IsString()
  name: string;

  @IsOptional()
  @IsUUID()
  defaultGroupId?: string;

  @IsOptional()
  @IsUUID()
  defaultSlaPolicyId?: string;
}

export class UpdateTicketTypeDto {
  @IsOptional()
  @IsString()
  name?: string;

  @IsOptional()
  @IsUUID()
  defaultGroupId?: string;

  @IsOptional()
  @IsUUID()
  defaultSlaPolicyId?: string;
}
