import {
  Injectable,
  type OnModuleDestroy,
  type OnModuleInit,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '../generated/prisma/client';

@Injectable()
export class PrismaService
  extends PrismaClient
  implements OnModuleInit, OnModuleDestroy
{
  constructor(configService: ConfigService) {
    const databaseUrl = configService.getOrThrow<string>('DATABASE_URL');
    const usarSsl = configService.get<string>('DATABASE_SSL') === 'true';
    const poolMax = Number(
      configService.get<string>('DATABASE_POOL_MAX') ?? '5',
    );
    const poolConnectionTimeoutMs = Number(
      configService.get<string>('DATABASE_POOL_CONNECTION_TIMEOUT_MS') ??
        '10000',
    );

    const adapter = new PrismaPg({
      connectionString: databaseUrl,
      max: poolMax,
      connectionTimeoutMillis: poolConnectionTimeoutMs,
      ...(usarSsl ? { ssl: { rejectUnauthorized: false } } : {}),
    });

    super({ adapter });
  }

  async onModuleInit(): Promise<void> {
    await this.$connect();
  }

  async onModuleDestroy(): Promise<void> {
    await this.$disconnect();
  }
}
