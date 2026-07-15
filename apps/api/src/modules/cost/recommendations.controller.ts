import {
  Body,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { CurrentTenantId } from '../platform/http/current-tenant.decorator';
import { TenantHeaderGuard } from '../platform/http/tenant-header.guard';
import {
  ListRecommendationsQueryDto,
  UpdateRecommendationDto,
} from './recommendations.dto';
import { RecommendationsService } from './recommendations.service';

@UseGuards(TenantHeaderGuard)
@Controller('cost/recommendations')
export class RecommendationsController {
  constructor(private readonly recommendations: RecommendationsService) {}

  @Get()
  list(
    @CurrentTenantId() tenantId: string,
    @Query() query: ListRecommendationsQueryDto,
  ) {
    return this.recommendations.list(tenantId, query);
  }

  @Patch(':id')
  update(
    @CurrentTenantId() tenantId: string,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateRecommendationDto,
  ) {
    return this.recommendations.update(tenantId, id, dto);
  }

  @Post(':id/create_ticket')
  createTicket(
    @CurrentTenantId() tenantId: string,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.recommendations.createTicket(tenantId, id);
  }
}
