import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { CurrentTenantId } from '../http/current-tenant.decorator';
import { Roles } from '../http/roles.decorator';
import { RolesGuard } from '../http/roles.guard';
import { TenantHeaderGuard } from '../http/tenant-header.guard';
import { AuditLogService } from './audit-log.service';

/**
 * Read-only admin audit trail. Admin-only -- the whole point is that only
 * privileged users can review who changed configuration and when.
 */
@UseGuards(TenantHeaderGuard, RolesGuard)
@Controller('admin/audit-log')
export class AuditLogController {
  constructor(private readonly audit: AuditLogService) {}

  @Roles('admin')
  @Get()
  list(
    @CurrentTenantId() tenantId: string,
    @Query('limit') limit?: string,
    @Query('offset') offset?: string,
  ) {
    return this.audit.list(tenantId, {
      limit: limit ? Number(limit) : undefined,
      offset: offset ? Number(offset) : undefined,
    });
  }
}
