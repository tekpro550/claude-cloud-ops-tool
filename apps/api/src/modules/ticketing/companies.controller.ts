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
import { CompaniesService } from './companies.service';
import { CreateCompanyDto, UpdateCompanyDto } from './companies.dto';

@UseGuards(TenantHeaderGuard)
@Controller('companies')
export class CompaniesController {
  constructor(private readonly companiesService: CompaniesService) {}

  @Get()
  list(@CurrentTenantId() tenantId: string) {
    return this.companiesService.list(tenantId);
  }

  @Get(':id')
  get(
    @CurrentTenantId() tenantId: string,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.companiesService.get(tenantId, id);
  }

  @Post()
  create(@CurrentTenantId() tenantId: string, @Body() dto: CreateCompanyDto) {
    return this.companiesService.create(tenantId, dto);
  }

  @Patch(':id')
  update(
    @CurrentTenantId() tenantId: string,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateCompanyDto,
  ) {
    return this.companiesService.update(tenantId, id, dto);
  }

  @Delete(':id')
  @HttpCode(204)
  remove(
    @CurrentTenantId() tenantId: string,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.companiesService.remove(tenantId, id);
  }
}
