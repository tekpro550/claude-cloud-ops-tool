import { IsIn, IsInt, IsOptional, IsString, Min } from 'class-validator';

const ASSIGNMENT_STRATEGIES = [
  'manual',
  'round_robin',
  'load_based',
  'skill_based',
] as const;

export class CreateGroupDto {
  @IsString()
  name: string;

  @IsOptional()
  @IsString()
  description?: string;

  @IsOptional()
  @IsIn(ASSIGNMENT_STRATEGIES)
  assignmentStrategy?: (typeof ASSIGNMENT_STRATEGIES)[number];

  @IsOptional()
  @IsInt()
  @Min(1)
  maxOpenTicketsPerAgent?: number;
}

export class UpdateGroupDto {
  @IsOptional()
  @IsString()
  name?: string;

  @IsOptional()
  @IsString()
  description?: string;

  @IsOptional()
  @IsIn(ASSIGNMENT_STRATEGIES)
  assignmentStrategy?: (typeof ASSIGNMENT_STRATEGIES)[number];

  @IsOptional()
  @IsInt()
  @Min(1)
  maxOpenTicketsPerAgent?: number | null;
}
