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
import { CreateTicketTypeDto, UpdateTicketTypeDto } from './ticket-types.dto';
import { TicketTypesService } from './ticket-types.service';

@UseGuards(TenantHeaderGuard)
@Controller('ticket-types')
export class TicketTypesController {
  constructor(private readonly ticketTypes: TicketTypesService) {}

  @Get()
  list(@CurrentTenantId() tenantId: string) {
    return this.ticketTypes.list(tenantId);
  }

  @Post()
  create(@CurrentTenantId() tenantId: string, @Body() dto: CreateTicketTypeDto) {
    return this.ticketTypes.create(tenantId, dto);
  }

  @Patch(':id')
  update(
    @CurrentTenantId() tenantId: string,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateTicketTypeDto,
  ) {
    return this.ticketTypes.update(tenantId, id, dto);
  }

  @Delete(':id')
  @HttpCode(204)
  remove(@CurrentTenantId() tenantId: string, @Param('id', ParseUUIDPipe) id: string) {
    return this.ticketTypes.remove(tenantId, id);
  }
}
