import { Body, Controller, HttpCode, Post } from '@nestjs/common';
import { RumCollectDto } from './rum.dto';
import { RumService } from './rum.service';

/**
 * Public-ish: RUM beacons come from arbitrary customer websites, not the
 * agent web app or portal, so this route can't use the global CORS_ORIGIN
 * allowlist main.ts sets up for everything else. main.ts answers this
 * route's CORS (including the OPTIONS preflight) with a permissive,
 * narrowly-path-scoped middleware registered before the global cors()
 * middleware -- the one deliberate CORS widening in the app, same spirit as
 * status-pages' narrowly-scoped RLS widening. Tenant scoping still comes
 * entirely from the signed appKey in the body, verified in
 * RumService.collect -- an open CORS policy here doesn't widen who can
 * write data, only who can attempt to (and only into their own tenant, per
 * the key).
 */
@Controller('rum')
export class RumIngestionController {
  constructor(private readonly rum: RumService) {}

  @Post('collect')
  @HttpCode(204)
  collect(@Body() dto: RumCollectDto) {
    return this.rum.collect(dto.appKey, dto.events);
  }
}
