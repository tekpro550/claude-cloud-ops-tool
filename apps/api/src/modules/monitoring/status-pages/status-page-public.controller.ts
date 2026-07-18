import { Controller, Get, Param } from '@nestjs/common';
import { StatusPagesService } from './status-pages.service';

/**
 * Deliberately unauthenticated -- no TenantHeaderGuard, no X-Tenant-Id, no
 * Bearer token. A visitor's browser only has the slug from a shared URL.
 * See StatusPagesService.getPublicStatus for how tenant resolution stays
 * RLS-safe despite that.
 */
@Controller('public/status')
export class StatusPagePublicController {
  constructor(private readonly statusPages: StatusPagesService) {}

  @Get(':slug')
  get(@Param('slug') slug: string) {
    return this.statusPages.getPublicStatus(slug);
  }
}
