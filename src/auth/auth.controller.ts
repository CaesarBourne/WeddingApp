import {
  Body,
  Controller,
  Get,
  NotFoundException,
  Post,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { IsNotEmpty, IsString } from 'class-validator';
import {
  AuthUser,
  CurrentUser,
} from '../common/decorators/current-user.decorator';
import { Public } from '../common/decorators/public.decorator';
import { Roles } from '../common/decorators/roles.decorator';
import { Role } from '../common/enums/role.enum';
import { UsersService } from '../users/users.service';
import { AuthService } from './auth.service';
import { CreateAdminDto } from './dto/create-admin.dto';
import { LoginDto } from './dto/login.dto';
import { RolesGuard } from './guards/roles.guard';

class GuestTokenDto {
  @IsString()
  @IsNotEmpty()
  token: string;
}

@ApiTags('auth')
@Controller('auth')
export class AuthController {
  constructor(
    private readonly authService: AuthService,
    private readonly usersService: UsersService,
  ) {}

  @Public()
  @Post('login')
  @ApiOperation({ summary: 'Authenticate an admin and receive a JWT.' })
  login(@Body() dto: LoginDto) {
    return this.authService.login(dto);
  }

  /** Public endpoint: guest exchanges their QR token for a short-lived JWT.
   *  Every call invalidates the previous session (one active device per guest). */
  @Public()
  @Post('guest')
  @ApiOperation({ summary: 'Exchange a guest QR token for a JWT (magic link).' })
  guestLogin(@Body() dto: GuestTokenDto) {
    return this.authService.guestLogin(dto.token);
  }

  @Get('me')
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Return the currently authenticated user.' })
  me(@CurrentUser() user: AuthUser) {
    return user;
  }

  @Post('admins')
  @ApiBearerAuth()
  @UseGuards(RolesGuard)
  @Roles(Role.SUPER_ADMIN)
  @ApiOperation({ summary: 'Create a new admin account (super-admin only).' })
  async createAdmin(@Body() dto: CreateAdminDto) {
    const user = await this.usersService.create(dto);
    return { id: user.id, email: user.email, name: user.name, role: user.role };
  }

  /** Admin looks up a guest by their QR token without logging in as them.
   *  Used by the entrance-validation scan flow. */
  @Post('guest-info')
  @ApiBearerAuth()
  @UseGuards(RolesGuard)
  @Roles(Role.ADMIN, Role.SUPER_ADMIN)
  @ApiOperation({ summary: 'Return guest profile from a QR token (admin+, does not create a session).' })
  async guestInfo(@Body() dto: GuestTokenDto) {
    const user = await this.usersService.findByGuestToken(dto.token);
    if (!user) throw new NotFoundException('Guest not found or token invalid.');
    return {
      id: user.id,
      name: user.name,
      role: user.role,
      admissionStatus: user.admissionStatus,
      admittedAt: user.admittedAt,
      avatarUrl: user.avatarPath ? `/users/${user.id}/avatar` : null,
    };
  }

  @Get('admins')
  @ApiBearerAuth()
  @UseGuards(RolesGuard)
  @Roles(Role.SUPER_ADMIN)
  @ApiOperation({ summary: 'List all admin accounts (super-admin only).' })
  async listAdmins() {
    const users = await this.usersService.findAll();
    return users
      .filter((u) => u.role !== Role.GUEST)
      .map((u) => ({
        id: u.id,
        email: u.email,
        name: u.name,
        role: u.role,
        isActive: u.isActive,
        createdAt: u.createdAt,
      }));
  }
}
