import {
  Inject,
  Injectable,
  Logger,
  type OnModuleDestroy,
  type OnModuleInit,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '@/shared/database/prisma.service';
import {
  FILA_MENSAGENS,
  type FilaMensagensGateway,
} from '../../application/ports/fila-mensagens.gateway';
import { DESTINO_FILA_OS, type EnvelopeMensagem } from '../../envelope';

@Injectable()
export class PublicadorOutboxService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(PublicadorOutboxService.name);
  private intervalo?: NodeJS.Timeout;
  private readonly habilitado: boolean;
  private readonly intervaloMs: number;
  private readonly posseMs: number;

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
    @Inject(FILA_MENSAGENS)
    private readonly fila: FilaMensagensGateway,
  ) {
    this.habilitado =
      this.config.get<string>('OUTBOX_PUBLISHER_HABILITADO') !== 'false';
    this.intervaloMs = Number(
      this.config.get<string>('OUTBOX_PUBLISHER_INTERVAL_MS') ?? '2000',
    );
    this.posseMs = Number(
      this.config.get<string>('OUTBOX_REIVINDICACAO_MS') ?? '30000',
    );
  }

  onModuleInit(): void {
    if (!this.habilitado) return;

    this.intervalo = setInterval(() => {
      void this.publicarLote().catch((erro) =>
        this.logger.error('Falha ao publicar outbox', erro),
      );
    }, this.intervaloMs);
  }

  onModuleDestroy(): void {
    if (this.intervalo) clearInterval(this.intervalo);
  }

  async publicarLote(): Promise<void> {
    const agora = new Date();
    const bloqueadoAte = new Date(agora.getTime() + this.posseMs);

    const mensagens = await this.prisma.$transaction(async (tx) => {
      const pendentes = await tx.$queryRaw<
        { id: string; destino: string }[]
      >`SELECT id, destino FROM mensagens_outbox
        WHERE enviado_em IS NULL
          AND (bloqueado_ate IS NULL OR bloqueado_ate < ${agora})
        ORDER BY criado_em
        LIMIT 10
        FOR UPDATE SKIP LOCKED`;

      if (pendentes.length === 0) return [];

      await tx.mensagemOutbox.updateMany({
        where: { id: { in: pendentes.map((p) => p.id) } },
        data: { bloqueadoAte },
      });

      return tx.mensagemOutbox.findMany({
        where: { id: { in: pendentes.map((p) => p.id) } },
      });
    });

    for (const mensagem of mensagens) {
      try {
        const filaUrl = this.resolverUrlDestino(mensagem.destino);
        const envelope = mensagem.envelope as unknown as EnvelopeMensagem;
        await this.fila.enviar(filaUrl, envelope, mensagem.correlationId);
        await this.prisma.mensagemOutbox.update({
          where: { id: mensagem.id },
          data: { enviadoEm: new Date(), bloqueadoAte: null },
        });
      } catch (erro) {
        this.logger.warn(
          `Falha ao publicar evento ${mensagem.eventId}`,
          erro instanceof Error ? erro.message : erro,
        );
        await this.prisma.mensagemOutbox.update({
          where: { id: mensagem.id },
          data: {
            tentativas: { increment: 1 },
            bloqueadoAte: null,
          },
        });
      }
    }
  }

  private resolverUrlDestino(destino: string): string {
    if (destino === DESTINO_FILA_OS) {
      return this.config.getOrThrow<string>('SQS_OS_IN_URL');
    }
    throw new Error(`Destino de outbox desconhecido: ${destino}`);
  }
}
