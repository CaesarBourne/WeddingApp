import * as fs from 'node:fs';
import * as path from 'node:path';
import {
  Body,
  Controller,
  Delete,
  ForbiddenException,
  Get,
  NotFoundException,
  Param,
  Patch,
  Post,
  Res,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Response } from 'express';
import { RolesGuard } from '../auth/guards/roles.guard';
import { AuthUser, CurrentUser } from '../common/decorators/current-user.decorator';
import { Public } from '../common/decorators/public.decorator';
import { Roles } from '../common/decorators/roles.decorator';
import { Role } from '../common/enums/role.enum';
import { IsBoolean, IsNotEmpty, IsString, MaxLength } from 'class-validator';
import { UsersService } from './users.service';

export class CreateGuestDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(80)
  name: string;
}

export class SetButtonDto {
  @IsBoolean()
  enabled: boolean;
}

const AVATARS_DIR = path.resolve(process.cwd(), 'data', 'avatars');
const ALLOWED_MIME = new Set(['image/jpeg', 'image/png', 'image/webp', 'image/gif']);
const EXT_MAP: Record<string, string> = {
  'image/jpeg': '.jpg',
  'image/png': '.png',
  'image/webp': '.webp',
  'image/gif': '.gif',
};

@ApiTags('users')
@ApiBearerAuth()
@UseGuards(RolesGuard)
@Roles(Role.ADMIN, Role.SUPER_ADMIN)
@Controller('users')
export class UsersController {
  constructor(private readonly users: UsersService) {}

  @Post('guests')
  @ApiOperation({ summary: 'Create a guest user with a QR token (admin+).' })
  async createGuest(@Body() dto: CreateGuestDto) {
    const user = await this.users.createGuest(dto.name);
    return this.toDto(user);
  }

  @Get()
  @ApiOperation({ summary: 'List all users (admin+).' })
  async findAll() {
    const users = await this.users.findAll();
    return users.map((u) => this.toDto(u));
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get a single user by ID (admin+).' })
  async findOne(@Param('id') id: string) {
    const user = await this.users.findById(id);
    return this.toDto(user);
  }

  @Patch('guests/:id/button')
  @ApiOperation({ summary: 'Enable or disable the second action button on a guest welcome page (admin+).' })
  async setButton(@Param('id') id: string, @Body() dto: SetButtonDto) {
    await this.users.setButtonEnabled(id, dto.enabled);
    return { id, buttonEnabled: dto.enabled };
  }

  @Delete('guests/:id')
  @ApiOperation({ summary: 'Delete a guest account (admin+).' })
  async deleteGuest(@Param('id') id: string) {
    await this.users.deleteGuest(id);
    return { deleted: true };
  }

  /** Guest or admin uploads their own avatar. */
  @Post('me/avatar')
  @Roles(Role.ADMIN, Role.SUPER_ADMIN, Role.GUEST)
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: 8 * 1024 * 1024 } }))
  @ApiOperation({ summary: 'Upload own avatar (any authenticated user).' })
  async uploadMyAvatar(
    @CurrentUser() requester: AuthUser,
    @UploadedFile() file: Express.Multer.File,
  ) {
    return this.saveAvatar(requester.sub, file);
  }

  /** Admin sets the avatar for any user. */
  @Patch(':id/avatar')
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: 8 * 1024 * 1024 } }))
  @ApiOperation({ summary: 'Admin sets a user avatar.' })
  async uploadUserAvatar(
    @Param('id') id: string,
    @UploadedFile() file: Express.Multer.File,
  ) {
    return this.saveAvatar(id, file);
  }

  /** Serve a user's avatar image. Public so <img> tags can load it without extra headers. */
  @Public()
  @Get(':id/avatar')
  @ApiOperation({ summary: "Serve a user's avatar image (public)." })
  async getAvatar(
    @Param('id') id: string,
    @Res() res: Response,
  ) {
    const user = await this.users.findById(id);
    if (!user.avatarPath || !fs.existsSync(user.avatarPath)) {
      throw new NotFoundException('No avatar set for this user.');
    }

    const ext = path.extname(user.avatarPath).toLowerCase();
    const mimeMap: Record<string, string> = {
      '.jpg': 'image/jpeg',
      '.jpeg': 'image/jpeg',
      '.png': 'image/png',
      '.webp': 'image/webp',
      '.gif': 'image/gif',
    };
    res.set('Content-Type', mimeMap[ext] ?? 'application/octet-stream');
    res.set('Cache-Control', 'private, max-age=300');
    res.send(fs.readFileSync(user.avatarPath));
  }

  /** Admit a guest at the event entrance (admin+). */
  @Post(':id/admit')
  @ApiOperation({ summary: 'Mark a guest as admitted at the event entrance (admin+).' })
  async admitUser(@Param('id') id: string) {
    const user = await this.users.admitUser(id);
    return { id: user.id, admissionStatus: user.admissionStatus, admittedAt: user.admittedAt };
  }

  private toDto(u: import('./entities/user.entity').User) {
    return {
      id: u.id,
      name: u.name,
      email: u.email,
      role: u.role,
      isActive: u.isActive,
      guestToken: u.guestToken,
      buttonEnabled: u.buttonEnabled,
      admissionStatus: u.admissionStatus,
      admittedAt: u.admittedAt,
      avatarUrl: u.avatarPath ? `/users/${u.id}/avatar` : null,
      createdAt: u.createdAt,
    };
  }

  private async saveAvatar(userId: string, file: Express.Multer.File) {
    if (!file) throw new NotFoundException('No file uploaded.');
    if (!ALLOWED_MIME.has(file.mimetype)) {
      throw new ForbiddenException('Only JPEG, PNG, WebP, and GIF avatars are allowed.');
    }
    fs.mkdirSync(AVATARS_DIR, { recursive: true });
    const ext = EXT_MAP[file.mimetype] ?? '.jpg';
    const filePath = path.join(AVATARS_DIR, `${userId}${ext}`);
    fs.writeFileSync(filePath, file.buffer);
    await this.users.setAvatar(userId, filePath);
    return { avatarUrl: `/users/${userId}/avatar` };
  }
}
