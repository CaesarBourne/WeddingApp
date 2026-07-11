import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { IsBoolean, IsIn, IsOptional, IsString, MaxLength } from 'class-validator';
import { PaginationQueryDto } from '../../common/dto/pagination-query.dto';
import type { PhotoStatus } from '../entities/photo-meta.entity';

/** Query params for GET /photos — pagination + refresh. */
export class ListPhotosDto extends PaginationQueryDto {}

/** Optional metadata applied to uploaded media. */
export class UploadPhotoDto {
  @ApiPropertyOptional({
    description: 'Optional human description stored on the media item(s).',
    maxLength: 1000,
  })
  @IsOptional()
  @IsString()
  @MaxLength(1000)
  description?: string;

  @ApiPropertyOptional({
    type: Boolean,
    description: "Hide the uploader's name publicly (attribution is still stored).",
  })
  @IsOptional()
  // multipart/form-data sends booleans as strings — coerce "true"/"false".
  @Transform(({ value }) => value === true || value === 'true')
  @IsBoolean()
  isAnonymous?: boolean;
}

/** Query for GET /photos/moderation — which moderation state to list. */
export class ModerationQueryDto {
  @ApiPropertyOptional({ enum: ['pending', 'approved', 'rejected'], default: 'pending' })
  @IsOptional()
  @IsIn(['pending', 'approved', 'rejected'])
  status: PhotoStatus = 'pending';
}

/** Body for PATCH /photos/:id/status — the moderation decision. */
export class ModeratePhotoDto {
  @ApiProperty({ enum: ['approved', 'rejected'] })
  @IsIn(['approved', 'rejected'])
  status: 'approved' | 'rejected';
}
