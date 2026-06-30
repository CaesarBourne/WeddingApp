import {
  Body,
  Controller,
  Get,
  Param,
  Post,
  Query,
  Request,
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
import { AuthUser } from '../common/decorators/current-user.decorator';
import { ListPhotosDto, UploadPhotoDto } from './dto/list-photos.dto';
import { PhotosService } from './photos.service';

const MAX_FILE_SIZE = 200 * 1024 * 1024;
const MAX_BULK_FILES = 200;

@ApiTags('photos')
@ApiBearerAuth()
@Controller('photos')
export class PhotosController {
  constructor(private readonly photos: PhotosService) {}

  @Get()
  @ApiOperation({ summary: 'List all wedding photos (paginated).' })
  list(@Query() query: ListPhotosDto) {
    return this.photos.list(query.page, query.pageSize, query.refresh);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get one photo with a fresh URL.' })
  @ApiQuery({ name: 'refresh', required: false, type: Boolean })
  getOne(@Param('id') id: string, @Query('refresh') refresh?: string) {
    return this.photos.getOne(id, refresh === 'true' || refresh === '1');
  }

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
    @Request() req: { user: AuthUser },
  ) {
    return this.photos.uploadSingle(file, body.description, {
      id: req.user.sub,
      name: req.user.name,
    });
  }

  @Post('upload/bulk')
  @ApiOperation({ summary: 'Bulk-upload many photos/videos to the wedding album.' })
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
    @Request() req: { user: AuthUser },
  ) {
    return this.photos.uploadBulk(files, body.description, {
      id: req.user.sub,
      name: req.user.name,
    });
  }

  @Post('refresh')
  @UseGuards(RolesGuard)
  @Roles(Role.ADMIN, Role.SUPER_ADMIN)
  @ApiOperation({ summary: 'Force a full re-sync of the album index and drop cached URLs.' })
  refresh() {
    return this.photos.refresh();
  }
}
