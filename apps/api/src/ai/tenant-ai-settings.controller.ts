import { Body, Controller, Get, Put, UseGuards } from '@nestjs/common';
import { AuditLogService } from '../modules/platform/audit/audit-log.service';
import { CurrentTenantId } from '../modules/platform/http/current-tenant.decorator';
import { CurrentUserId } from '../modules/platform/http/current-user.decorator';
import { Roles } from '../modules/platform/http/roles.decorator';
import { RolesGuard } from '../modules/platform/http/roles.guard';
import { TenantHeaderGuard } from '../modules/platform/http/tenant-header.guard';
import { UpdateTenantAiSettingsDto } from './tenant-ai-settings.dto';
import { TenantAiSettingsService } from './tenant-ai-settings.service';

// Admin-only: the AI provider config (which model, which endpoint, whether a
// key is stored) is sensitive tenant configuration. The key itself is never
// returned. The ticket-facing enabled check lives on ticket-ai/status, which
// any agent may call.
@UseGuards(TenantHeaderGuard, RolesGuard)
@Roles('admin')
@Controller('tenant-ai-settings')
export class TenantAiSettingsController {
  constructor(
    private readonly settings: TenantAiSettingsService,
    private readonly audit: AuditLogService,
  ) {}

  @Get()
  get(@CurrentTenantId() tenantId: string) {
    return this.settings.get(tenantId);
  }

  @Put()
  async update(
    @CurrentTenantId() tenantId: string,
    @CurrentUserId() userId: string | undefined,
    @Body() dto: UpdateTenantAiSettingsDto,
  ) {
    const result = await this.settings.upsert(tenantId, dto);
    // Never log the API key — only which provider/model was selected.
    await this.audit.record(tenantId, {
      actorUserId: userId,
      action: 'tenant_ai_settings.update',
      entityType: 'tenant_ai_settings',
      summary: `Updated AI provider settings (${dto.provider})`,
      details: {
        provider: dto.provider,
        model: dto.model,
        isEnabled: dto.isEnabled ?? true,
      },
    });
    return result;
  }
}
