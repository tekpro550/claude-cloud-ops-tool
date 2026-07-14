import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  UseGuards,
} from '@nestjs/common';
import { CurrentTenantId } from '../platform/http/current-tenant.decorator';
import { TenantHeaderGuard } from '../platform/http/tenant-header.guard';
import {
  CreateNotificationTemplateDto,
  UpdateNotificationTemplateDto,
} from './notification-templates.dto';
import { NotificationTemplatesService } from './notification-templates.service';

@UseGuards(TenantHeaderGuard)
@Controller('notification-templates')
export class NotificationTemplatesController {
  constructor(
    private readonly notificationTemplates: NotificationTemplatesService,
  ) {}

  @Get()
  list(@CurrentTenantId() tenantId: string) {
    return this.notificationTemplates.list(tenantId);
  }

  @Post()
  create(
    @CurrentTenantId() tenantId: string,
    @Body() dto: CreateNotificationTemplateDto,
  ) {
    return this.notificationTemplates.create(tenantId, dto);
  }

  @Patch(':id')
  update(
    @CurrentTenantId() tenantId: string,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateNotificationTemplateDto,
  ) {
    return this.notificationTemplates.update(tenantId, id, dto);
  }

  @Delete(':id')
  @HttpCode(204)
  remove(
    @CurrentTenantId() tenantId: string,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.notificationTemplates.remove(tenantId, id);
  }
}
