const CHAVES_SENSIVEIS =
  /authorization|access_token|token|secret|password|senha|api[_-]?key|cookie/i;

export function sanitizarTexto(valor: string): string {
  return valor
    .replace(/\bBearer\s+\S+/gi, 'Bearer [redacted]')
    .replace(/APP_USR-\d+-\d+-[a-f0-9-]+/gi, 'APP_USR-[redacted]')
    .replace(/TEST-\d+-\d+-[a-f0-9-]+/gi, 'TEST-[redacted]');
}

export function sanitizarObjeto<T>(valor: T): T {
  if (valor === null || valor === undefined) {
    return valor;
  }
  if (typeof valor === 'string') {
    return sanitizarTexto(valor) as T;
  }
  if (Array.isArray(valor)) {
    return valor.map((item) => sanitizarObjeto(item)) as T;
  }
  if (typeof valor === 'object') {
    const saida: Record<string, unknown> = {};
    for (const [chave, item] of Object.entries(
      valor as Record<string, unknown>,
    )) {
      if (CHAVES_SENSIVEIS.test(chave)) {
        saida[chave] = '[redacted]';
        continue;
      }
      saida[chave] = sanitizarObjeto(item);
    }
    return saida as T;
  }
  return valor;
}

export function mascararToken(token: string): string {
  if (token.length <= 12) {
    return '[redacted]';
  }
  return `${token.slice(0, 8)}…[redacted]`;
}
