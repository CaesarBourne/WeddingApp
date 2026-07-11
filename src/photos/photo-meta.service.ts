import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, Repository } from 'typeorm';
import { PhotoMeta, PhotoSource, PhotoStatus } from './entities/photo-meta.entity';

export interface PhotoMetaOptions {
  status?: PhotoStatus;
  source?: PhotoSource;
  isAnonymous?: boolean;
}

/** One media item to record, with the metadata the public gallery renders. */
export interface PhotoMetaInput {
  googlePhotoId: string;
  filename?: string | null;
  mimeType?: string | null;
  width?: number | null;
  height?: number | null;
  creationTime?: string | null;
}

@Injectable()
export class PhotoMetaService {
  constructor(
    @InjectRepository(PhotoMeta)
    private readonly repo: Repository<PhotoMeta>,
  ) {}

  async saveMany(
    items: PhotoMetaInput[],
    uploader: { id: string; name?: string | null } | null,
    opts: PhotoMetaOptions = {},
  ): Promise<void> {
    if (!items.length) return;
    const entities = items.map((it) =>
      this.repo.create({
        googlePhotoId: it.googlePhotoId,
        filename: it.filename ?? null,
        mimeType: it.mimeType ?? null,
        width: it.width ?? null,
        height: it.height ?? null,
        creationTime: it.creationTime ?? null,
        uploaderId: uploader?.id ?? null,
        uploaderName: uploader?.name ?? null,
        status: opts.status ?? 'approved',
        source: opts.source ?? 'guest',
        isAnonymous: opts.isAnonymous ?? false,
      }),
    );
    await this.repo
      .createQueryBuilder()
      .insert()
      .into(PhotoMeta)
      .values(entities)
      .orIgnore()
      .execute();
  }

  async findByGoogleIds(ids: string[]): Promise<Map<string, PhotoMeta>> {
    if (!ids.length) return new Map();
    const metas = await this.repo.find({ where: { googlePhotoId: In(ids) } });
    return new Map(metas.map((m) => [m.googlePhotoId, m]));
  }

  /** Moderation queue: all rows in a given state, newest first. */
  async findByStatus(status: PhotoStatus): Promise<PhotoMeta[]> {
    return this.repo.find({
      where: { status },
      order: { uploadedAt: 'DESC' },
    });
  }

  /** Paginated rows in a given state, newest first, plus the total count. */
  async findByStatusPaged(
    status: PhotoStatus,
    skip: number,
    take: number,
  ): Promise<{ rows: PhotoMeta[]; total: number }> {
    const [rows, total] = await this.repo.findAndCount({
      where: { status },
      order: { uploadedAt: 'DESC' },
      skip,
      take,
    });
    return { rows, total };
  }

  async updateStatus(googlePhotoId: string, status: PhotoStatus): Promise<void> {
    await this.repo.update({ googlePhotoId }, { status });
  }
}
