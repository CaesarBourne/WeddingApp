import { Injectable, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PassportStrategy } from '@nestjs/passport';
import { ExtractJwt, Strategy } from 'passport-jwt';
import { Role } from '../../common/enums/role.enum';
import { UsersService } from '../../users/users.service';

export interface JwtPayload {
  sub: string;
  email: string;
  role: string;
  jti?: string;
}

@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy) {
  constructor(
    config: ConfigService,
    private readonly usersService: UsersService,
  ) {
    super({
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      ignoreExpiration: false,
      secretOrKey: config.get<string>('jwt.secret')!,
    });
  }

  async validate(payload: JwtPayload): Promise<JwtPayload> {
    const user = await this.usersService.findById(payload.sub).catch(() => null);
    if (!user?.isActive) {
      throw new UnauthorizedException('Account is inactive or no longer exists.');
    }

    // One-device enforcement: each QR scan issues a new jti and revokes the old one.
    if (user.role === Role.GUEST && payload.jti !== user.currentJti) {
      throw new UnauthorizedException(
        'This session has been superseded. Please re-scan your QR code.',
      );
    }

    return { sub: user.id, email: user.email ?? '', role: user.role, jti: payload.jti };
  }
}
