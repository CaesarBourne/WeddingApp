import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { GooglePhotosModule } from '../google-photos/google-photos.module';
import { PhotosModule } from '../photos/photos.module';
import { SeatGroup } from './entities/seat-group.entity';
import { User } from './entities/user.entity';
import { UsersController } from './users.controller';
import { UsersService } from './users.service';

@Module({
  imports: [TypeOrmModule.forFeature([User, SeatGroup]), GooglePhotosModule, PhotosModule],
  controllers: [UsersController],
  providers: [UsersService],
  exports: [UsersService],
})
export class UsersModule {}
