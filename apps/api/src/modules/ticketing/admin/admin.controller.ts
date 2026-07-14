import { Controller, Get, UseGuards } from '@nestjs/common';
import { CurrentTenantId } from '../../platform/http/current-tenant.decorator';
import { TenantHeaderGuard } from '../../platform/http/tenant-header.guard';
import { AdminService } from './admin.service';

@UseGuards(TenantHeaderGuard)
@Controller('admin')
export class AdminController {
  constructor(private readonly admin: AdminService) {}

  @Get('setup-status')
  setupStatus(@CurrentTenantId() tenantId: string) {
    return this.admin.setupStatus(tenantId);
  }
}
