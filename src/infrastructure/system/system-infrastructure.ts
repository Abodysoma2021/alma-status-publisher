import * as fsp from 'node:fs/promises';
import * as path from 'node:path';
import { randomUUID } from 'node:crypto';
import type { Clock, EventBus, AppEventPayloads, AppEventType, IdGenerator, StoragePaths } from '../../core/application/ports/infrastructure';
import type { MediaFileImporter } from '../../core/application/use-cases/media-use-cases';
import type { MediaContentReader } from '../../core/application/use-cases/publish-schedule';
import { AppError } from '../../core/domain/errors';
import type { MediaRepository } from '../../core/application/ports/repositories';

export class SystemClock implements Clock {
  now(): Date {
    return new Date();
  }
}

export class CryptoIdGenerator implements IdGenerator {
  next(): string {
    return randomUUID();
  }
}

type Handler = (type: AppEventType, payload: unknown) => void;

export class InProcessEventBus implements EventBus {
  private handlers = new Set<Handler>();

  publish<K extends AppEventType>(type: K, payload: AppEventPayloads[K]): void {
    for (const handler of [...this.handlers]) {
      try {
        handler(type, payload);
      } catch {
        /* isolate handler failures */
      }
    }
  }

  subscribe<K extends AppEventType>(type: K, handler: (payload: AppEventPayloads[K]) => void): () => void {
    const wrapped: Handler = (t, payload) => {
      if (t === type) handler(payload as AppEventPayloads[K]);
    };
    this.handlers.add(wrapped);
    return () => this.handlers.delete(wrapped);
  }

  subscribeAll(handler: Handler): () => void {
    this.handlers.add(handler);
    return () => this.handlers.delete(handler);
  }
}

const IMAGE_EXTENSIONS: Record<string, string> = {
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.png': 'image/png',
  '.webp': 'image/webp',
};

const VIDEO_EXTENSIONS: Record<string, string> = {
  '.mp4': 'video/mp4',
  '.mov': 'video/quicktime',
  '.webm': 'video/webm',
};

/**
 * Owns the media folder: imports picked files (copy into managed storage so
 * originals can be deleted), and streams them back as data URLs for posting.
 */
export class MediaFileStore implements MediaFileImporter, MediaContentReader {
  constructor(
    private readonly mediaDir: string,
    private readonly mediaRepository: MediaRepository,
  ) {}

  async importFile(absolutePath: string, assetId: string): Promise<{ mimeType: string; sizeBytes: number; fileName: string; storedFileName: string }> {
    const ext = path.extname(absolutePath).toLowerCase();
    const mimeType = IMAGE_EXTENSIONS[ext] ?? VIDEO_EXTENSIONS[ext];
    if (!mimeType) throw new AppError('UNSUPPORTED_TYPE', `Unsupported file type: ${ext || '(none)'}`);

    let stat;
    try {
      stat = await fsp.stat(absolutePath);
    } catch {
      throw new AppError('FILE_NOT_FOUND', 'File could not be read');
    }
    if (!stat.isFile()) throw new AppError('FILE_NOT_FOUND', 'Not a file');
    if (stat.size === 0) throw new AppError('FILE_EMPTY', 'File is empty');

    const storedFileName = `${assetId}${ext}`;
    await fsp.mkdir(this.mediaDir, { recursive: true });
    await fsp.copyFile(absolutePath, path.join(this.mediaDir, storedFileName));

    return {
      mimeType,
      sizeBytes: stat.size,
      fileName: path.basename(absolutePath),
      storedFileName,
    };
  }

  async readAsDataUrl(mediaId: string): Promise<string> {
    const asset = await this.mediaRepository.get(mediaId);
    if (!asset) throw new AppError('FILE_NOT_FOUND', 'Media not found');
    const stored = await this.findByStoredName(asset);
    try {
      const buffer = await fsp.readFile(stored);
      return `data:${asset.mimeType};base64,${buffer.toString('base64')}`;
    } catch {
      throw new AppError('FILE_NOT_FOUND', 'Media file is missing on disk');
    }
  }

  async deleteStored(assetId: string): Promise<void> {
    const asset = await this.mediaRepository.get(assetId);
    if (!asset) return;
    const stored = await this.findByStoredName(asset);
    await fsp.rm(stored, { force: true }).catch(() => undefined);
  }

  private async findByStoredName(asset: { id: string; mimeType: string }): Promise<string> {
    // Stored file name is `${uuid}${ext}`; recover the extension from the mime.
    const entries = await fsp.readdir(this.mediaDir).catch(() => [] as string[]);
    const prefix = entries.find((name) => name.startsWith(asset.id));
    if (!prefix) {
      // Fall back to a canonical name from mime type.
      const ext = Object.entries(IMAGE_EXTENSIONS).find(([, m]) => m === asset.mimeType)?.[0]
        ?? Object.entries(VIDEO_EXTENSIONS).find(([, m]) => m === asset.mimeType)?.[0]
        ?? '';
      return path.join(this.mediaDir, `${asset.id}${ext}`);
    }
    return path.join(this.mediaDir, prefix);
  }
}

export function buildStoragePaths(userDataDir: string): StoragePaths {
  return {
    dataDir: userDataDir,
    mediaDir: path.join(userDataDir, 'media'),
    waSessionsDir: path.join(userDataDir, 'wa-sessions'),
    logsDir: path.join(userDataDir, 'logs'),
  };
}
