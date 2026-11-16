import {
  MotivoRejeicaoObrigatorioError,
  SituacaoOrcamentoInvalidaError,
} from '../errors/orcamento.errors';
import { SituacaoOrcamento } from '../situacao-orcamento';
import { Orcamento } from './orcamento.entity';

describe('Orcamento', () => {
  const base = {
    ordemServicoId: '550e8400-e29b-41d4-a716-446655440000',
    rodada: 1,
    clienteId: '6ba7b810-9dad-11d1-80b4-00c04fd430c8',
    correlationId: '550e8400-e29b-41d4-a716-446655440000',
    itens: [
      {
        tipo: 'SERVICO' as const,
        itemId: '7c9e6679-7425-40de-944b-e07fc1f90ae7',
        nome: 'Troca de óleo',
        quantidade: 2,
        precoUnitarioCentavos: 15000,
      },
      {
        tipo: 'PECA' as const,
        itemId: '8c9e6679-7425-40de-944b-e07fc1f90ae8',
        nome: 'Filtro',
        quantidade: 1,
        precoUnitarioCentavos: 5000,
      },
    ],
  };

  it('calcula valor total em centavos como soma dos itens', () => {
    const orcamento = new Orcamento(base);
    expect(orcamento.valorTotalCentavos).toBe(35000);
  });

  it('rejeita com motivo e muda situação para REJEITADO', () => {
    const orcamento = new Orcamento(base);
    orcamento.rejeitar('Cliente recusou');

    expect(orcamento.situacao).toBe(SituacaoOrcamento.REJEITADO);
    expect(orcamento.motivoRejeicao).toBe('Cliente recusou');
    expect(orcamento.rejeitadoEm).toBeInstanceOf(Date);
  });

  it('exige motivo na rejeição', () => {
    const orcamento = new Orcamento(base);
    expect(() => orcamento.rejeitar('   ')).toThrow(
      MotivoRejeicaoObrigatorioError,
    );
  });

  it('falha sem itens', () => {
    expect(
      () =>
        new Orcamento({
          ...base,
          itens: [],
        }),
    ).toThrow();
  });

  it('inicia aprovação incrementando tentativa', () => {
    const orcamento = new Orcamento(base);
    orcamento.iniciarAprovacao();
    expect(orcamento.situacao).toBe(SituacaoOrcamento.APROVACAO_EM_ANDAMENTO);
    expect(orcamento.tentativaAprovacao).toBe(1);
  });

  it('volta para GERADO após conflito transitório', () => {
    const orcamento = new Orcamento({
      ...base,
      situacao: SituacaoOrcamento.APROVACAO_EM_ANDAMENTO,
      tentativaAprovacao: 2,
    });
    orcamento.voltarParaGerado();
    expect(orcamento.situacao).toBe(SituacaoOrcamento.GERADO);
    expect(orcamento.tentativaAprovacao).toBe(2);
  });

  it('conclui aprovação com reserva e prazo', () => {
    const orcamento = new Orcamento({
      ...base,
      situacao: SituacaoOrcamento.APROVACAO_EM_ANDAMENTO,
      tentativaAprovacao: 1,
    });
    orcamento.concluirAprovacao(
      '9c9e6679-7425-40de-944b-e07fc1f90af0',
      new Date('2026-11-15T12:00:00.000Z'),
    );
    expect(orcamento.situacao).toBe(SituacaoOrcamento.APROVADO);
    expect(orcamento.reservaId).toBeTruthy();
  });

  it('encerra aprovação em cancelamento', () => {
    const orcamento = new Orcamento({
      ...base,
      situacao: SituacaoOrcamento.APROVACAO_EM_ANDAMENTO,
      tentativaAprovacao: 1,
    });
    orcamento.encerrarAprovacao();
    expect(orcamento.situacao).toBe(SituacaoOrcamento.CANCELADO);
  });

  it('não permite rejeitar fora de GERADO', () => {
    const orcamento = new Orcamento({
      ...base,
      situacao: SituacaoOrcamento.APROVADO,
    });
    expect(() => orcamento.rejeitar('tarde')).toThrow(
      SituacaoOrcamentoInvalidaError,
    );
  });
});
