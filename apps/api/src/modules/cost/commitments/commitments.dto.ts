import {
  IsDateString,
  IsIn,
  IsNumber,
  IsOptional,
  IsPositive,
  IsString,
  IsUUID,
} from 'class-validator';

const COMMITMENT_KINDS = ['reserved_instance', 'savings_plan'] as const;
const TERM_MONTHS = [12, 36] as const;
const PAYMENT_OPTIONS = [
  'no_upfront',
  'partial_upfront',
  'all_upfront',
] as const;

export class CreateCommitmentDto {
  @IsUUID()
  cloudCredentialId: string;

  @IsIn(COMMITMENT_KINDS)
  kind: (typeof COMMITMENT_KINDS)[number];

  @IsString()
  service: string;

  @IsOptional()
  @IsString()
  region?: string;

  @IsIn(TERM_MONTHS)
  termMonths: (typeof TERM_MONTHS)[number];

  @IsOptional()
  @IsIn(PAYMENT_OPTIONS)
  paymentOption?: (typeof PAYMENT_OPTIONS)[number];

  @IsNumber()
  @IsPositive()
  hourlyCommitment: number;

  @IsDateString()
  startDate: string;

  @IsDateString()
  endDate: string;
}
