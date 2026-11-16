import { UnitOfWorkFake } from '@/shared/database/unit-of-work-fake';
import type { MensagemProcessadaGateway } from '@/shared/messaging/application/ports/mensagem-processada.gateway';
import type { OutboxGateway } from '@/shared/messaging/application/ports/outbox.gateway';
import { Orcamento } from '../../domain/entities/orcamento.entity';
import { SituacaoOrcamento } from '../../domain/situacao-orcamento';
import type { OrcamentoGateway } from '../ports/orcamento.gateway';

export const criarOrcamentoFake = (
  overrides: Partial<ConstructorParameters<typeof Orcamento>[0]> = {},
) =>
  new Orcamento({
    id: 'a1b2c3d4-e5f6-7890-abcd-ef1234567890',
    ordemServicoId: '550e8400-e29b-41d4-a716-446655440000',
    rodada: 1,
    clienteId: '6ba7b810-9dad-11d1-80b4-00c04fd430c8',
    correlationId: '550e8400-e29b-41d4-a716-446655440000',
    situacao: SituacaoOrcamento.GERADO,
    itens: [
      {
        tipo: 'SERVICO',
        itemId: '7c9e6679-7425-40de-944b-e07fc1f90ae7',
        nome: 'Troca de óleo',
        quantidade: 1,
        precoUnitarioCentavos: 15000,
      },
    ],
    ...overrides,
  });

export const criarGatewayOrcamentoMock = (): jest.Mocked<OrcamentoGateway> => ({
  buscarPorId: jest.fn(),
  buscarPorOrdemServicoERodada: jest.fn(),
  criar: jest.fn(),
  atualizar: jest.fn(),
  listar: jest.fn(),
  reivindicarAprovacoesPendentes: jest.fn(),
  liberarBloqueioAprovacao: jest.fn(),
  adiarBloqueioAprovacao: jest.fn(),
  iniciarAprovacaoSeGerado: jest.fn(),
});

export const criarMensagemProcessadaMock =
  (): jest.Mocked<MensagemProcessadaGateway> => ({
    jaProcessada: jest.fn(),
    registrar: jest.fn(),
    buscarHash: jest.fn(),
  });

export const criarOutboxMock = (): jest.Mocked<OutboxGateway> => ({
  registrar: jest.fn(),
});

export const unitOfWorkFake = new UnitOfWorkFake();
