import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { RolesGuard } from '../auth/guards/roles.guard';
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

  private toDto(u: ReturnType<UsersService['createGuest']> extends Promise<infer T> ? T : never) {
    return {
      id: u.id,
      name: u.name,
      email: u.email,
      role: u.role,
      isActive: u.isActive,
      guestToken: u.guestToken,
      buttonEnabled: u.buttonEnabled,
      createdAt: u.createdAt,
    };
  }
}
