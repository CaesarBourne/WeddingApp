import { CacheModule } from '@nestjs/cache-manager';
import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { APP_GUARD } from '@nestjs/core';
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AuthModule } from './auth/auth.module';
import { JwtAuthGuard } from './auth/guards/jwt-auth.guard';
import configuration from './config/configuration';
import { validationSchema } from './config/validation';
import { FoodModule } from './food/food.module';
import { GooglePhotosModule } from './google-photos/google-photos.module';
import { PhotosModule } from './photos/photos.module';
import { User } from './users/entities/user.entity';
import { UsersModule } from './users/users.module';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      load: [configuration],
      validationSchema,
      validationOptions: { allowUnknown: true, abortEarly: false },
    }),

    // In-memory cache by default. Swap `store` for cache-manager-redis-yet
    // (or @keyv/redis) in production for a shared cache across instances.
    CacheModule.register({ isGlobal: true }),

    ThrottlerModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService) => [
        {
          ttl: config.get<number>('throttle.ttl')! * 1000,
          limit: config.get<number>('throttle.limit')!,
        },
      ],
    }),

    TypeOrmModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService) => {
        const type = config.get<'sqlite' | 'postgres'>('db.type');
        const common = {
          entities: [User],
          autoLoadEntities: true,
        };
        if (type === 'postgres') {
          return {
            type: 'postgres' as const,
            host: config.get<string>('db.host'),
            port: config.get<number>('db.port'),
            username: config.get<string>('db.username'),
            password: config.get<string>('db.password'),
            database: config.get<string>('db.database'),
            ssl: config.get<boolean>('db.ssl')
              ? { rejectUnauthorized: false }
              : false,
            // Postgres holds real production data — no auto-DDL. Add columns/tables
            // manually (Supabase SQL editor) or temporarily flip this on to sync a
            // new entity, then flip back off.
            synchronize: false,
            ...common,
          };
        }
        return {
          type: 'better-sqlite3' as const,
          database: config.get<string>('db.database'),
          synchronize: true, // local/dev only — file is ephemeral, safe to auto-sync
          ...common,
        };
      },
    }),

    UsersModule,
    AuthModule,
    GooglePhotosModule,
    PhotosModule,
    FoodModule,
  ],
  providers: [
    // Every route requires a JWT unless @Public(); then rate-limit everything.
    { provide: APP_GUARD, useClass: JwtAuthGuard },
    { provide: APP_GUARD, useClass: ThrottlerGuard },
  ],
})
export class AppModule {}
