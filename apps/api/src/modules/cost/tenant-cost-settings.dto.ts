import { IsIn, IsInt, IsOptional, Max, Min } from 'class-validator';

const COST_RATE_DISPLAYS = ['list_price', 'negotiated'] as const;

export class UpdateTenantCostSettingsDto {
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(12)
  financialYearStartMonth?: number;

  @IsOptional()
  @IsIn(COST_RATE_DISPLAYS)
  costRateDisplay?: (typeof COST_RATE_DISPLAYS)[number];
}
