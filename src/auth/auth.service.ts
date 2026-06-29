import { Injectable, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { randomUUID } from 'node:crypto';
import { Role } from '../common/enums/role.enum';
import { User } from '../users/entities/user.entity';
import { UsersService } from '../users/users.service';
import { LoginDto } from './dto/login.dto';

export interface AuthResult {
  accessToken: string;
  user: {
    id: string;
    email: string | null;
    name?: string;
    role: string;
  };
}

@Injectable()
export class AuthService {
  constructor(
    private readonly usersService: UsersService,
    private readonly jwtService: JwtService,
  ) {}

  async login(dto: LoginDto): Promise<AuthResult> {
    const user = await this.usersService.findByEmail(dto.email);
    if (!user?.isActive) {
      throw new UnauthorizedException('Invalid credentials.');
    }
    const valid = await this.usersService.verifyPassword(user, dto.password);
    if (!valid) {
      throw new UnauthorizedException('Invalid credentials.');
    }
    return this.issue(user);
  }

  /** Exchanges a guest QR token for a JWT.  Issues a new jti so any previous
   *  device session is immediately invalidated (one-device enforcement). */
  async guestLogin(token: string): Promise<AuthResult> {
    const user = await this.usersService.findByGuestToken(token);
    if (!user) {
      throw new UnauthorizedException('Invalid or expired guest token.');
    }
    const jti = randomUUID();
    await this.usersService.setCurrentJti(user.id, jti);
    return this.issue(user, jti);
  }

  private issue(user: User, jti?: string): AuthResult {
    const payload: Record<string, unknown> = {
      sub: user.id,
      email: user.email,
      role: user.role,
    };
    if (user.role === Role.GUEST && jti) payload.jti = jti;

    return {
      accessToken: this.jwtService.sign(payload),
      user: { id: user.id, email: user.email, name: user.name, role: user.role },
    };
  }
}
