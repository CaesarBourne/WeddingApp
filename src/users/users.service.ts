import {
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
  OnModuleInit,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import * as bcrypt from 'bcryptjs';
import { randomBytes } from 'node:crypto';
import { Repository } from 'typeorm';
import { Role } from '../common/enums/role.enum';
import { User } from './entities/user.entity';

const SALT_ROUNDS = 12;

@Injectable()
export class UsersService implements OnModuleInit {
  private readonly logger = new Logger(UsersService.name);

  constructor(
    @InjectRepository(User) private readonly repo: Repository<User>,
    private readonly config: ConfigService,
  ) {}

  async onModuleInit(): Promise<void> {
    const email = this.config.get<string>('seedAdmin.email')!;
    const password = this.config.get<string>('seedAdmin.password')!;

    const existing = await this.repo.findOne({ where: { email } });
    if (existing) return;

    await this.create({ email, password, name: 'Super Admin', role: Role.SUPER_ADMIN });
    this.logger.log(`Seeded super-admin account: ${email}`);
  }

  async create(input: {
    email: string;
    password: string;
    name?: string;
    role?: Role;
  }): Promise<User> {
    const email = input.email.toLowerCase().trim();
    const exists = await this.repo.findOne({ where: { email } });
    if (exists) {
      throw new ConflictException('An account with that email already exists.');
    }
    const passwordHash = await bcrypt.hash(input.password, SALT_ROUNDS);
    const user = this.repo.create({
      email,
      passwordHash,
      name: input.name,
      role: input.role ?? Role.ADMIN,
    });
    return this.repo.save(user);
  }

  async createGuest(name: string): Promise<User> {
    const guestToken = randomBytes(32).toString('hex');
    const guestNumber = await this.nextGuestNumber();
    const user = this.repo.create({
      name,
      guestToken,
      role: Role.GUEST,
      isActive: true,
      guestNumber,
    });
    return this.repo.save(user);
  }

  /** Next sequential guest number: max assigned so far + 1. Stable across deletions. */
  private async nextGuestNumber(): Promise<number> {
    const result = await this.repo
      .createQueryBuilder('u')
      .select('MAX(u.guestNumber)', 'max')
      .where('u.role = :role', { role: Role.GUEST })
      .getRawOne<{ max: number | string | null }>();
    return Number(result?.max ?? 0) + 1;
  }

  async findByEmail(email: string): Promise<User | null> {
    // passwordHash is select:false — must be explicitly added for login check
    return this.repo
      .createQueryBuilder('user')
      .addSelect('user.passwordHash')
      .where('user.email = :email', { email: email.toLowerCase().trim() })
      .getOne();
  }

  async findById(id: string): Promise<User> {
    const user = await this.repo.findOne({ where: { id } });
    if (!user) throw new NotFoundException('User not found.');
    return user;
  }

  async findAll(): Promise<User[]> {
    return this.repo.find({ order: { createdAt: 'ASC' } });
  }

  findByGuestToken(token: string): Promise<User | null> {
    return this.repo.findOne({ where: { guestToken: token, isActive: true } });
  }

  async setCurrentJti(userId: string, jti: string): Promise<void> {
    await this.repo.update(userId, { currentJti: jti });
  }

  async verifyPassword(user: User, password: string): Promise<boolean> {
    if (!user.passwordHash) return false;
    return bcrypt.compare(password, user.passwordHash);
  }

  async setButtonEnabled(id: string, enabled: boolean): Promise<void> {
    await this.repo.update(id, { buttonEnabled: enabled });
  }

  async setAvatar(id: string, avatarPath: string): Promise<void> {
    await this.repo.update(id, { avatarPath });
  }

  async setSeatNumber(id: string, seatNumber: string | null): Promise<void> {
    await this.repo.update(id, { seatNumber });
  }

  async admitUser(id: string): Promise<User> {
    const user = await this.findById(id);
    if (user.admissionStatus === 'admitted') return user;
    user.admissionStatus = 'admitted';
    user.admittedAt = new Date();
    return this.repo.save(user);
  }

  async deleteGuest(id: string): Promise<void> {
    const user = await this.findById(id);
    if (user.role !== Role.GUEST) {
      throw new ConflictException('Only guest accounts can be deleted this way.');
    }
    await this.repo.remove(user);
  }

  async deleteAdmin(id: string): Promise<void> {
    const user = await this.findById(id);
    if (user.role !== Role.ADMIN) {
      throw new ConflictException('Only regular admin accounts can be removed this way.');
    }
    await this.repo.remove(user);
  }
}
