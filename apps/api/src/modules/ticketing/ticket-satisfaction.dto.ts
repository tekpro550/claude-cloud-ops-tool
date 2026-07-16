import { IsIn, IsOptional, IsString } from 'class-validator';

const RATINGS = ['happy', 'neutral', 'unhappy'] as const;

export class RateTicketDto {
  @IsIn(RATINGS)
  rating: (typeof RATINGS)[number];

  @IsOptional()
  @IsString()
  comment?: string;
}
