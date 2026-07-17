import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { withTenantContext } from '../../../database/context/tenant-context';
import { LocalDiskStorage } from './object-storage';

export interface UploadableFile {
  buffer: Buffer;
  originalname: string;
  size: number;
}

@Injectable()
export class AttachmentsService {
  constructor(
    @InjectDataSource() private readonly dataSource: DataSource,
    private readonly storage: LocalDiskStorage,
  ) {}

  async upload(
    tenantId: string,
    ticketId: string,
    messageId: string,
    file: UploadableFile,
  ) {
    return withTenantContext(this.dataSource, tenantId, async (queryRunner) => {
      const [message] = await queryRunner.query(
        `SELECT id FROM ticket_messages WHERE id = $1 AND ticket_id = $2`,
        [messageId, ticketId],
      );
      if (!message) {
        throw new NotFoundException(
          `Message ${messageId} not found on ticket ${ticketId}`,
        );
      }

      const storagePath = await this.storage.save(
        file.buffer,
        file.originalname,
      );
      const [attachment] = await queryRunner.query(
        `INSERT INTO ticket_attachments (tenant_id, ticket_id, ticket_message_id, file_name, file_size_bytes, storage_path)
         VALUES ($1, $2, $3, $4, $5, $6) RETURNING *`,
        [
          tenantId,
          ticketId,
          messageId,
          file.originalname,
          file.size,
          storagePath,
        ],
      );
      return attachment;
    });
  }

  listForTicket(tenantId: string, ticketId: string) {
    return withTenantContext(this.dataSource, tenantId, (queryRunner) =>
      queryRunner.query(
        `SELECT * FROM ticket_attachments WHERE ticket_id = $1 ORDER BY created_at ASC`,
        [ticketId],
      ),
    );
  }

  async getForDownload(
    tenantId: string,
    ticketId: string,
    attachmentId: string,
  ) {
    return withTenantContext(this.dataSource, tenantId, async (queryRunner) => {
      const [attachment] = await queryRunner.query(
        `SELECT * FROM ticket_attachments WHERE id = $1 AND ticket_id = $2`,
        [attachmentId, ticketId],
      );
      if (!attachment) {
        throw new NotFoundException(`Attachment ${attachmentId} not found`);
      }
      return attachment;
    });
  }

  exists(storagePath: string) {
    return this.storage.exists(storagePath);
  }

  readStream(storagePath: string) {
    return this.storage.readStream(storagePath);
  }
}
