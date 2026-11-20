import {
  createServer,
  type IncomingMessage,
  type Server,
  type ServerResponse,
} from 'node:http';

export type CenarioReserva =
  | 'sucesso'
  | 'estoque'
  | 'estado_incompativel'
  | 'cancelamento'
  | 'timeout';

export interface RegistroChamadaReserva {
  idempotencyKey: string | undefined;
  corpo: string;
}

export function iniciarDubleOsReservas(cenario: CenarioReserva): Promise<{
  servidor: Server;
  url: string;
  chamadas: RegistroChamadaReserva[];
}> {
  const chamadas: RegistroChamadaReserva[] = [];

  const servidor = createServer((req: IncomingMessage, res: ServerResponse) => {
    if (req.method === 'POST' && req.url?.includes('/reservas')) {
      const buffers: Buffer[] = [];
      req.on('data', (chunk) => buffers.push(chunk));
      req.on('end', () => {
        const corpo = Buffer.concat(buffers).toString('utf-8');
        chamadas.push({
          idempotencyKey: req.headers['idempotency-key'] as string | undefined,
          corpo,
        });

        if (cenario === 'timeout') {
          return;
        }

        if (cenario === 'sucesso') {
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(
            JSON.stringify({
              reservaId: '9c9e6679-7425-40de-944b-e07fc1f90ae0',
              prazoReferencia: '2026-11-15T12:05:00.000Z',
            }),
          );
          return;
        }

        const codigos: Record<string, string> = {
          estoque: 'ESTOQUE_INSUFICIENTE',
          estado_incompativel: 'ESTADO_INCOMPATIVEL',
          cancelamento: 'OS_EM_CANCELAMENTO',
        };

        res.writeHead(409, { 'Content-Type': 'application/json' });
        res.end(
          JSON.stringify({
            codigo: codigos[cenario],
            mensagem: cenario,
          }),
        );
      });
      return;
    }
    res.writeHead(404);
    res.end();
  });

  return new Promise((resolve) => {
    servidor.listen(0, '127.0.0.1', () => {
      const addr = servidor.address();
      const porta = typeof addr === 'object' && addr ? addr.port : 0;
      resolve({ servidor, url: `http://127.0.0.1:${porta}`, chamadas });
    });
  });
}

export function encerrarDuble(servidor: Server): Promise<void> {
  return new Promise((resolve, reject) => {
    servidor.close((erro) => (erro ? reject(erro) : resolve()));
  });
}