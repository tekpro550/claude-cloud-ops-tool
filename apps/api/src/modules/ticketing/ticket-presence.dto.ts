import { IsBoolean, IsOptional } from 'class-validator';

export class HeartbeatDto {
  @IsOptional()
  @IsBoolean()
  isTyping?: boolean;
}
