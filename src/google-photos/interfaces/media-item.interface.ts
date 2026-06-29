/** Subset of the Google Photos `mediaItem` resource that we use. */
export interface GoogleMediaItem {
  id: string;
  description?: string;
  productUrl?: string;
  baseUrl?: string;
  mimeType?: string;
  filename?: string;
  mediaMetadata?: {
    creationTime?: string;
    width?: string;
    height?: string;
    photo?: Record<string, unknown>;
    video?: { status?: string; fps?: number };
  };
}

export interface MediaItemsSearchResponse {
  mediaItems?: GoogleMediaItem[];
  nextPageToken?: string;
}

export interface BatchGetResponse {
  mediaItemResults?: Array<{
    mediaItem?: GoogleMediaItem;
    status?: { code?: number; message?: string };
  }>;
}

export interface NewMediaItemResult {
  uploadToken?: string;
  status?: { code?: number; message?: string };
  mediaItem?: GoogleMediaItem;
}

export interface BatchCreateResponse {
  newMediaItemResults?: NewMediaItemResult[];
}

export interface GoogleAlbum {
  id: string;
  title?: string;
  productUrl?: string;
  isWriteable?: boolean;
  mediaItemsCount?: string;
}

/** Lightweight record we store in the album index cache (no expiring baseUrl). */
export interface MediaIndexEntry {
  id: string;
  filename?: string;
  mimeType?: string;
  description?: string;
  creationTime?: string;
  width?: string;
  height?: string;
}
