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

  /** Seeds a super-admin from env on first boot so the API is usable immediately. */
  async onModuleInit(): Promise<void> {
    const email = this.config.get<string>('seedAdmin.email')!;
    const password = this.config.get<string>('seedAdmin.password')!;

    const existing = await this.repo.findOne({ where: { email } });
    if (existing) return;

    await this.create({
      email,
      password,
      name: 'Super Admin',
      role: Role.SUPER_ADMIN,
    });
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

  findByEmail(email: string): Promise<User | null> {
    return this.repo.findOne({ where: { email: email.toLowerCase().trim() } });
  }

  async findById(id: string): Promise<User> {
    const user = await this.repo.findOne({ where: { id } });
    if (!user) throw new NotFoundException('User not found.');
    return user;
  }

  async findAll(): Promise<User[]> {
    return this.repo.find({ order: { createdAt: 'ASC' } });
  }

  async verifyPassword(user: User, password: string): Promise<boolean> {
    return bcrypt.compare(password, user.passwordHash);
  }

  async setActive(id: string, isActive: boolean): Promise<User> {
    const user = await this.findById(id);
    user.isActive = isActive;
    return this.repo.save(user);
  }
}
