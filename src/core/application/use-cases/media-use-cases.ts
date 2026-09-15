import { AppError } from '../../domain/errors';
import { MediaAssetValidator } from '../../domain/entities/media-asset';
import type { MediaAsset } from '../../domain/entities/media-asset';
import type { Clock, IdGenerator } from '../ports/infrastructure';
import type { MediaRepository } from '../ports/repositories';

/**
 * Persists a picked/dropped media file. The physical copy + MIME sniffing is
 * delegated to infrastructure through this port.
 */
export interface MediaFileImporter {
  /** Copies the file into managed storage under a name derived from assetId. */
  importFile(absolutePath: string, assetId: string): Promise<{ mimeType: string; sizeBytes: number; fileName: string; storedFileName: string }>;
}

export class ImportMedia {
  constructor(
    private deps: {
      media: MediaRepository;
      ids: IdGenerator;
      clock: Clock;
      importer: MediaFileImporter;
    },
  ) {}

  async execute(absolutePath: string): Promise<MediaAsset> {
    const id = this.deps.ids.next();
    const imported = await this.deps.importer.importFile(absolutePath, id);
    const type: MediaAsset['type'] = imported.mimeType.startsWith('image/') ? 'image' : 'video';

    const violation = MediaAssetValidator.validate({ mimeType: imported.mimeType, sizeBytes: imported.sizeBytes, type });
    if (violation) throw new AppError(violation);

    const asset: MediaAsset = {
      id,
      fileName: imported.fileName,
      type,
      mimeType: imported.mimeType,
      sizeBytes: imported.sizeBytes,
      originalPath: absolutePath,
      createdAt: this.deps.clock.now().getTime(),
    };
    await this.deps.media.save(asset);
    return asset;
  }
}

export class DeleteMedia {
  constructor(private deps: { media: MediaRepository; events: import('../ports/infrastructure').EventBus }) {}
  async execute(mediaId: string): Promise<void> {
    await this.deps.media.delete(mediaId);
    this.deps.events.publish('media-removed', { mediaId });
  }
}
