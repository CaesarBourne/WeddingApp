import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Post,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../common/decorators/roles.decorator';
import { Role } from '../common/enums/role.enum';
import { IsNotEmpty, IsString, MaxLength } from 'class-validator';
import { UsersService } from './users.service';

export class CreateGuestDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(80)
  name: string;
}

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

  @Delete('guests/:id')
  @ApiOperation({ summary: 'Delete a guest account (admin+).' })
  async deleteGuest(@Param('id') id: string) {
    await this.users.deleteGuest(id);
    return { deleted: true };
  }

  private toDto(u: ReturnType<UsersService['createGuest']> extends Promise<infer T> ? T : never) {
    return {
      id: u.id,
      name: u.name,
      email: u.email,
      role: u.role,
      isActive: u.isActive,
      guestToken: u.guestToken,
      createdAt: u.createdAt,
    };
  }
}
