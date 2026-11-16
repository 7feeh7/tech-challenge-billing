import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { CobrancaGateway } from '@/modules/cobrancas/application/ports/cobranca.gateway';
import { COBRANCA_GATEWAY } from '@/modules/cobrancas/application/ports/tokens';
import { PrismaCobrancaGateway } from '@/modules/cobrancas/infra/persistence/prisma-cobranca.gateway';
import type { UnitOfWork } from '@/shared/database/unit-of-work.port';
import { UNIT_OF_WORK } from '@/shared/database/unit-of-work.port';
import type { MensagemProcessadaGateway } from '@/shared/messaging/application/ports/mensagem-processada.gateway';
import type { OutboxGateway } from '@/shared/messaging/application/ports/outbox.gateway';
import {
  MENSAGEM_PROCESSADA_GATEWAY,
  OUTBOX_GATEWAY,
} from '@/shared/messaging/application/ports/tokens';
import {
  ConsumidorFilaBillingService,
  PROCESSADOR_GERAR_ORCAMENTO,
} from '@/shared/messaging/infra/consumo/consumidor-fila-billing.service';
import { MensageriaModule } from '@/shared/messaging/mensageria.module';
import type { OrcamentoGateway } from './application/ports/orcamento.gateway';
import type { ReservaOsGateway } from './application/ports/reserva-os.gateway';
import {
  ORCAMENTO_GATEWAY,
  RESERVA_OS_GATEWAY,
} from './application/ports/tokens';
import { AplicarResultadoReservaService } from './application/services/aplicar-resultado-reserva.service';
import { AprovarOrcamentoUseCase } from './application/use-cases/aprovar-orcamento.use-case';
import { BuscarOrcamentoUseCase } from './application/use-cases/buscar-orcamento.use-case';
import { ListarOrcamentosUseCase } from './application/use-cases/listar-orcamentos.use-case';
import { ProcessarGerarOrcamentoUseCase } from './application/use-cases/processar-gerar-orcamento.use-case';
import { RejeitarOrcamentoUseCase } from './application/use-cases/rejeitar-orcamento.use-case';
import { OrcamentosController } from './infra/http/controllers/orcamentos.controller';
import { FetchReservaOsGateway } from './infra/http/fetch-reserva-os.gateway';
import { ProcessadorAprovacoesPendentesService } from './infra/jobs/processador-aprovacoes-pendentes.service';
import { PrismaOrcamentoGateway } from './infra/persistence/prisma-orcamento.gateway';

@Module({
  imports: [MensageriaModule],
  controllers: [OrcamentosController],
  providers: [
    PrismaOrcamentoGateway,
    PrismaCobrancaGateway,
    FetchReservaOsGateway,
    { provide: ORCAMENTO_GATEWAY, useExisting: PrismaOrcamentoGateway },
    { provide: COBRANCA_GATEWAY, useExisting: PrismaCobrancaGateway },
    { provide: RESERVA_OS_GATEWAY, useExisting: FetchReservaOsGateway },
    {
      provide: AplicarResultadoReservaService,
      useFactory: (
        uow: UnitOfWork,
        orcamentos: OrcamentoGateway,
        cobrancas: CobrancaGateway,
        config: ConfigService,
      ) =>
        new AplicarResultadoReservaService(
          uow,
          orcamentos,
          cobrancas,
          Number(config.get<string>('PRAZO_CARENCIA_MINUTOS') ?? '2'),
        ),
      inject: [
        UNIT_OF_WORK,
        ORCAMENTO_GATEWAY,
        COBRANCA_GATEWAY,
        ConfigService,
      ],
    },
    {
      provide: ProcessarGerarOrcamentoUseCase,
      useFactory: (
        uow: UnitOfWork,
        orcamentos: OrcamentoGateway,
        mensagens: MensagemProcessadaGateway,
        outbox: OutboxGateway,
      ) =>
        new ProcessarGerarOrcamentoUseCase(uow, orcamentos, mensagens, outbox),
      inject: [
        UNIT_OF_WORK,
        ORCAMENTO_GATEWAY,
        MENSAGEM_PROCESSADA_GATEWAY,
        OUTBOX_GATEWAY,
      ],
    },
    {
      provide: PROCESSADOR_GERAR_ORCAMENTO,
      useExisting: ProcessarGerarOrcamentoUseCase,
    },
    {
      provide: RejeitarOrcamentoUseCase,
      useFactory: (
        uow: UnitOfWork,
        orcamentos: OrcamentoGateway,
        outbox: OutboxGateway,
      ) => new RejeitarOrcamentoUseCase(uow, orcamentos, outbox),
      inject: [UNIT_OF_WORK, ORCAMENTO_GATEWAY, OUTBOX_GATEWAY],
    },
    {
      provide: AprovarOrcamentoUseCase,
      useFactory: (
        uow: UnitOfWork,
        orcamentos: OrcamentoGateway,
        reservaOs: ReservaOsGateway,
        aplicar: AplicarResultadoReservaService,
        config: ConfigService,
      ) =>
        new AprovarOrcamentoUseCase(
          uow,
          orcamentos,
          reservaOs,
          aplicar,
          Number(
            config.get<string>('APROVACAO_PROCESSADOR_INTERVAL_MS') ?? '10000',
          ),
        ),
      inject: [
        UNIT_OF_WORK,
        ORCAMENTO_GATEWAY,
        RESERVA_OS_GATEWAY,
        AplicarResultadoReservaService,
        ConfigService,
      ],
    },
    {
      provide: BuscarOrcamentoUseCase,
      useFactory: (orcamentos: OrcamentoGateway) =>
        new BuscarOrcamentoUseCase(orcamentos),
      inject: [ORCAMENTO_GATEWAY],
    },
    {
      provide: ListarOrcamentosUseCase,
      useFactory: (orcamentos: OrcamentoGateway) =>
        new ListarOrcamentosUseCase(orcamentos),
      inject: [ORCAMENTO_GATEWAY],
    },
    ConsumidorFilaBillingService,
    ProcessadorAprovacoesPendentesService,
  ],
})
export class OrcamentosModule {}
