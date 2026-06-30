import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import {
  buildPaginationMeta,
  PaginatedResult,
} from '../common/interfaces/paginated-result.interface';
import { GooglePhotosService } from '../google-photos/google-photos.service';
import {
  GoogleMediaItem,
  MediaIndexEntry,
} from '../google-photos/interfaces/media-item.interface';
import { PhotoCacheService } from './photo-cache.service';
import { PhotoMeta } from './entities/photo-meta.entity';
import { PhotoMetaService } from './photo-meta.service';

export interface PhotoDto {
  id: string;
  filename?: string;
  mimeType?: string;
  description?: string;
  creationTime?: string;
  width?: number;
  height?: number;
  baseUrl?: string;
  thumbnailUrl?: string;
  displayUrl?: string;
  downloadUrl?: string;
  /** STABLE url served by this API. Never expires; redirects to a fresh Google URL. */
  rawUrl: string;
  /** Who uploaded this photo. Null for photos predating the uploader-tracking feature. */
  uploaderId: string | null;
  uploaderName: string | null;
  uploadedAt: string | null;
}

const UPLOAD_CONCURRENCY = 5;
const ACCEPTED = /^(image|video)\//;

@Injectable()
export class PhotosService {
  private readonly logger = new Logger(PhotosService.name);

  constructor(
    private readonly google: GooglePhotosService,
    private readonly cache: PhotoCacheService,
    private readonly photoMeta: PhotoMetaService,
  ) {}

  // ──────────────────────────── Read ────────────────────────────

  async list(
    page: number,
    pageSize: number,
    refresh = false,
  ): Promise<PaginatedResult<PhotoDto>> {
    const albumId = await this.google.getAlbumId();
    const index = await this.cache.getIndex(albumId, refresh);

    const total = index.length;
    const start = (page - 1) * pageSize;
    const slice = index.slice(start, start + pageSize);

    const ids = slice.map((i) => i.id);
    const [fresh, metaMap] = await Promise.all([
      this.cache.getFreshByIds(ids, refresh),
      this.photoMeta.findByGoogleIds(ids),
    ]);

    const data = slice.map((entry) =>
      this.toDto(entry, fresh.get(entry.id), metaMap.get(entry.id)),
    );

    return { data, meta: buildPaginationMeta(page, pageSize, total) };
  }

  async getOne(id: string, refresh = false): Promise<PhotoDto> {
    const [fresh, metaMap] = await Promise.all([
      this.cache.getFreshByIds([id], refresh),
      this.photoMeta.findByGoogleIds([id]),
    ]);
    const item = fresh.get(id);
    if (!item) {
      throw new NotFoundException('Photo not found in the wedding album.');
    }
    return this.toDto(this.indexFromItem(item), item, metaMap.get(id));
  }

  async resolveRawUrl(id: string, size: string): Promise<string> {
    const fresh = await this.cache.getFreshByIds([id]);
    const item = fresh.get(id);
    if (!item?.baseUrl) {
      throw new NotFoundException('Photo not found in the wedding album.');
    }
    return item.baseUrl + this.sizeParam(size, item.mimeType);
  }

  // ──────────────────────────── Write ────────────────────────────

  async uploadSingle(
    file: Express.Multer.File,
    description?: string,
    uploader?: { id: string; name?: string | null } | null,
  ): Promise<PhotoDto> {
    this.assertValid(file);
    const albumId = await this.google.getAlbumId();

    const uploadToken = await this.google.uploadBytes(
      file.buffer,
      file.mimetype,
      file.originalname,
    );
    const [result] = await this.google.batchCreate(albumId, [
      { uploadToken, filename: file.originalname, description },
    ]);

    if (!result?.mediaItem?.id) {
      throw new BadRequestException(
        result?.status?.message || 'Google Photos rejected the upload.',
      );
    }

    await Promise.all([
      this.cache.bustIndex(),
      this.cache.primeFresh([result.mediaItem]),
      this.photoMeta.saveMany([result.mediaItem.id], uploader ?? null),
    ]);

    return this.toDto(this.indexFromItem(result.mediaItem), result.mediaItem, undefined, uploader);
  }

