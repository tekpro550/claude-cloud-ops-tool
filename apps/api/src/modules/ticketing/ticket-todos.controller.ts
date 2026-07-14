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
import { CreateTicketTodoDto, UpdateTicketTodoDto } from './ticket-todos.dto';
import { TicketTodosService } from './ticket-todos.service';

@UseGuards(TenantHeaderGuard)
@Controller('tickets/:ticketId/todos')
export class TicketTodosController {
  constructor(private readonly ticketTodos: TicketTodosService) {}

  @Post()
  create(
    @CurrentTenantId() tenantId: string,
    @Param('ticketId', ParseUUIDPipe) ticketId: string,
    @Body() dto: CreateTicketTodoDto,
  ) {
    return this.ticketTodos.create(tenantId, ticketId, dto);
  }

  @Get()
  list(
    @CurrentTenantId() tenantId: string,
    @Param('ticketId', ParseUUIDPipe) ticketId: string,
  ) {
    return this.ticketTodos.list(tenantId, ticketId);
  }

  @Patch(':todoId')
  update(
    @CurrentTenantId() tenantId: string,
    @Param('ticketId', ParseUUIDPipe) ticketId: string,
    @Param('todoId', ParseUUIDPipe) todoId: string,
    @Body() dto: UpdateTicketTodoDto,
  ) {
    return this.ticketTodos.update(tenantId, ticketId, todoId, dto);
  }

  @Delete(':todoId')
  @HttpCode(204)
  remove(
    @CurrentTenantId() tenantId: string,
    @Param('ticketId', ParseUUIDPipe) ticketId: string,
    @Param('todoId', ParseUUIDPipe) todoId: string,
  ) {
    return this.ticketTodos.remove(tenantId, ticketId, todoId);
  }
}
