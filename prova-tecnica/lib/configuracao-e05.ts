import { resolve } from 'node:path';
import { config as loadEnv } from 'dotenv';
import {
  type ConfiguracaoProva,
  carregarConfiguracao,
} from './configuracao';

const raizProva = resolve(__dirname, '..');
loadEnv({ path: resolve(raizProva, '.env') });

export interface ConfiguracaoE05 extends ConfiguracaoProva {
  webhookSecret: string;
  webhookBaseUrl: string;
  orderPagaId?: string;
  orderRecusadaId?: string;
}

export function carregarConfiguracaoE05(): ConfiguracaoE05 {
  const base = carregarConfiguracao();
  const webhookSecret = process.env.MP_WEBHOOK_SECRET?.trim();
  const webhookBaseUrl =
    process.env.WEBHOOK_BASE_URL?.trim() || 'http://127.0.0.1:3000';

  if (!webhookSecret) {
    throw new Error(
      'Configure MP_WEBHOOK_SECRET em prova-tecnica/.env (mesmo valor do painel e do Billing local).',
    );
  }

  return {
    ...base,
    webhookSecret,
    webhookBaseUrl,
    orderPagaId: process.env.MP_ORDER_PAGA_ID?.trim(),
    orderRecusadaId: process.env.MP_ORDER_RECUSADA_ID?.trim(),
  };
}