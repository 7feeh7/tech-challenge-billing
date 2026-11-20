import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { montarChaveReserva } from '../../application/calcular-prazo-pagamento';
import type {
  PedidoReservaOs,
  ReservaOsGateway,
  ResultadoReservaOs,
} from '../../application/ports/reserva-os.gateway';

interface CorpoErroOs {
  codigo?: string;
  mensagem?: string;
}

@Injectable()
export class FetchReservaOsGateway implements ReservaOsGateway {
  private readonly baseUrl: string;
  private readonly token: string;
  private readonly timeoutMs: number;
  private readonly maxTentativas: number;

  constructor(private readonly config: ConfigService) {
    this.baseUrl =
      this.config.get<string>('OS_SERVICE_BASE_URL')?.trim() ||
      'http://localhost:8080';
    this.token = this.config.get<string>('OS_SERVICE_TOKEN')?.trim() || '';
    this.timeoutMs = Number(
      this.config.get<string>('OS_REQUEST_TIMEOUT_MS') ?? '3000',
    );
    this.maxTentativas = Number(
      this.config.get<string>('OS_REQUEST_MAX_TENTATIVAS') ?? '3',
    );
  }

  async reservar(pedido: PedidoReservaOs): Promise<ResultadoReservaOs> {
    const idempotencyKey = montarChaveReserva(
      pedido.orcamentoId,
      pedido.tentativaAprovacao,
    );
    const url = `${this.baseUrl.replace(/\/$/, '')}/internal/ordens-servico/${pedido.ordemServicoId}/reservas`;
    const corpo = JSON.stringify({
      rodada: pedido.rodada,
      orcamentoId: pedido.orcamentoId,
    });

    let ultimoErro = 'indeterminado';
    for (let tentativa = 1; tentativa <= this.maxTentativas; tentativa += 1) {
      try {
        const resposta = await fetch(url, {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${this.token}`,
            'Content-Type': 'application/json',
            Accept: 'application/json',
            'X-Correlation-Id': pedido.correlationId,
            'X-Request-Id': pedido.requestId,
            'Idempotency-Key': idempotencyKey,
          },
          body: corpo,
          signal: AbortSignal.timeout(this.timeoutMs),
        });

        const texto = await resposta.text();
        let json: Record<string, unknown> = {};
        try {
          json = texto ? (JSON.parse(texto) as Record<string, unknown>) : {};
        } catch {
          if (resposta.ok) {
            return {
              tipo: 'indeterminado',
              motivo: 'Resposta de sucesso não JSON do OS',
            };
          }
          ultimoErro = `HTTP ${resposta.status} com corpo inválido`;
          if (resposta.status >= 500) continue;
          return { tipo: 'indeterminado', motivo: ultimoErro };
        }

        if (resposta.status === 200) {
          const reservaId =
            typeof json.reservaId === 'string' ? json.reservaId : '';
          const prazo =
            typeof json.prazoReferencia === 'string'
              ? new Date(json.prazoReferencia)
              : null;
          if (!reservaId || !prazo || Number.isNaN(prazo.getTime())) {
            return {
              tipo: 'indeterminado',
              motivo: 'Resposta 200 sem reservaId ou prazoReferencia',
            };
          }
          return {
            tipo: 'sucesso',
            reservaId,
            prazoReferencia: prazo,
          };
        }

        if (resposta.status === 409) {
          const erro = json as CorpoErroOs;
          const codigo = erro.codigo;
          if (
            codigo === 'ESTOQUE_INSUFICIENTE' ||
            codigo === 'RODADA_OBSOLETA' ||
            codigo === 'OS_EM_CANCELAMENTO' ||
            codigo === 'ESTADO_INCOMPATIVEL' ||
            codigo === 'CONTEUDO_DIVERGENTE'
          ) {
            return {
              tipo: 'conflito',
              codigo,
              mensagem: erro.mensagem ?? codigo,
            };
          }
          return {
            tipo: 'indeterminado',
            motivo: `409 sem código reconhecido: ${codigo ?? '?'}`,
          };
        }

        if (resposta.status >= 500) {
          ultimoErro = `HTTP ${resposta.status}`;
          continue;
        }

        return {
          tipo: 'indeterminado',
          motivo: `HTTP ${resposta.status} inesperado`,
        };
      } catch (erro) {
        ultimoErro =
          erro instanceof Error ? erro.message : 'Erro de rede na reserva';
      }
    }

    return { tipo: 'indeterminado', motivo: ultimoErro };
  }
}
