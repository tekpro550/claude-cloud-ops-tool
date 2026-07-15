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
import { CreateCostBudgetDto, UpdateCostBudgetDto } from './cost-budgets.dto';
import { CostBudgetsService } from './cost-budgets.service';

@UseGuards(TenantHeaderGuard)
@Controller('cost-budgets')
export class CostBudgetsController {
  constructor(private readonly costBudgets: CostBudgetsService) {}

  @Get()
  list(@CurrentTenantId() tenantId: string) {
    return this.costBudgets.list(tenantId);
  }

  @Post()
  create(
    @CurrentTenantId() tenantId: string,
    @Body() dto: CreateCostBudgetDto,
  ) {
    return this.costBudgets.create(tenantId, dto);
  }

  @Patch(':id')
  update(
    @CurrentTenantId() tenantId: string,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateCostBudgetDto,
  ) {
    return this.costBudgets.update(tenantId, id, dto);
  }

  @Delete(':id')
  @HttpCode(204)
  remove(
    @CurrentTenantId() tenantId: string,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.costBudgets.remove(tenantId, id);
  }
}
