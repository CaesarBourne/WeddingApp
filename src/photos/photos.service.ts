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
import {
  PhotoMeta,
  PhotoSource,
  PhotoStatus,
} from './entities/photo-meta.entity';
import { PhotoMetaInput, PhotoMetaService } from './photo-meta.service';

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
  /** 'couple' (crown badge, sorts first) or 'guest'. Defaults to 'guest' for legacy photos. */
  source: PhotoSource;
  /** Moderation state — present on moderation-queue responses. */
  status?: PhotoStatus;
}

/** Authenticated uploader context passed from the controller. */
export interface Uploader {
  id: string;
  name?: string | null;
  role: string;
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
    _refresh = false,
  ): Promise<PaginatedResult<PhotoDto>> {
    // The public gallery is a pure DB read: approved rows carry the metadata the
    // grid needs, and images load on demand via /photos/:id/raw. No Google call
    // per list means it's fast, and moderation (a DB status change) takes effect
    // instantly with no dependency on Google's eventually-consistent album search
    // or transient batchGet failures. Photos still live in the couple's album
    // (written at upload) for their keepsake.
    const skip = (page - 1) * pageSize;
    const { rows, total } = await this.photoMeta.findByStatusPaged(
      'approved',
      skip,
      pageSize,
    );

    const data = rows.map((m) => this.toDtoFromMeta(m));
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
    // Public endpoint: deny non-approved media. Admins preview pending/rejected
    // items via the moderation endpoints (which return a fresh URL directly), not
    // through /raw. Legacy items (no PhotoMeta row) are treated as approved.
    const metaMap = await this.photoMeta.findByGoogleIds([id]);
    const meta = metaMap.get(id);
    if (meta && meta.status !== 'approved') {
      throw new NotFoundException('Photo not found in the wedding album.');
    }

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
    uploader?: Uploader | null,
    isAnonymous = false,
  ): Promise<PhotoDto> {
    this.assertValid(file);
    const mod = this.moderationFor(uploader);
    const albumId = await this.google.getAlbumId();

    const uploadToken = await this.google.uploadBytes(
      file.buffer,
      file.mimetype,
      file.originalname,
    );
    // All uploads go into the album; the DB `status` (not album membership) is the
    // source of truth for public visibility. Guest uploads are recorded `pending`
    // and filtered out of the public list + /raw until an admin approves them.
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
      this.photoMeta.saveMany([this.metaInputFromItem(result.mediaItem)], uploader ?? null, {
        status: mod.status,
        source: mod.source,
        isAnonymous,
      }),
    ]);

    return this.toDto(
      this.indexFromItem(result.mediaItem),
      result.mediaItem,
      undefined,
      uploader,
    );
  }

  async uploadBulk(
    files: Express.Multer.File[],
    description?: string,
    uploader?: Uploader | null,
    isAnonymous = false,
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
    const mod = this.moderationFor(uploader);
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

    await Promise.all([
      this.cache.bustIndex(),
      this.cache.primeFresh(createdItems),
      this.photoMeta.saveMany(
        createdItems.map((m) => this.metaInputFromItem(m)),
        uploader ?? null,
        { status: mod.status, source: mod.source, isAnonymous },
      ),
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

  // ──────────────────────────── Moderation ────────────────────────────

  /**
   * Lists media by moderation state for the admin queue. Reads from PhotoMeta
   * (not the album), so it surfaces `pending` items that are library-only and
   * absent from the public gallery. Resolves fresh URLs by media-item id.
   */
  async listModeration(status: PhotoStatus): Promise<PhotoDto[]> {
    const metas = await this.photoMeta.findByStatus(status);
    if (!metas.length) return [];

    const ids = metas.map((m) => m.googlePhotoId);
    const metaMap = new Map(metas.map((m) => [m.googlePhotoId, m]));
    const fresh = await this.cache.getFreshByIds(ids);

    return ids
      .map((id) => {
        const item = fresh.get(id);
        if (!item) return null;
        return this.toDto(this.indexFromItem(item), item, metaMap.get(id));
      })
      .filter((d): d is PhotoDto => d !== null);
  }

  /**
   * Approve or reject an upload. Moderation is a pure DB status change — the public
   * list and /raw both read this status, so the change takes effect instantly with
   * no Google write (no album-membership propagation delay, no edit-scope needed).
   * The media stays in the album/library either way.
   */
  async setStatus(
    googlePhotoId: string,
    status: 'approved' | 'rejected',
  ): Promise<{ id: string; status: PhotoStatus }> {
    const metaMap = await this.photoMeta.findByGoogleIds([googlePhotoId]);
    if (!metaMap.get(googlePhotoId)) {
      throw new NotFoundException('Photo not found.');
    }
    await this.photoMeta.updateStatus(googlePhotoId, status);
    return { id: googlePhotoId, status };
  }

  // ──────────────────────────── Helpers ────────────────────────────

  /** Moderation fields for a new upload, from the uploader's role. */
  private moderationFor(uploader?: Uploader | null): {
    status: PhotoStatus;
    source: PhotoSource;
  } {
    const isGuest = uploader?.role === 'guest';
    return isGuest
      ? { status: 'pending', source: 'guest' }
      : { status: 'approved', source: 'couple' };
  }

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
    uploaderOverride?: Uploader | null,
  ): PhotoDto {
    const baseUrl = fresh?.baseUrl;
    const isVideo = (entry.mimeType ?? '').startsWith('video/');
    const videoSuffix = '=dv';
    const displaySuffix = isVideo ? videoSuffix : '=w1600';
    const downloadSuffix = isVideo ? videoSuffix : '=d';
    // Anonymity hides the display name only; the id (attribution) is still returned.
    const anonymous = meta?.isAnonymous ?? false;
    const uploaderName = anonymous
      ? null
      : (uploaderOverride?.name ?? meta?.uploaderName ?? null);
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
      uploaderName,
      uploadedAt: meta?.uploadedAt?.toISOString() ?? null,
      source: meta?.source ?? 'guest',
      status: meta?.status,
    };
  }

  /** Build a PhotoDto straight from a stored PhotoMeta row (no Google call). */
  private toDtoFromMeta(m: PhotoMeta): PhotoDto {
    return {
      id: m.googlePhotoId,
      filename: m.filename ?? undefined,
      mimeType: m.mimeType ?? undefined,
      description: undefined,
      creationTime: m.creationTime ?? undefined,
      width: m.width ?? undefined,
      height: m.height ?? undefined,
      rawUrl: `/photos/${m.googlePhotoId}/raw?size=display`,
      uploaderId: m.uploaderId,
      uploaderName: m.isAnonymous ? null : m.uploaderName,
      uploadedAt: m.uploadedAt?.toISOString() ?? null,
      source: m.source,
      status: m.status,
    };
  }

  /** Extract the metadata we persist for the gallery from a Google media item. */
  private metaInputFromItem(m: GoogleMediaItem): PhotoMetaInput {
    return {
      googlePhotoId: m.id,
      filename: m.filename ?? null,
      mimeType: m.mimeType ?? null,
      width: m.mediaMetadata?.width ? Number(m.mediaMetadata.width) : null,
      height: m.mediaMetadata?.height ? Number(m.mediaMetadata.height) : null,
      creationTime: m.mediaMetadata?.creationTime ?? null,
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