  async uploadBulk(
    files: Express.Multer.File[],
    description?: string,
    uploader?: { id: string; name?: string | null } | null,
  ): Promise<{
    createdCount: number;
    failedCount: number;
    created: PhotoDto[];
    failed: Array<{ filename: string; reason: string }>;
  }> {
    if (!files?.length) {
      throw new BadRequestException('No files were provided.');
    }
    files.forEach((f) => this.assertValid(f));
    const albumId = await this.google.getAlbumId();

    const failed: Array<{ filename: string; reason: string }> = [];

    const tokens = await this.mapWithConcurrency(
      files,
      UPLOAD_CONCURRENCY,
      async (file) => {
        try {
          const uploadToken = await this.google.uploadBytes(
            file.buffer,
            file.mimetype,
            file.originalname,
          );
          return { uploadToken, filename: file.originalname, description };
        } catch (err) {
          failed.push({
            filename: file.originalname,
            reason: (err as Error).message,
          });
          return null;
        }
      },
    );

    const valid = tokens.filter(Boolean) as Array<{
      uploadToken: string;
      filename: string;
      description?: string;
    }>;

    const results = await this.google.batchCreate(albumId, valid);

    const created: PhotoDto[] = [];
    const createdItems: GoogleMediaItem[] = [];
    for (const r of results) {
      if (r.mediaItem?.id) {
        createdItems.push(r.mediaItem);
        created.push(this.toDto(this.indexFromItem(r.mediaItem), r.mediaItem, undefined, uploader));
      } else {
        failed.push({
          filename: '(unknown)',
          reason: r.status?.message || 'creation failed',
        });
      }
    }

    const createdIds = createdItems.map((m) => m.id);
    await Promise.all([
      this.cache.bustIndex(),
      this.cache.primeFresh(createdItems),
      this.photoMeta.saveMany(createdIds, uploader ?? null),
    ]);

    return {
      createdCount: created.length,
      failedCount: failed.length,
      created,
      failed,
    };
  }

  async refresh(): Promise<{ total: number }> {
    const albumId = await this.google.getAlbumId();
    const index = await this.cache.getIndex(albumId, true);
    return { total: index.length };
  }

  // ──────────────────────────── Helpers ────────────────────────────

  private assertValid(file?: Express.Multer.File): void {
    if (!file) throw new BadRequestException('A file is required.');
    if (!ACCEPTED.test(file.mimetype)) {
      throw new BadRequestException(
        `Unsupported type "${file.mimetype}". Only images and videos are allowed.`,
      );
    }
  }

  private toDto(
    entry: MediaIndexEntry,
    fresh?: GoogleMediaItem,
    meta?: PhotoMeta,
    uploaderOverride?: { id: string; name?: string | null } | null,
  ): PhotoDto {
    const baseUrl = fresh?.baseUrl;
    const isVideo = (entry.mimeType ?? '').startsWith('video/');
    const videoSuffix = '=dv';
    const displaySuffix = isVideo ? videoSuffix : '=w1600';
    const downloadSuffix = isVideo ? videoSuffix : '=d';
    return {
      id: entry.id,
      filename: entry.filename,
      mimeType: entry.mimeType,
      description: entry.description,
      creationTime: entry.creationTime,
      width: entry.width ? Number(entry.width) : undefined,
      height: entry.height ? Number(entry.height) : undefined,
      baseUrl,
      thumbnailUrl: baseUrl ? baseUrl + '=w400-h400' : undefined,
      displayUrl: baseUrl ? baseUrl + displaySuffix : undefined,
      downloadUrl: baseUrl ? baseUrl + downloadSuffix : undefined,
      rawUrl: `/photos/${entry.id}/raw?size=display`,
      uploaderId: uploaderOverride?.id ?? meta?.uploaderId ?? null,
      uploaderName: uploaderOverride?.name ?? meta?.uploaderName ?? null,
      uploadedAt: meta?.uploadedAt?.toISOString() ?? null,
    };
  }

  private indexFromItem(m: GoogleMediaItem): MediaIndexEntry {
    return {
      id: m.id,
      filename: m.filename,
      mimeType: m.mimeType,
      description: m.description,
      creationTime: m.mediaMetadata?.creationTime,
      width: m.mediaMetadata?.width,
      height: m.mediaMetadata?.height,
    };
  }

  private sizeParam(size: string, mimeType?: string): string {
    const isVideo = (mimeType ?? '').startsWith('video/');
    switch (size) {
      case 'thumb':
        return '=w400-h400';
      case 'display':
        return isVideo ? '=dv' : '=w1600';
      case 'download':
        return isVideo ? '=dv' : '=d';
      default: {
        const safe = size.replace(/[^wh0-9\-d]/g, '');
        return safe ? `=${safe}` : '=w1600';
      }
    }
  }

  private async mapWithConcurrency<T, R>(
    items: T[],
    limit: number,
    fn: (item: T) => Promise<R>,
  ): Promise<R[]> {
    const results: R[] = new Array(items.length);
    let cursor = 0;
    const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
      while (cursor < items.length) {
        const i = cursor++;
        results[i] = await fn(items[i]);
      }
    });
    await Promise.all(workers);
    return results;
  }
}
