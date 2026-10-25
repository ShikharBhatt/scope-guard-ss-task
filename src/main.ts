import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { ValidationPipe, VersioningType, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { AppConfig } from './config/configuration';

async function bootstrap() {
  const logger = new Logger('Bootstrap');
  const serviceMode = process.env.SERVICE_MODE || 'all';
  logger.log(`Starting Scope Guard (SERVICE_MODE=${serviceMode})`);

  const app = await NestFactory.create(AppModule);
  app.enableShutdownHooks();

  const configService = app.get<ConfigService<AppConfig, true>>(ConfigService);

  // Dedicated PROXY Service Mode (scope-guard-proxy container)
  if (serviceMode === 'proxy') {
    await app.init();
    const proxyPort = configService.get('app.proxyPort', { infer: true }) ?? 3128;
    logger.log(`Scope Guard Egress Proxy container initialized and listening on port ${proxyPort}`);
    return;
  }

  // API or ALL Service Mode (scope-guard-api container or local dev)
  app.setGlobalPrefix('api');
  app.enableVersioning({
    type: VersioningType.URI,
    defaultVersion: '1',
  });

  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
    }),
  );

  // Configure Interactive Swagger / OpenAPI Documentation
  const swaggerConfig = new DocumentBuilder()
    .setTitle('Scope Guard API')
    .setDescription(
      'Egress control, policy enforcement, and durable audit API for autonomous AI workers. ' +
        'Scope Guard acts as an explicit security boundary between untrusted LLM-driven agents ' +
        'and customer live systems.\n\n' +
        '### Authentication\n' +
        'Click the **Authorize** button on the right and enter the Tenant API Key:\n' +
        '- **Tenant Alpha (Acme Corp):** `sg_tenant_demo_secret_key_12345`\n' +
        '- **Tenant Beta (Cyberdyne Security):** `sg_tenant_beta_secret_key_67890`',
    )
    .setVersion('1.0')
    .addBearerAuth(
      {
        type: 'http',
        scheme: 'bearer',
        bearerFormat: 'API Key',
        name: 'Authorization',
        description: 'Enter your Tenant API key (e.g. sg_tenant_demo_secret_key_12345)',
        in: 'header',
      },
      'tenant-auth',
    )
    .build();

  const document = SwaggerModule.createDocument(app, swaggerConfig);
  SwaggerModule.setup('docs', app, document);
  SwaggerModule.setup('api/docs', app, document);

  const port = configService.get('app.port', { infer: true });
  await app.listen(port);
  logger.log(`Scope Guard Management API listening on http://localhost:${port}/api/v1`);
  logger.log(`Interactive Swagger UI available at http://localhost:${port}/docs`);
}

bootstrap().catch((err) => {
  console.error('Fatal error starting Scope Guard:', err);
  process.exit(1);
});
