import { IsNumber, IsOptional } from 'class-validator';

export class AgentReportDto {
  @IsOptional()
  @IsNumber()
  cpuPercent?: number;

  @IsOptional()
  @IsNumber()
  memPercent?: number;

  @IsOptional()
  @IsNumber()
  diskPercent?: number;
}
