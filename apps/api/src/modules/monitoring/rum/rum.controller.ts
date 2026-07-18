import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { CurrentTenantId } from '../../platform/http/current-tenant.decorator';
import { TenantHeaderGuard } from '../../platform/http/tenant-header.guard';
import { CreateRumAppKeyDto } from './rum.dto';
import { RumService } from './rum.service';

@UseGuards(TenantHeaderGuard)
@Controller('rum')
export class RumController {
  constructor(private readonly rum: RumService) {}

  @Get('app-keys')
  listAppKeys(@CurrentTenantId() tenantId: string) {
    return this.rum.listAppKeys(tenantId);
  }

  @Post('app-keys')
  createAppKey(
    @CurrentTenantId() tenantId: string,
    @Body() dto: CreateRumAppKeyDto,
  ) {
    return this.rum.createAppKey(tenantId, dto);
  }

  @Delete('app-keys/:id')
  @HttpCode(204)
  removeAppKey(
    @CurrentTenantId() tenantId: string,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.rum.removeAppKey(tenantId, id);
  }

  @Get('pages')
  listPages(@CurrentTenantId() tenantId: string) {
    return this.rum.listPages(tenantId);
  }

  @Get('pages/:page/stats')
  pageStats(
    @CurrentTenantId() tenantId: string,
    @Param('page') page: string,
    @Query('from') from?: string,
    @Query('to') to?: string,
  ) {
    return this.rum.pageStats(tenantId, decodeURIComponent(page), { from, to });
  }
}
