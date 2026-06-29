import { ValidationPipe, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { NestFactory } from '@nestjs/core';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import * as fs from 'fs';
import * as path from 'path';
import { AppModule } from './app.module';
import { AllExceptionsFilter } from './common/filters/all-exceptions.filter';

async function bootstrap() {
  // Ensure the sqlite data directory exists before TypeORM connects.
  const dbFile = process.env.DB_DATABASE || './data/wedding.sqlite';
  if ((process.env.DB_TYPE || 'sqlite') === 'sqlite') {
    fs.mkdirSync(path.dirname(dbFile), { recursive: true });
  }

  const app = await NestFactory.create(AppModule, { bufferLogs: false });
  const config = app.get(ConfigService);

  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      transform: true,
      forbidNonWhitelisted: true,
      transformOptions: { enableImplicitConversion: true },
    }),
  );
  app.useGlobalFilters(new AllExceptionsFilter());

  const origins = config.get<string[]>('corsOrigins') ?? ['*'];
  app.enableCors({
    origin: origins.includes('*') ? true : origins,
    credentials: true,
  });

  // Swagger / OpenAPI docs at /docs
  const swaggerConfig = new DocumentBuilder()
    .setTitle('Wedding Photos API')
    .setDescription(
      'Backend for a wedding photo app over the Google Photos Library API. ' +
        'Photos live in one app-created album; the API can only see media it uploaded.',
    )
    .setVersion('1.0')
    .addBearerAuth()
    .build();
  const doc = SwaggerModule.createDocument(app, swaggerConfig);
  SwaggerModule.setup('docs', app, doc);

  const port = config.get<number>('port')!;
  await app.listen(port);

  const logger = new Logger('Bootstrap');
  logger.log(`🚀  API ready on http://localhost:${port}`);
  logger.log(`📚  Swagger docs on http://localhost:${port}/docs`);
}

bootstrap();
