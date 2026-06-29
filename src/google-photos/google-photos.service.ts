import { HttpService } from '@nestjs/axios';
import {
  BadGatewayException,
  Injectable,
  Logger,
  OnModuleInit,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { AxiosError, AxiosRequestConfig } from 'axios';
import { firstValueFrom } from 'rxjs';
import { GoogleAuthService } from './google-auth.service';
import {
  BatchCreateResponse,
  BatchGetResponse,
  GoogleAlbum,
  GoogleMediaItem,
  MediaIndexEntry,
  MediaItemsSearchResponse,
  NewMediaItemResult,
} from './interfaces/media-item.interface';

const API = 'https://photoslibrary.googleapis.com/v1';
const UPLOAD_URL = `${API}/uploads`;
const BATCH_LIMIT = 50; // Google hard limit for batchCreate & batchGet
const MAX_SEARCH_PAGE = 100;

@Injectable()
export class GooglePhotosService implements OnModuleInit {
  private readonly logger = new Logger(GooglePhotosService.name);
  private resolvedAlbumId: string | null = null;

  constructor(
    private readonly http: HttpService,
    private readonly auth: GoogleAuthService,
    private readonly config: ConfigService,
  ) {}

  async onModuleInit(): Promise<void> {
    // Resolve (or lazily create) the wedding album as soon as Google is connected.
    if (this.auth.isConfigured()) {
      try {
        await this.getAlbumId();
      } catch (err) {
        this.logger.warn(`Could not resolve wedding album on boot: ${err}`);
      }
    }
  }

  // ───────────────────────────── Album ─────────────────────────────

  /** Returns the configured album id, creating one on first use if needed. */
  async getAlbumId(): Promise<string> {
    if (this.resolvedAlbumId) return this.resolvedAlbumId;

    const configured = this.config.get<string>('google.albumId');
    if (configured) {
      this.resolvedAlbumId = configured;
      return configured;
    }

    const title = this.config.get<string>('google.albumTitle')!;
    const album = await this.createAlbum(title);
    this.resolvedAlbumId = album.id;
    this.logger.warn(
      `Created a new wedding album "${title}" (id=${album.id}). ` +
        `Add GOOGLE_PHOTOS_ALBUM_ID=${album.id} to your .env so it is reused.`,
    );
    return album.id;
  }

  async createAlbum(title: string): Promise<GoogleAlbum> {
    return this.request<GoogleAlbum>({
      method: 'POST',
      url: `${API}/albums`,
      data: { album: { title } },
    });
  }

  // ───────────────────────────── Upload ─────────────────────────────

  /**
   * Step 1 of upload: send raw bytes, get a one-day-valid upload token.
   * The MIME type MUST be supplied at this stage (2025 API requirement).
   */
  async uploadBytes(
    bytes: Buffer,
    mimeType: string,
    filename: string,
  ): Promise<string> {
    const token = await this.auth.getAccessToken();
    const { data } = await firstValueFrom(
      this.http.post<string>(UPLOAD_URL, bytes, {
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/octet-stream',
          'X-Goog-Upload-Content-Type': mimeType,
          'X-Goog-Upload-Protocol': 'raw',
          'X-Goog-Upload-File-Name': filename,
        },
        responseType: 'text',
        maxBodyLength: Infinity,
        maxContentLength: Infinity,
      }),
    ).catch((e) => this.fail(e, 'upload bytes'));
    return String(data).trim();
  }

  /**
   * Step 2 of upload: turn upload tokens into media items inside the album.
   * Caller must pass <= 50 items; we batch internally to be safe.
   */
  async batchCreate(
    albumId: string,
    items: Array<{ uploadToken: string; filename: string; description?: string }>,
  ): Promise<NewMediaItemResult[]> {
    const results: NewMediaItemResult[] = [];

    // Serialize batches — Google warns against parallel batchCreate per user.
    for (const chunk of this.chunk(items, BATCH_LIMIT)) {
      const body = {
        albumId,
        newMediaItems: chunk.map((i) => ({
          ...(i.description ? { description: i.description } : {}),
          simpleMediaItem: {
            fileName: i.filename,
            uploadToken: i.uploadToken,
          },
        })),
      };
      const data = await this.request<BatchCreateResponse>({
        method: 'POST',
        url: `${API}/mediaItems:batchCreate`,
        data: body,
        // 207 = partial success; treat as a valid response, not an error.
        validateStatus: (s) => (s >= 200 && s < 300) || s === 207,
      });
      results.push(...(data.newMediaItemResults ?? []));
    }
    return results;
  }

  // ─────────────────────────── Read / list ───────────────────────────

  /** One page of an album search (max 100 items). */
  async searchAlbumPage(
    albumId: string,
    pageSize: number,
    pageToken?: string,
  ): Promise<MediaItemsSearchResponse> {
    return this.request<MediaItemsSearchResponse>({
      method: 'POST',
      url: `${API}/mediaItems:search`,
      data: {
        albumId,
        pageSize: Math.min(pageSize, MAX_SEARCH_PAGE),
        ...(pageToken ? { pageToken } : {}),
      },
    });
  }

  /**
   * Walks the whole album and returns a lightweight, NON-expiring index
   * (ids + metadata, no baseUrls). This is what we cache.
   */
  async listAllMediaIndex(albumId: string): Promise<MediaIndexEntry[]> {
    const out: MediaIndexEntry[] = [];
    let pageToken: string | undefined;
    do {
      const page = await this.searchAlbumPage(albumId, MAX_SEARCH_PAGE, pageToken);
      for (const m of page.mediaItems ?? []) {
        out.push(this.toIndexEntry(m));
      }
      pageToken = page.nextPageToken;
    } while (pageToken);
    return out;
  }

  /**
   * Fetches FRESH baseUrls for a set of ids (chunked into 50s).
   * Use this right before serving images, because baseUrls expire after 60 min.
   * Preserves the input order.
   */
  async batchGet(ids: string[]): Promise<GoogleMediaItem[]> {
    const byId = new Map<string, GoogleMediaItem>();

    for (const chunk of this.chunk(ids, BATCH_LIMIT)) {
      const data = await this.request<BatchGetResponse>({
        method: 'GET',
        url: `${API}/mediaItems:batchGet`,
        params: { mediaItemIds: chunk },
        paramsSerializer: {
          // repeat the key: ?mediaItemIds=a&mediaItemIds=b ...
          serialize: (params: Record<string, string[]>) =>
            params.mediaItemIds
              .map((id) => `mediaItemIds=${encodeURIComponent(id)}`)
              .join('&'),
        },
      });
      for (const r of data.mediaItemResults ?? []) {
        if (r.mediaItem?.id) byId.set(r.mediaItem.id, r.mediaItem);
      }
    }

    return ids.map((id) => byId.get(id)).filter(Boolean) as GoogleMediaItem[];
  }

  // ───────────────────────────── Helpers ─────────────────────────────

  private toIndexEntry(m: GoogleMediaItem): MediaIndexEntry {
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

  private chunk<T>(arr: T[], size: number): T[][] {
    const out: T[][] = [];
    for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
    return out;
  }

  /** Authenticated request with retry/backoff on 429/500/503. */
  private async request<T>(config: AxiosRequestConfig, attempt = 0): Promise<T> {
    const token = await this.auth.getAccessToken();
    try {
      const { data } = await firstValueFrom(
        this.http.request<T>({
          ...config,
          headers: {
            Authorization: `Bearer ${token}`,
            'Content-Type': 'application/json',
            ...(config.headers ?? {}),
          },
        }),
      );
      return data;
    } catch (e) {
      const err = e as AxiosError;
      const status = err.response?.status;
      const retryable = status === 429 || status === 500 || status === 503;
      if (retryable && attempt < 4) {
        const delay = 2 ** attempt * 500 + Math.floor(Math.random() * 250);
        this.logger.warn(
          `Google API ${status} — retrying in ${delay}ms (attempt ${attempt + 1}/4)`,
        );
        await new Promise((r) => setTimeout(r, delay));
        return this.request<T>(config, attempt + 1);
      }
      return this.fail(err, `${config.method} ${config.url}`);
    }
  }

  private fail(e: unknown, action: string): never {
    const err = e as AxiosError<any>;
    const status = err.response?.status;
    const detail =
      err.response?.data?.error?.message ||
      err.response?.data ||
      err.message ||
      'unknown error';
    this.logger.error(`Google Photos ${action} failed (${status}): ${JSON.stringify(detail)}`);
    throw new BadGatewayException(
      `Google Photos request failed (${status ?? 'network error'}): ${
        typeof detail === 'string' ? detail : JSON.stringify(detail)
      }`,
    );
  }
}
