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
  CreateCannedResponseFolderDto,
  UpdateCannedResponseFolderDto,
} from './canned-response-folders.dto';
import { CannedResponseFoldersService } from './canned-response-folders.service';

@UseGuards(TenantHeaderGuard)
@Controller('canned-response-folders')
export class CannedResponseFoldersController {
  constructor(private readonly foldersService: CannedResponseFoldersService) {}

  @Get()
  list(@CurrentTenantId() tenantId: string) {
    return this.foldersService.list(tenantId);
  }

  @Post()
  create(
    @CurrentTenantId() tenantId: string,
    @Body() dto: CreateCannedResponseFolderDto,
  ) {
    return this.foldersService.create(tenantId, dto);
  }

  @Patch(':id')
  update(
    @CurrentTenantId() tenantId: string,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateCannedResponseFolderDto,
  ) {
    return this.foldersService.update(tenantId, id, dto);
  }

  @Delete(':id')
  @HttpCode(204)
  remove(
    @CurrentTenantId() tenantId: string,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.foldersService.remove(tenantId, id);
  }
}
