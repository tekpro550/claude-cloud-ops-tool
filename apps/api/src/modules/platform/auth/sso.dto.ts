import { IsBoolean, IsIn, IsOptional, IsString, IsUrl } from 'class-validator';

export class UpsertSsoConfigDto {
  @IsString()
  @IsUrl({ require_tld: false })
  issuer: string;

  @IsString()
  clientId: string;

  // Optional on update: a blank value keeps the already-stored secret.
  @IsOptional()
  @IsString()
  clientSecret?: string;

  @IsString()
  @IsUrl({ require_tld: false })
  authorizationEndpoint: string;

  @IsString()
  @IsUrl({ require_tld: false })
  tokenEndpoint: string;

  @IsString()
  @IsUrl({ require_tld: false })
  userinfoEndpoint: string;

  @IsOptional()
  @IsIn(['admin', 'agent'])
  defaultRole?: 'admin' | 'agent';

  @IsOptional()
  @IsBoolean()
  isEnabled?: boolean;
}

export class SsoCallbackDto {
  @IsString()
  code: string;

  @IsString()
  state: string;
}
