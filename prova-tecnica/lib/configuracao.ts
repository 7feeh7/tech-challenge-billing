import { resolve } from 'node:path';
import { config as loadEnv } from 'dotenv';

const raizProva = resolve(__dirname, '..');
loadEnv({ path: resolve(raizProva, '.env') });

export interface ConfiguracaoProva {
  accessToken: string;
  payerEmail: string;
  apiBaseUrl: string;
  requestTimeoutMs: number;
}

export function carregarConfiguracao(): ConfiguracaoProva {
  const accessToken = process.env.MP_ACCESS_TOKEN?.trim();
  const payerEmail = process.env.MP_PAYER_EMAIL?.trim();
  const apiBaseUrl =
    process.env.MP_API_BASE_URL?.trim() || 'https://api.mercadopago.com';
  const requestTimeoutMs = Number(
    process.env.MP_REQUEST_TIMEOUT_MS?.trim() || '30000',
  );

  if (!accessToken) {
    throw new Error(
      'Configure MP_ACCESS_TOKEN em prova-tecnica/.env (credencial de teste; não versionar).',
    );
  }
  if (!payerEmail) {
    throw new Error(
      'Configure MP_PAYER_EMAIL em prova-tecnica/.env (usuário comprador de teste).',
    );
  }
  if (!Number.isFinite(requestTimeoutMs) || requestTimeoutMs < 1000) {
    throw new Error('MP_REQUEST_TIMEOUT_MS inválido (mínimo 1000).');
  }

  return { accessToken, payerEmail, apiBaseUrl, requestTimeoutMs };
}
