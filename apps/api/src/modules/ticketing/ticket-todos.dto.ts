import { IsBoolean, IsOptional, IsString } from 'class-validator';

export class CreateTicketTodoDto {
  @IsString()
  body: string;
}

export class UpdateTicketTodoDto {
  @IsOptional()
  @IsBoolean()
  isDone?: boolean;

  @IsOptional()
  @IsString()
  body?: string;
}
