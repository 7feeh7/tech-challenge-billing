import { randomUUID } from 'node:crypto';
import { ConfigModule } from '@nestjs/config';
import { Test, type TestingModule } from '@nestjs/testing';
import { PrismaModule } from '../src/shared/database/prisma.module';
import { PrismaService } from '../src/shared/database/prisma.service';
import { ObservabilityModule } from '../src/shared/observability/observability.module';
import type { PendenciaFinanceiraMonitorGateway } from '../src/shared/observability/pendencia-financeira-monitor.gateway';
import { PENDENCIA_FINANCEIRA_MONITOR_GATEWAY } from '../src/shared/observability/tokens';
import { exigirDatabaseUrl } from './helpers/exigir-database-integracao';
import { fecharModuloIntegracao } from './helpers/fechar-modulo-integracao';

describe('Pendência financeira — monitoramento (integração)', () => {
  let module: TestingModule;
  let prisma: PrismaService;
  let monitor: PendenciaFinanceiraMonitorGateway;

  beforeAll(() => {
    exigirDatabaseUrl();
  });

  beforeEach(async () => {
    module = await Test.createTestingModule({
      imports: [
        ConfigModule.forRoot({ isGlobal: true }),
        PrismaModule,
        ObservabilityModule,
      ],
    }).compile();

    prisma = module.get(PrismaService);
    monitor = module.get(PENDENCIA_FINANCEIRA_MONITOR_GATEWAY);
    await prisma.pendenciaFinanceiraMonitoramento.deleteMany();
  });

  afterEach(async () => {
    await fecharModuloIntegracao(module);
  });

  it('persiste pendência consumível por consulta ao banco', async () => {
    const operacaoId = randomUUID();
    await monitor.registrar({
      tipo: 'SITUACAO_FINANCEIRA_INDETERMINADA',
      operacaoId,
      ordemServicoId: randomUUID(),
      rodada: 1,
      correlationId: randomUUID(),
      motivo: 'timeout MP',
    });

    const rows = await prisma.pendenciaFinanceiraMonitoramento.findMany({
      where: { operacaoId, resolvidoEm: null },
    });
    expect(rows).toHaveLength(1);
    expect(rows[0]?.tipo).toBe('SITUACAO_FINANCEIRA_INDETERMINADA');

    await monitor.resolverPorOperacao(operacaoId);
    const resolvida = await prisma.pendenciaFinanceiraMonitoramento.findFirst({
      where: { operacaoId },
    });
    expect(resolvida?.resolvidoEm).not.toBeNull();
  });
});
