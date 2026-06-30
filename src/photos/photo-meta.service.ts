import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, Repository } from 'typeorm';
import { PhotoMeta } from './entities/photo-meta.entity';

@Injectable()
export class PhotoMetaService {
  constructor(
    @InjectRepository(PhotoMeta)
    private readonly repo: Repository<PhotoMeta>,
  ) {}

  async saveMany(
    googlePhotoIds: string[],
    uploader: { id: string; name?: string | null } | null,
  ): Promise<void> {
    if (!googlePhotoIds.length) return;
    const entities = googlePhotoIds.map((googlePhotoId) =>
      this.repo.create({
        googlePhotoId,
        uploaderId: uploader?.id ?? null,
        uploaderName: uploader?.name ?? null,
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
}
