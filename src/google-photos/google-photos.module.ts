import { HttpModule } from '@nestjs/axios';
import { Module } from '@nestjs/common';
import { GoogleAuthService } from './google-auth.service';
import { GooglePhotosController } from './google-photos.controller';
import { GooglePhotosService } from './google-photos.service';

@Module({
  imports: [
    HttpModule.register({
      timeout: 60_000,
      maxRedirects: 0,
    }),
  ],
  controllers: [GooglePhotosController],
  providers: [GoogleAuthService, GooglePhotosService],
  exports: [GoogleAuthService, GooglePhotosService],
})
export class GooglePhotosModule {}
