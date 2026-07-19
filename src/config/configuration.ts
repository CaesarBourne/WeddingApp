export default () => ({
  env: process.env.NODE_ENV || 'development',
  port: parseInt(process.env.PORT ?? '3000', 10),
  corsOrigins: (process.env.CORS_ORIGINS || '*')
    .split(',')
    .map((o) => o.trim())
    .filter(Boolean),

  jwt: {
    secret: process.env.JWT_SECRET || 'insecure-dev-secret',
    expiresIn: process.env.JWT_EXPIRES_IN || '7d',
  },

  seedAdmin: {
    email: process.env.SEED_ADMIN_EMAIL || 'admin@wedding.app',
    password: process.env.SEED_ADMIN_PASSWORD || 'ChangeMe123!',
  },

  db: {
    type: (process.env.DB_TYPE || 'sqlite') as 'sqlite' | 'postgres',
    database: process.env.DB_DATABASE || './data/wedding.sqlite',
    host: process.env.DB_HOST || 'localhost',
    port: parseInt(process.env.DB_PORT ?? '5432', 10),
    username: process.env.DB_USERNAME || 'postgres',
    password: process.env.DB_PASSWORD || 'postgres',
    // Hosted Postgres (Supabase, Render, etc.) requires TLS; local dev usually doesn't have it.
    ssl: process.env.DB_SSL !== 'false',
  },

  google: {
    clientId: process.env.GOOGLE_CLIENT_ID || '',
    clientSecret: process.env.GOOGLE_CLIENT_SECRET || '',
    redirectUri:
      process.env.GOOGLE_REDIRECT_URI || 'http://localhost:3000/google/callback',
    refreshToken: process.env.GOOGLE_REFRESH_TOKEN || '',
    albumId: process.env.GOOGLE_PHOTOS_ALBUM_ID || '',
    albumTitle: process.env.GOOGLE_PHOTOS_ALBUM_TITLE || 'Our Wedding',
  },

  cache: {
    albumIndexTtl: parseInt(process.env.ALBUM_INDEX_TTL ?? '300', 10),
    baseUrlTtl: parseInt(process.env.BASE_URL_TTL ?? '3000', 10),
  },

  throttle: {
    ttl: parseInt(process.env.THROTTLE_TTL ?? '60', 10),
    limit: parseInt(process.env.THROTTLE_LIMIT ?? '120', 10),
  },
});
