import { CacheModule } from '@nestjs/cache-manager';
import { Logger, Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import * as dns from 'node:dns';
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
import { SeatGroup } from './users/entities/seat-group.entity';
import { User } from './users/entities/user.entity';
import { UsersModule } from './users/users.module';

const dnsLogger = new Logger('DatabaseDns');

/**
 * On some machines Node's dns.lookup() (used internally whenever pg/TypeORM
 * connects with a hostname) intermittently fails with ENOTFOUND against this
 * exact host, even though the hostname resolves fine at the OS/DNS level —
 * dns.lookup() goes through getaddrinfo, which has been unreliable here.
 * Resolving to a literal IP up front makes every connection this pool opens
 * skip dns.lookup entirely (net.connect never resolves an address that's
 * already an IP). The underlying network itself is occasionally flaky too
 * (even a direct dns.resolve4 query can transiently fail), so retry a few
 * times before giving up. Falls back to the original hostname if every
 * attempt fails, so this is never worse than the previous behavior.
 */
async function resolveHostReliably(host: string, attempts = 4): Promise<string> {
  for (let attempt = 1; attempt <= attempts; attempt++) {
    try {
      const addresses = await dns.promises.resolve4(host);
      if (addresses.length > 0) return addresses[0];
    } catch (err) {
      dnsLogger.warn(`Pre-resolve attempt ${attempt}/${attempts} for ${host} failed: ${err}`);
      if (attempt < attempts) await new Promise((r) => setTimeout(r, 500));
    }
  }
  dnsLogger.warn(`Falling back to hostname ${host} after ${attempts} failed pre-resolve attempts.`);
  return host;
}

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
      useFactory: async (config: ConfigService) => {
        const type = config.get<'sqlite' | 'postgres'>('db.type');
        const common = {
          entities: [User, SeatGroup],
          autoLoadEntities: true,
        };
        if (type === 'postgres') {
          const configuredHost = config.get<string>('db.host')!;
          return {
            type: 'postgres' as const,
            host: await resolveHostReliably(configuredHost),
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
