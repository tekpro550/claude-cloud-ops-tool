import { IsOptional, IsString, IsUUID } from 'class-validator';

// Not @IsEmail() on purpose: contact email addresses mostly arrive from
// external sources (email intake's From: header, Freshdesk migration, a
// typo during manual entry) that can't be validated before ingestion. The
// service layer stores whatever's given and flags it via email_valid
// (contact-email-validation.ts) instead of hard-rejecting the request.
export class CreateContactDto {
  @IsString()
  name: string;

  @IsOptional()
  @IsString()
  email?: string;

  @IsOptional()
  @IsString()
  phone?: string;

  @IsOptional()
  @IsUUID()
  companyId?: string;
}

export class UpdateContactDto {
  @IsOptional()
  @IsString()
  name?: string;

  @IsOptional()
  @IsString()
  email?: string;

  @IsOptional()
  @IsString()
  phone?: string;

  @IsOptional()
  @IsUUID()
  companyId?: string;
}
