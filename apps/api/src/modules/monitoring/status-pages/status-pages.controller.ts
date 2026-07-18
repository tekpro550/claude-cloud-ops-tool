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
import { CurrentTenantId } from '../../platform/http/current-tenant.decorator';
import { Roles } from '../../platform/http/roles.decorator';
import { RolesGuard } from '../../platform/http/roles.guard';
import { TenantHeaderGuard } from '../../platform/http/tenant-header.guard';
import {
  AddStatusPageMonitorDto,
  CreateStatusPageDto,
  UpdateStatusPageDto,
} from './status-pages.dto';
import { StatusPagesService } from './status-pages.service';

// Admin management of status pages -- publishing one is what makes the
// separate, unauthenticated StatusPagePublicController serve its data.
@UseGuards(TenantHeaderGuard, RolesGuard)
@Roles('admin')
@Controller('status-pages')
export class StatusPagesController {
  constructor(private readonly statusPages: StatusPagesService) {}

  @Get()
  list(@CurrentTenantId() tenantId: string) {
    return this.statusPages.list(tenantId);
  }

  @Get(':id')
  get(
    @CurrentTenantId() tenantId: string,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.statusPages.get(tenantId, id);
  }

  @Post()
  create(
    @CurrentTenantId() tenantId: string,
    @Body() dto: CreateStatusPageDto,
  ) {
    return this.statusPages.create(tenantId, dto);
  }

  @Patch(':id')
  update(
    @CurrentTenantId() tenantId: string,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateStatusPageDto,
  ) {
    return this.statusPages.update(tenantId, id, dto);
  }

  @Delete(':id')
  @HttpCode(204)
  remove(
    @CurrentTenantId() tenantId: string,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.statusPages.remove(tenantId, id);
  }

  @Post(':id/monitors')
  addMonitor(
    @CurrentTenantId() tenantId: string,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: AddStatusPageMonitorDto,
  ) {
    return this.statusPages.addMonitor(tenantId, id, dto);
  }

  @Delete(':id/monitors/:linkId')
  @HttpCode(204)
  removeMonitor(
    @CurrentTenantId() tenantId: string,
    @Param('id', ParseUUIDPipe) id: string,
    @Param('linkId', ParseUUIDPipe) linkId: string,
  ) {
    return this.statusPages.removeMonitor(tenantId, id, linkId);
  }
}
