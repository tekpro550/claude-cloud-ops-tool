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
  CreateCustomFieldDto,
  UpdateCustomFieldDto,
} from './custom-fields.dto';
import { CustomFieldsService } from './custom-fields.service';

// Reading defs is open (the ticket form needs them to render); managing them
// is admin-only, same split as business hours / cost settings.
@UseGuards(TenantHeaderGuard, RolesGuard)
@Controller('ticket-custom-fields')
export class CustomFieldsController {
  constructor(private readonly customFields: CustomFieldsService) {}

  @Get()
  list(@CurrentTenantId() tenantId: string) {
    return this.customFields.list(tenantId);
  }

  @Roles('admin')
  @Post()
  create(
    @CurrentTenantId() tenantId: string,
    @Body() dto: CreateCustomFieldDto,
  ) {
    return this.customFields.create(tenantId, dto);
  }

  @Roles('admin')
  @Patch(':id')
  update(
    @CurrentTenantId() tenantId: string,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateCustomFieldDto,
  ) {
    return this.customFields.update(tenantId, id, dto);
  }

  @Roles('admin')
  @Delete(':id')
  @HttpCode(204)
  remove(
    @CurrentTenantId() tenantId: string,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.customFields.remove(tenantId, id);
  }
}
