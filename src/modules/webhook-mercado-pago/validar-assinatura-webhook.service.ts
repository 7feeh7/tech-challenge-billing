import { createHmac, timingSafeEqual } from 'node:crypto';
import { Injectable } from '@nestjs/common';

export interface EntradaValidacaoAssinatura {
  dataId: string;
  requestId: string | undefined;
  assinaturaCabecalho: string | undefined;
  segredo: string;
  toleranciaSegundos?: number;
}

export interface ResultadoValidacaoAssinatura {
  valida: boolean;
  motivo?:
    | 'assinatura_ausente'
    | 'formato_invalido'
    | 'hash_invalido'
    | 'timestamp_expirado';
}

@Injectable()
export class ValidarAssinaturaWebhookService {
  validar(entrada: EntradaValidacaoAssinatura): ResultadoValidacaoAssinatura {
    if (!entrada.assinaturaCabecalho?.trim()) {
      return { valida: false, motivo: 'assinatura_ausente' };
    }

    const partes = this.extrairPartesAssinatura(entrada.assinaturaCabecalho);
    if (!partes) {
      return { valida: false, motivo: 'formato_invalido' };
    }

    const tolerancia = entrada.toleranciaSegundos ?? 300;
    const agora = Math.floor(Date.now() / 1000);
    if (Math.abs(agora - partes.ts) > tolerancia) {
      return { valida: false, motivo: 'timestamp_expirado' };
    }

    if (!entrada.requestId?.trim()) {
      return { valida: false, motivo: 'formato_invalido' };
    }

    const manifest = `id:${entrada.dataId};request-id:${entrada.requestId};ts:${partes.ts};`;
    const esperado = createHmac('sha256', entrada.segredo)
      .update(manifest)
      .digest('hex');

    if (!this.compararHash(esperado, partes.v1)) {
      return { valida: false, motivo: 'hash_invalido' };
    }

    return { valida: true };
  }

  gerarAssinaturaParaProva(
    dataId: string,
    requestId: string,
    segredo: string,
    ts = Math.floor(Date.now() / 1000),
  ): string {
    const manifest = `id:${dataId};request-id:${requestId};ts:${ts};`;
    const hash = createHmac('sha256', segredo).update(manifest).digest('hex');
    return `ts=${ts},v1=${hash}`;
  }

  private extrairPartesAssinatura(
    cabecalho: string,
  ): { ts: number; v1: string } | null {
    const mapa = new Map<string, string>();
    for (const trecho of cabecalho.split(',')) {
      const [chave, ...resto] = trecho.split('=');
      if (!chave || resto.length === 0) {
        continue;
      }
      mapa.set(chave.trim(), resto.join('=').trim());
    }

    const ts = Number(mapa.get('ts'));
    const v1 = mapa.get('v1');
    if (!Number.isFinite(ts) || !v1) {
      return null;
    }
    return { ts, v1 };
  }

  private compararHash(esperado: string, recebido: string): boolean {
    const a = Buffer.from(esperado, 'utf8');
    const b = Buffer.from(recebido, 'utf8');
    if (a.length !== b.length) {
      return false;
    }
    return timingSafeEqual(a, b);
  }
}
