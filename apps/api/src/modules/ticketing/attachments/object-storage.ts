import { randomUUID } from 'crypto';
import { createReadStream, promises as fs } from 'fs';
import * as path from 'path';
import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

export interface ObjectStorage {
  /** Returns the storage_path to persist on the ticket_attachments row. */
  save(buffer: Buffer, originalName: string): Promise<string>;
  exists(storagePath: string): Promise<boolean>;
  readStream(storagePath: string): NodeJS.ReadableStream;
  delete(storagePath: string): Promise<void>;
}

/**
 * Local-disk stand-in for real object storage (S3, per the Module 1 doc).
 * The storage_path this returns is an opaque key, same shape an S3 key would
 * be -- swapping in a real S3Storage implementing the same interface later
 * doesn't touch any caller, only this file and the module wiring.
 */
@Injectable()
export class LocalDiskStorage implements ObjectStorage {
  private readonly root: string;

  constructor(config: ConfigService) {
    this.root = config.get<string>(
      'ATTACHMENTS_STORAGE_DIR',
      path.join(process.cwd(), 'storage', 'attachments'),
    );
  }

  async save(buffer: Buffer, originalName: string): Promise<string> {
    await fs.mkdir(this.root, { recursive: true });
    const ext = path.extname(originalName);
    // Random key, not the original filename -- avoids path traversal and
    // collisions; the original name is kept separately as file_name.
    const key = `${randomUUID()}${ext}`;
    await fs.writeFile(path.join(this.root, key), buffer);
    return key;
  }

  async exists(storagePath: string): Promise<boolean> {
    try {
      await fs.access(path.join(this.root, this.assertSafeKey(storagePath)));
      return true;
    } catch {
      return false;
    }
  }

  readStream(storagePath: string): NodeJS.ReadableStream {
    return createReadStream(
      path.join(this.root, this.assertSafeKey(storagePath)),
    );
  }

  async delete(storagePath: string): Promise<void> {
    await fs.rm(path.join(this.root, this.assertSafeKey(storagePath)), {
      force: true,
    });
  }

  // storagePath comes from a DB row, but that row was written by this same
  // class, so a `..`-containing value here would only ever mean a bug or a
  // tampered database -- fail loudly either way rather than reading outside
  // the storage root.
  private assertSafeKey(storagePath: string): string {
    const normalized = path.normalize(storagePath);
    if (normalized.startsWith('..') || path.isAbsolute(normalized)) {
      throw new Error(`Unsafe storage path: ${storagePath}`);
    }
    return normalized;
  }
}

export const OBJECT_STORAGE = 'OBJECT_STORAGE';
