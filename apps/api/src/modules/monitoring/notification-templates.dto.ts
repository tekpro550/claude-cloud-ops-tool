import { IsBoolean, IsIn, IsOptional, IsString } from 'class-validator';

const CHANNELS = ['email', 'whatsapp', 'voice', 'in_app'] as const;

export class CreateNotificationTemplateDto {
  @IsIn(CHANNELS)
  channel: (typeof CHANNELS)[number];

  @IsString()
  eventType: string;

  @IsOptional()
  @IsString()
  subject?: string;

  /** May reference $VARIABLE placeholders -- see renderNotificationTemplate. */
  @IsString()
  body: string;

  @IsOptional()
  @IsBoolean()
  isDefault?: boolean;
}

export class UpdateNotificationTemplateDto {
  @IsOptional()
  @IsString()
  subject?: string;

  @IsOptional()
  @IsString()
  body?: string;

  @IsOptional()
  @IsBoolean()
  isDefault?: boolean;
}
