import { CACHE_MANAGER } from '@nestjs/cache-manager';
import { Inject, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Cache } from 'cache-manager';
import { GooglePhotosService } from '../google-photos/google-photos.service';
import {
  GoogleMediaItem,
  MediaIndexEntry,
} from '../google-photos/interfaces/media-item.interface';

const INDEX_KEY = 'album:index';
const baseUrlKey = (id: string) => `media:fresh:${id}`;

/**
 * Two-layer cache that makes the API efficient AND correct despite Google's
 * 60-minute baseUrl expiry:
 *
 *  1. Album index  — the ordered list of {id + metadata}. IDs are permanent,
 *     so this is cached for ALBUM_INDEX_TTL and busted whenever we upload.
 *  2. Fresh items  — per-id GoogleMediaItem (incl. a fresh baseUrl), cached for
 *     BASE_URL_TTL (< 3600s). Only items actually being served are fetched,
 *     and only when their cached URL is missing/stale.
 */
@Injectable()
export class PhotoCacheService {
  private readonly logger = new Logger(PhotoCacheService.name);
  private readonly indexTtl: number;
  private readonly baseUrlTtl: number;

  constructor(
    @Inject(CACHE_MANAGER) private readonly cache: Cache,
    private readonly photos: GooglePhotosService,
    config: ConfigService,
  ) {
    this.indexTtl = config.get<number>('cache.albumIndexTtl')!;
    this.baseUrlTtl = config.get<number>('cache.baseUrlTtl')!;
  }

  /** Ordered album index, from cache unless `refresh` is requested. */
  async getIndex(albumId: string, refresh = false): Promise<MediaIndexEntry[]> {
    if (!refresh) {
      const cached = await this.cache.get<MediaIndexEntry[]>(INDEX_KEY);
      if (cached) return cached;
    }
    const index = await this.photos.listAllMediaIndex(albumId);
    await this.cache.set(INDEX_KEY, index, this.indexTtl * 1000);
    this.logger.debug(`Synced album index: ${index.length} items`);
    return index;
  }

  /** Drops the cached index so the next read re-syncs (call after uploads). */
  async bustIndex(): Promise<void> {
    await this.cache.del(INDEX_KEY);
  }

  /**
   * Returns a map id -> media item with a FRESH baseUrl. Reuses cached fresh
   * items; batch-fetches only the misses (or everything when `refresh`).
   */
  async getFreshByIds(
    ids: string[],
    refresh = false,
  ): Promise<Map<string, GoogleMediaItem>> {
    const result = new Map<string, GoogleMediaItem>();
    const misses: string[] = [];

    for (const id of ids) {
      if (refresh) {
        misses.push(id);
        continue;
      }
      const cached = await this.cache.get<GoogleMediaItem>(baseUrlKey(id));
      // Only use cached value if it has a baseUrl; otherwise re-fetch so that
      // items stored right after batchCreate (before Google finishes processing)
      // get a proper URL on the next request.
      if (cached?.baseUrl) result.set(id, cached);
      else misses.push(id);
    }

    if (misses.length > 0) {
      const fetched = await this.photos.batchGet(misses);
      for (const item of fetched) {
        result.set(item.id, item);
        await this.cache.set(baseUrlKey(item.id), item, this.baseUrlTtl * 1000);
      }
    }

    return result;
  }

  /** Pre-warm the fresh cache for items we just created, but only when Google
   *  has already assigned a baseUrl.  batchCreate sometimes returns items that
   *  are still processing and lack baseUrl; skipping them here lets the next
   *  getFreshByIds call fall through to batchGet for a confirmed fresh URL. */
  async primeFresh(items: GoogleMediaItem[]): Promise<void> {
    for (const item of items) {
      if (item?.id && item.baseUrl) {
        await this.cache.set(baseUrlKey(item.id), item, this.baseUrlTtl * 1000);
      }
    }
  }
}
