import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { GooglePhotosModule } from '../google-photos/google-photos.module';
import { PhotoMeta } from './entities/photo-meta.entity';
import { PhotoCacheService } from './photo-cache.service';
import { PhotoMetaService } from './photo-meta.service';
import { PhotosController } from './photos.controller';
import { PhotosService } from './photos.service';

@Module({
  imports: [GooglePhotosModule, TypeOrmModule.forFeature([PhotoMeta])],
  controllers: [PhotosController],
  providers: [PhotosService, PhotoCacheService, PhotoMetaService],
})
export class PhotosModule {}
