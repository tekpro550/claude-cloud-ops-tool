import {
  BadRequestException,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Post,
  Res,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import type { Response } from 'express';
import { memoryStorage } from 'multer';
import { CurrentTenantId } from '../../platform/http/current-tenant.decorator';
import { TenantHeaderGuard } from '../../platform/http/tenant-header.guard';
import { AttachmentsService } from './attachments.service';

const MAX_ATTACHMENT_BYTES = 15 * 1024 * 1024;

@UseGuards(TenantHeaderGuard)
@Controller('tickets')
export class AttachmentsController {
  constructor(private readonly attachments: AttachmentsService) {}

  @Post(':ticketId/messages/:messageId/attachments')
  @UseInterceptors(
    FileInterceptor('file', {
      storage: memoryStorage(),
      limits: { fileSize: MAX_ATTACHMENT_BYTES },
    }),
  )
  async upload(
    @CurrentTenantId() tenantId: string,
    @Param('ticketId', ParseUUIDPipe) ticketId: string,
    @Param('messageId', ParseUUIDPipe) messageId: string,
    @UploadedFile() file?: Express.Multer.File,
  ) {
    if (!file) {
      throw new BadRequestException('A file is required');
    }
    return this.attachments.upload(tenantId, ticketId, messageId, file);
  }

  @Get(':ticketId/attachments')
  list(
    @CurrentTenantId() tenantId: string,
    @Param('ticketId', ParseUUIDPipe) ticketId: string,
  ) {
    return this.attachments.listForTicket(tenantId, ticketId);
  }

  @Get(':ticketId/attachments/:attachmentId/download')
  async download(
    @CurrentTenantId() tenantId: string,
    @Param('ticketId', ParseUUIDPipe) ticketId: string,
    @Param('attachmentId', ParseUUIDPipe) attachmentId: string,
    @Res() res: Response,
  ) {
    const attachment = await this.attachments.getForDownload(
      tenantId,
      ticketId,
      attachmentId,
    );
    res.set({
      'Content-Type': 'application/octet-stream',
      'Content-Disposition': `attachment; filename="${encodeURIComponent(attachment.file_name)}"`,
      'Content-Length': attachment.file_size_bytes,
    });
    this.attachments.readStream(attachment.storage_path).pipe(res);
  }
}
