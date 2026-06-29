import * as Joi from 'joi';

export const validationSchema = Joi.object({
  NODE_ENV: Joi.string()
    .valid('development', 'production', 'test')
    .default('development'),
  PORT: Joi.number().default(3000),
  CORS_ORIGINS: Joi.string().default('*'),

  JWT_SECRET: Joi.string().min(8).required(),
  JWT_EXPIRES_IN: Joi.string().default('7d'),
  SEED_ADMIN_EMAIL: Joi.string().email().required(),
  SEED_ADMIN_PASSWORD: Joi.string().min(6).required(),

  DB_TYPE: Joi.string().valid('sqlite', 'postgres').default('sqlite'),
  DB_DATABASE: Joi.string().required(),
  DB_HOST: Joi.string().optional(),
  DB_PORT: Joi.number().optional(),
  DB_USERNAME: Joi.string().optional(),
  DB_PASSWORD: Joi.string().optional().allow(''),

  // Google creds are not strictly required to boot (so you can run get:token
  // and the setup endpoints first), but the photo features need them.
  GOOGLE_CLIENT_ID: Joi.string().allow('').optional(),
  GOOGLE_CLIENT_SECRET: Joi.string().allow('').optional(),
  GOOGLE_REDIRECT_URI: Joi.string().uri().optional(),
  GOOGLE_REFRESH_TOKEN: Joi.string().allow('').optional(),
  GOOGLE_PHOTOS_ALBUM_ID: Joi.string().allow('').optional(),
  GOOGLE_PHOTOS_ALBUM_TITLE: Joi.string().default('Our Wedding'),

  ALBUM_INDEX_TTL: Joi.number().default(300),
  BASE_URL_TTL: Joi.number().max(3599).default(3000),

  THROTTLE_TTL: Joi.number().default(60),
  THROTTLE_LIMIT: Joi.number().default(120),
});
