import {
  Body,
  Controller,
  Get,
  Param,
  Post,
  Query,
  Res,
  UploadedFile,
  UploadedFiles,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import {
  FileInterceptor,
  FilesInterceptor,
} from '@nestjs/platform-express';
import {
  ApiBearerAuth,
  ApiBody,
  ApiConsumes,
  ApiOperation,
  ApiQuery,
  ApiTags,
} from '@nestjs/swagger';
import { Response } from 'express';
import { Public } from '../common/decorators/public.decorator';
import { Roles } from '../common/decorators/roles.decorator';
import { Role } from '../common/enums/role.enum';
import { RolesGuard } from '../auth/guards/roles.guard';
import { ListPhotosDto, UploadPhotoDto } from './dto/list-photos.dto';
import { PhotosService } from './photos.service';

// 200 MB — Google's max photo size. Tune as needed.
const MAX_FILE_SIZE = 200 * 1024 * 1024;
const MAX_BULK_FILES = 200;

@ApiTags('photos')
@ApiBearerAuth()
@Controller('photos')
export class PhotosController {
  constructor(private readonly photos: PhotosService) {}

  @Get()
  @ApiOperation({
    summary: 'List all wedding photos (paginated).',
    description:
      'Returns every media item in the shared wedding album. Each item includes a stable `rawUrl` (recommended for <img src>) plus fresh, expiring Google URLs.',
  })
  list(@Query() query: ListPhotosDto) {
    return this.photos.list(query.page, query.pageSize, query.refresh);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get one photo with a fresh URL.' })
  @ApiQuery({ name: 'refresh', required: false, type: Boolean })
  getOne(@Param('id') id: string, @Query('refresh') refresh?: string) {
    return this.photos.getOne(id, refresh === 'true' || refresh === '1');
  }

  /**
   * Stable image endpoint. Frontends point <img src> here and it 302-redirects
   * to a freshly-resolved Google URL — so the browser never sees an expired link.
   * Public so <img> tags work without attaching a JWT; the id is an opaque,
   * unguessable Google media id. Add auth here if your album must stay private.
   */
  @Public()
  @Get(':id/raw')
  @ApiOperation({ summary: 'Redirect to a fresh, sized image/video URL.' })
  @ApiQuery({
    name: 'size',
    required: false,
    description: 'thumb | display | download | a raw param like w800-h600',
  })
  async raw(
    @Param('id') id: string,
    @Res() res: Response,
    @Query('size') size = 'display',
  ) {
    const url = await this.photos.resolveRawUrl(id, size);
    // Short cache: the underlying Google URL expires in ~60 min.
    res.setHeader('Cache-Control', 'private, max-age=300');
    return res.redirect(302, url);
  }

  @Post('upload')
  @ApiOperation({ summary: 'Upload a single photo/video to the wedding album.' })
  @ApiConsumes('multipart/form-data')
  @ApiBody({
    schema: {
      type: 'object',
      properties: {
        file: { type: 'string', format: 'binary' },
        description: { type: 'string' },
      },
      required: ['file'],
    },
  })
  @UseInterceptors(
    FileInterceptor('file', { limits: { fileSize: MAX_FILE_SIZE } }),
  )
  uploadSingle(
    @UploadedFile() file: Express.Multer.File,
    @Body() body: UploadPhotoDto,
  ) {
    return this.photos.uploadSingle(file, body.description);
  }

  @Post('upload/bulk')
  @ApiOperation({
    summary: 'Bulk-upload many photos/videos to the wedding album.',
    description: `Send up to ${MAX_BULK_FILES} files under the "files" field.`,
  })
  @ApiConsumes('multipart/form-data')
  @ApiBody({
    schema: {
      type: 'object',
      properties: {
        files: {
          type: 'array',
          items: { type: 'string', format: 'binary' },
        },
        description: { type: 'string' },
      },
      required: ['files'],
    },
  })
  @UseInterceptors(
    FilesInterceptor('files', MAX_BULK_FILES, {
      limits: { fileSize: MAX_FILE_SIZE },
    }),
  )
  uploadBulk(
    @UploadedFiles() files: Express.Multer.File[],
    @Body() body: UploadPhotoDto,
  ) {
    return this.photos.uploadBulk(files, body.description);
  }

  @Post('refresh')
  @UseGuards(RolesGuard)
  @Roles(Role.ADMIN, Role.SUPER_ADMIN)
  @ApiOperation({
    summary: 'Force a full re-sync of the album index and drop cached URLs.',
  })
  refresh() {
    return this.photos.refresh();
  }
}
