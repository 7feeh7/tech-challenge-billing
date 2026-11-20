import { Module } from '@nestjs/common';
import { FILA_MENSAGENS } from './application/ports/fila-mensagens.gateway';
import {
  MENSAGEM_PROCESSADA_GATEWAY,
  OUTBOX_GATEWAY,
} from './application/ports/tokens';
import { PublicadorOutboxService } from './infra/outbox/publicador-outbox.service';
import { PrismaMensagemProcessadaGateway } from './infra/persistence/prisma-mensagem-processada.gateway';
import { PrismaOutboxGateway } from './infra/persistence/prisma-outbox.gateway';
import { FilaSqsGateway } from './infra/sqs/fila-sqs.gateway';

@Module({
  providers: [
    FilaSqsGateway,
    { provide: FILA_MENSAGENS, useExisting: FilaSqsGateway },
    PrismaMensagemProcessadaGateway,
    {
      provide: MENSAGEM_PROCESSADA_GATEWAY,
      useExisting: PrismaMensagemProcessadaGateway,
    },
    PrismaOutboxGateway,
    { provide: OUTBOX_GATEWAY, useExisting: PrismaOutboxGateway },
    PublicadorOutboxService,
  ],
  exports: [
    FILA_MENSAGENS,
    MENSAGEM_PROCESSADA_GATEWAY,
    OUTBOX_GATEWAY,
    PublicadorOutboxService,
  ],
})
export class MensageriaModule {}
