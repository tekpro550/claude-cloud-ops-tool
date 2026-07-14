import { IsIn, IsOptional, IsString } from 'class-validator';

const TICKET_PRIORITIES = ['low', 'medium', 'high', 'urgent'] as const;

/**
 * Attachment and captcha from the Module 1 doc's submit-ticket form are
 * intentionally not fields here yet -- attachments need the object-storage
 * piece to exist first, and captcha needs a real provider (reCAPTCHA/hCaptcha)
 * this deployment doesn't have credentials for.
 */
export class PortalSubmitTicketDto {
  @IsString()
  name: string;

  @IsString()
  email: string;

  @IsString()
  subject: string;

  @IsString()
  description: string;

  @IsOptional()
  @IsIn(TICKET_PRIORITIES)
  priority?: (typeof TICKET_PRIORITIES)[number];
}
