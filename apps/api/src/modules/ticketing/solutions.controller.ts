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
import { CurrentTenantId } from '../platform/http/current-tenant.decorator';
import { TenantHeaderGuard } from '../platform/http/tenant-header.guard';
import { CreateSolutionDto, UpdateSolutionDto } from './solutions.dto';
import { SolutionsService } from './solutions.service';

@UseGuards(TenantHeaderGuard)
@Controller('admin/solutions')
export class SolutionsController {
  constructor(private readonly solutions: SolutionsService) {}

  @Get()
  list(@CurrentTenantId() tenantId: string, @Query('search') search?: string) {
    return this.solutions.list(tenantId, search);
  }

  @Get(':id')
  get(
    @CurrentTenantId() tenantId: string,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.solutions.get(tenantId, id);
  }

  @Post()
  create(@CurrentTenantId() tenantId: string, @Body() dto: CreateSolutionDto) {
    return this.solutions.create(tenantId, dto);
  }

  @Patch(':id')
  update(
    @CurrentTenantId() tenantId: string,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateSolutionDto,
  ) {
    return this.solutions.update(tenantId, id, dto);
  }

  @Delete(':id')
  @HttpCode(204)
  remove(
    @CurrentTenantId() tenantId: string,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.solutions.remove(tenantId, id);
  }
}
