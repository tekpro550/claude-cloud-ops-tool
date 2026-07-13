import {
  IsArray,
  IsEmail,
  IsIn,
  IsOptional,
  IsString,
  IsUUID,
} from 'class-validator';

const MESSAGE_TYPES = ['reply', 'note', 'forward'] as const;
const AUTHOR_TYPES = ['agent', 'contact', 'system'] as const;

export class AddTicketMessageDto {
  @IsIn(MESSAGE_TYPES)
  type: (typeof MESSAGE_TYPES)[number];

  @IsIn(AUTHOR_TYPES)
  authorType: (typeof AUTHOR_TYPES)[number];

  @IsOptional()
  @IsUUID()
  authorId?: string;

  @IsString()
  body: string;

  @IsOptional()
  @IsArray()
  @IsEmail({}, { each: true })
  cc?: string[];
}
