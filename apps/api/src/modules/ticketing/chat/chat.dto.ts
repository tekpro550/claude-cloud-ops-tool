import {
  IsIn,
  IsNotEmpty,
  IsOptional,
  IsString,
  IsUUID,
} from 'class-validator';

export class CreateChatSessionDto {
  @IsString()
  @IsNotEmpty()
  visitorName: string;

  @IsOptional()
  @IsUUID()
  contactId?: string;
}

export class AddChatMessageDto {
  @IsIn(['visitor', 'agent', 'system'])
  authorType: 'visitor' | 'agent' | 'system';

  @IsOptional()
  @IsUUID()
  authorId?: string;

  @IsString()
  @IsNotEmpty()
  body: string;
}
