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
import { TenantHeaderGuard } from '../../platform/http/tenant-header.guard';
import { CreateCommitmentDto } from './commitments.dto';
import { CommitmentsService } from './commitments.service';

@UseGuards(TenantHeaderGuard)
@Controller('cost/commitments')
export class CommitmentsController {
  constructor(private readonly commitments: CommitmentsService) {}

  @Get()
  list(@CurrentTenantId() tenantId: string) {
    return this.commitments.list(tenantId);
  }

  @Post()
  create(
    @CurrentTenantId() tenantId: string,
    @Body() dto: CreateCommitmentDto,
  ) {
    return this.commitments.create(tenantId, dto);
  }

  @Delete(':id')
  @HttpCode(204)
  remove(
    @CurrentTenantId() tenantId: string,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.commitments.remove(tenantId, id);
  }

  @Get(':id/coverage')
  getCoverage(
    @CurrentTenantId() tenantId: string,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.commitments.getCoverage(tenantId, id);
  }

  @Get('recommendations')
  listRecommendations(@CurrentTenantId() tenantId: string) {
    return this.commitments.listRecommendations(tenantId);
  }

  @Patch('recommendations/:id/dismiss')
  dismissRecommendation(
    @CurrentTenantId() tenantId: string,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.commitments.dismissRecommendation(tenantId, id);
  }
}
