export interface MediaAsset {
  id: string;
  fileName: string;
  type: 'image' | 'video';
  mimeType: string;
  sizeBytes: number;
  originalPath?: string;
  createdAt: number;
}

export const IMAGE_MIME_WHITELIST = ['image/jpeg', 'image/png', 'image/webp'] as const;
export const VIDEO_MIME_WHITELIST = ['video/mp4', 'video/quicktime', 'video/webm'] as const;
export const MAX_IMAGE_BYTES = 16 * 1024 * 1024;
export const MAX_VIDEO_BYTES = 100 * 1024 * 1024;

export type MediaValidationCode =
  | 'UNSUPPORTED_TYPE'
  | 'FILE_TOO_LARGE'
  | 'FILE_NOT_FOUND'
  | 'FILE_EMPTY';

export class MediaAssetValidator {
  static validate(meta: { mimeType: string; sizeBytes: number; type: 'image' | 'video' }): MediaValidationCode | null {
    if (meta.sizeBytes === 0) return 'FILE_EMPTY';
    if (meta.type === 'image') {
      if (!(IMAGE_MIME_WHITELIST as readonly string[]).includes(meta.mimeType)) return 'UNSUPPORTED_TYPE';
      if (meta.sizeBytes > MAX_IMAGE_BYTES) return 'FILE_TOO_LARGE';
    } else {
      if (!(VIDEO_MIME_WHITELIST as readonly string[]).includes(meta.mimeType)) return 'UNSUPPORTED_TYPE';
      if (meta.sizeBytes > MAX_VIDEO_BYTES) return 'FILE_TOO_LARGE';
    }
    return null;
  }
}
