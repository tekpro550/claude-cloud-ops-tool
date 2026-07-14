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
import {
  CreateCannedResponseDto,
  UpdateCannedResponseDto,
} from './canned-responses.dto';
import { CannedResponsesService } from './canned-responses.service';

@UseGuards(TenantHeaderGuard)
@Controller('canned-responses')
export class CannedResponsesController {
  constructor(private readonly cannedResponses: CannedResponsesService) {}

  @Post()
  create(
    @CurrentTenantId() tenantId: string,
    @Body() dto: CreateCannedResponseDto,
  ) {
    return this.cannedResponses.create(tenantId, dto);
  }

  @Get()
  list(@CurrentTenantId() tenantId: string) {
    return this.cannedResponses.list(tenantId);
  }

  @Patch(':id')
  update(
    @CurrentTenantId() tenantId: string,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateCannedResponseDto,
  ) {
    return this.cannedResponses.update(tenantId, id, dto);
  }

  @Delete(':id')
  @HttpCode(204)
  remove(
    @CurrentTenantId() tenantId: string,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.cannedResponses.remove(tenantId, id);
  }
}
