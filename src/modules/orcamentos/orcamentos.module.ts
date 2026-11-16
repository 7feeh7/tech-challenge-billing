import { Module } from '@nestjs/common';
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
import { ORCAMENTO_GATEWAY } from './application/ports/tokens';
import { BuscarOrcamentoUseCase } from './application/use-cases/buscar-orcamento.use-case';
import { ListarOrcamentosUseCase } from './application/use-cases/listar-orcamentos.use-case';
import { ProcessarGerarOrcamentoUseCase } from './application/use-cases/processar-gerar-orcamento.use-case';
import { RejeitarOrcamentoUseCase } from './application/use-cases/rejeitar-orcamento.use-case';
import { OrcamentosController } from './infra/http/controllers/orcamentos.controller';
import { PrismaOrcamentoGateway } from './infra/persistence/prisma-orcamento.gateway';

@Module({
  imports: [MensageriaModule],
  controllers: [OrcamentosController],
  providers: [
    PrismaOrcamentoGateway,
    { provide: ORCAMENTO_GATEWAY, useExisting: PrismaOrcamentoGateway },
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
  ],
})
export class OrcamentosModule {}
