import {
  Controller,
  Get,
  NotFoundException,
  Param,
  ParseUUIDPipe,
  UseGuards,
} from '@nestjs/common';
import { CurrentTenantId } from '../../platform/http/current-tenant.decorator';
import { TenantHeaderGuard } from '../../platform/http/tenant-header.guard';
import { SolutionsService } from '../solutions.service';

/**
 * Public, no login required, per the Module 1 doc. Reuses SolutionsService
 * (the same one /admin/solutions writes through) rather than a separate
 * read path, but only ever returns published articles and 404s on drafts
 * so an unpublished article's id is never distinguishable from a nonexistent
 * one to an unauthenticated visitor.
 */
@UseGuards(TenantHeaderGuard)
@Controller('portal/solutions')
export class PortalSolutionsController {
  constructor(private readonly solutions: SolutionsService) {}

  @Get()
  async list(@CurrentTenantId() tenantId: string) {
    const all = await this.solutions.list(tenantId);
    return all.filter((solution: { is_published: boolean }) => solution.is_published);
  }

  @Get(':id')
  async get(
    @CurrentTenantId() tenantId: string,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    const solution = await this.solutions.get(tenantId, id);
    if (!solution.is_published) {
      throw new NotFoundException(`Solution ${id} not found`);
    }
    return solution;
  }
}
