import { RequestMethod, ValidationPipe } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import {
  FastifyAdapter,
  type NestFastifyApplication,
} from '@nestjs/platform-fastify';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { AppModule } from '@/app.module';
import { validarConfiguracaoBilling } from '@/shared/config/validar-configuracao-billing';
import { JsonLoggerService } from '@/shared/observability/json-logger.service';

const PORT = Number(process.env.PORT ?? 3000);

async function bootstrap() {
  validarConfiguracaoBilling();

  const app = await NestFactory.create<NestFastifyApplication>(
    AppModule,
    new FastifyAdapter(),
    { bufferLogs: true },
  );

  const logger = app.get(JsonLoggerService);
  app.useLogger(logger);
  app.enableShutdownHooks();

  app.setGlobalPrefix('v1', {
    exclude: [
      { path: 'health', method: RequestMethod.ALL },
      { path: 'health/ready', method: RequestMethod.ALL },
    ],
  });

  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
    }),
  );

  const swaggerConfig = new DocumentBuilder()
    .setTitle('Billing Service')
    .setDescription(
      'API de orçamentos, cobrança e compensação financeira da oficina.',
    )
    .setVersion('1.0.0')
    .addBearerAuth()
    .addServer(
      process.env.API_GATEWAY_URL ?? 'http://localhost:3000',
      'Gateway',
    )
    .build();

  const document = SwaggerModule.createDocument(app, swaggerConfig);
  SwaggerModule.setup('docs', app, document, {
    customSiteTitle: 'Billing API Docs',
  });

  await app.listen(PORT, '0.0.0.0');
  logger.log(`HTTP server running on port ${PORT}`, 'Bootstrap');
}

bootstrap();
