import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsOptional, IsString, MaxLength } from 'class-validator';
import { PaginationQueryDto } from '../../common/dto/pagination-query.dto';

/** Query params for GET /photos — pagination + refresh. */
export class ListPhotosDto extends PaginationQueryDto {}

/** Optional description applied to uploaded media. */
export class UploadPhotoDto {
  @ApiPropertyOptional({
    description: 'Optional human description stored on the media item(s).',
    maxLength: 1000,
  })
  @IsOptional()
  @IsString()
  @MaxLength(1000)
  description?: string;
}
