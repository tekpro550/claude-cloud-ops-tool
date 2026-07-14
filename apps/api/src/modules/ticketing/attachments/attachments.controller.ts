import {
  BadRequestException,
  Controller,
  Get,
  NotFoundException,
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

    // The DB row can outlive the on-disk file (local storage isn't durable
    // across redeploys/restarts -- see storage/ in .gitignore). Check before
    // streaming so a missing file is a clean 404 instead of an unhandled
    // stream 'error' event, which `.pipe()` doesn't forward and would
    // otherwise crash the process.
    if (!(await this.attachments.exists(attachment.storage_path))) {
      throw new NotFoundException(
        `Attachment ${attachmentId} file is missing from storage`,
      );
    }

    res.set({
      'Content-Type': 'application/octet-stream',
      // RFC 5987/6266: filename* handles non-ASCII names correctly (a bare
      // percent-encoded filename="..." is not reliably decoded by clients).
      // The plain filename= fallback strips to ASCII for older clients.
      'Content-Disposition': `attachment; filename="${attachment.file_name.replace(/[^\x20-\x7e]/g, '_')}"; filename*=UTF-8''${encodeURIComponent(attachment.file_name)}`,
      'Content-Length': attachment.file_size_bytes,
    });

    const stream = this.attachments.readStream(attachment.storage_path);
    stream.on('error', () => {
      // Defensive backstop for a race between the exists() check above and
      // the actual read (file removed in between): destroy the response
      // rather than letting an unhandled stream error crash the process.
      res.destroy();
    });
    stream.pipe(res);
  }
}
