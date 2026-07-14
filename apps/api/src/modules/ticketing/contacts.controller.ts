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
import { ContactsService } from './contacts.service';
import { CreateContactDto, UpdateContactDto } from './contacts.dto';

@UseGuards(TenantHeaderGuard)
@Controller('contacts')
export class ContactsController {
  constructor(private readonly contactsService: ContactsService) {}

  @Get()
  list(
    @CurrentTenantId() tenantId: string,
    @Query('search') search?: string,
    @Query('needsAction') needsAction?: string,
  ) {
    return this.contactsService.list(tenantId, search, needsAction === 'true');
  }

  @Get(':id')
  get(
    @CurrentTenantId() tenantId: string,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.contactsService.get(tenantId, id);
  }

  @Post()
  create(@CurrentTenantId() tenantId: string, @Body() dto: CreateContactDto) {
    return this.contactsService.create(tenantId, dto);
  }

  @Patch(':id')
  update(
    @CurrentTenantId() tenantId: string,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateContactDto,
  ) {
    return this.contactsService.update(tenantId, id, dto);
  }
}
