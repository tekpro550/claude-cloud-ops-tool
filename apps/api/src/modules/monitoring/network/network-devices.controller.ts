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
  Query,
  UseGuards,
} from '@nestjs/common';
import { CurrentTenantId } from '../../platform/http/current-tenant.decorator';
import { Roles } from '../../platform/http/roles.decorator';
import { RolesGuard } from '../../platform/http/roles.guard';
import { TenantHeaderGuard } from '../../platform/http/tenant-header.guard';
import {
  CreateNetworkDeviceDto,
  UpdateNetworkDeviceDto,
} from './network-devices.dto';
import { NetworkDevicesService } from './network-devices.service';

// Network devices hold the tenant's SNMP community string -- admin-only,
// same posture as cloud-credentials.controller.ts.
@UseGuards(TenantHeaderGuard, RolesGuard)
@Roles('admin')
@Controller('network-devices')
export class NetworkDevicesController {
  constructor(private readonly devices: NetworkDevicesService) {}

  @Get()
  list(@CurrentTenantId() tenantId: string) {
    return this.devices.list(tenantId);
  }

  @Post()
  create(
    @CurrentTenantId() tenantId: string,
    @Body() dto: CreateNetworkDeviceDto,
  ) {
    return this.devices.create(tenantId, dto);
  }

  @Patch(':id')
  update(
    @CurrentTenantId() tenantId: string,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateNetworkDeviceDto,
  ) {
    return this.devices.update(tenantId, id, dto);
  }

  @Delete(':id')
  @HttpCode(204)
  remove(
    @CurrentTenantId() tenantId: string,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.devices.remove(tenantId, id);
  }

  @Get(':id/interfaces')
  latestSamples(
    @CurrentTenantId() tenantId: string,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.devices.latestSamples(tenantId, id);
  }

  @Get(':id/interfaces/:ifIndex/history')
  interfaceHistory(
    @CurrentTenantId() tenantId: string,
    @Param('id', ParseUUIDPipe) id: string,
    @Param('ifIndex') ifIndex: string,
    @Query('limit') limit?: string,
  ) {
    return this.devices.interfaceHistory(
      tenantId,
      id,
      Number(ifIndex),
      limit ? Number(limit) : undefined,
    );
  }
}
