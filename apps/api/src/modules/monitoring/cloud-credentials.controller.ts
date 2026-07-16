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
import { Roles } from '../platform/http/roles.decorator';
import { RolesGuard } from '../platform/http/roles.guard';
import { TenantHeaderGuard } from '../platform/http/tenant-header.guard';
import {
  CreateCloudCredentialDto,
  UpdateCloudCredentialDto,
} from './cloud-credentials.dto';
import { CloudCredentialsService } from './cloud-credentials.service';

// Cloud credentials hold the tenant's AWS/Azure secrets -- admin-only.
@UseGuards(TenantHeaderGuard, RolesGuard)
@Roles('admin')
@Controller('cloud-credentials')
export class CloudCredentialsController {
  constructor(private readonly cloudCredentials: CloudCredentialsService) {}

  @Get()
  list(@CurrentTenantId() tenantId: string) {
    return this.cloudCredentials.list(tenantId);
  }

  @Post()
  create(
    @CurrentTenantId() tenantId: string,
    @Body() dto: CreateCloudCredentialDto,
  ) {
    return this.cloudCredentials.create(tenantId, dto);
  }

  @Patch(':id')
  update(
    @CurrentTenantId() tenantId: string,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateCloudCredentialDto,
  ) {
    return this.cloudCredentials.update(tenantId, id, dto);
  }

  @Delete(':id')
  @HttpCode(204)
  remove(
    @CurrentTenantId() tenantId: string,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.cloudCredentials.remove(tenantId, id);
  }
}
