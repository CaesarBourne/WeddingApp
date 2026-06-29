import { Module } from '@nestjs/common';
import { GooglePhotosModule } from '../google-photos/google-photos.module';
import { PhotoCacheService } from './photo-cache.service';
import { PhotosController } from './photos.controller';
import { PhotosService } from './photos.service';

@Module({
  imports: [GooglePhotosModule],
  controllers: [PhotosController],
  providers: [PhotosService, PhotoCacheService],
})
export class PhotosModule {}
