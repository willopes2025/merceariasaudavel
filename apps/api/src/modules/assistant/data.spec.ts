import { PrismaPg } from '@prisma/adapter-pg';
import { Prisma, PrismaClient } from '@prisma/client';
import { afterAll, describe, expect, it } from 'vitest';
import { CONJUNTOS, montarConsulta } from './data';

const T = '00000000-0000-0000-0000-000000000001';
const base = { tenantId: T, modo: 'resumo' as const, metricas: [], agruparPor: [], filtros: [], ordem: 'desc' as const, limite: 10 };
const texto = (c: ReturnType<typeof montarConsulta>) => ({ sql: c.consulta.sql, params: c.consulta.values });

describe('motor de consultas do assistente', () => {
  it('recusa nomes que não são do conjunto (nada de SQL vindo da IA)', () => {
    expect(() => montarConsulta({ ...base, conjunto: 'app_user' })).toThrow(/Conjunto desconhecido/);
    expect(() => montarConsulta({ ...base, conjunto: 'vendas_itens', agruparPor: ['password_hash'] })).toThrow(/não é dimensão/);
    expect(() => montarConsulta({ ...base, conjunto: 'vendas_itens', metricas: ['1; drop table sale'] })).toThrow(/não é métrica/);
  });
  it('valores de filtro, datas e organização vão como parâmetros', () => {
    const dim = Object.keys(CONJUNTOS.vendas_itens!.dimensoes)[0]!;
    const q = texto(montarConsulta({ ...base, conjunto: 'vendas_itens', agruparPor: [dim], filtros: [{ campo: dim, operador: 'contem', valor: "x' or 1=1 --" }], de: '2026-11-01', ate: '2026-11-30' }));
    expect(q.sql).not.toContain('1=1');
    expect(q.params).toEqual(expect.arrayContaining(["%x' or 1=1 --%", T]));
  });
  it('limite máximo de 200 linhas', () => {
    expect(texto(montarConsulta({ ...base, conjunto: 'estoque', modo: 'lista', limite: 5000 })).params).toContain(200);
  });
  it('nenhum conjunto expõe colunas sensíveis', () => {
    const tudo = JSON.stringify(CONJUNTOS);
    for (const proibido of ['password', 'token', 'secret', 'access_token', 'document', 'cpf']) expect(tudo).not.toContain(proibido);
  });
});

/** Roda cada conjunto no banco de verdade (todas as dimensões, métricas e o modo lista). ASSISTANT_DB_TEST=1 para ligar. */
describe.runIf(process.env.ASSISTANT_DB_TEST === '1')('conjuntos no banco', () => {
  const db = new PrismaClient({ adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL }) });
  afterAll(() => db.$disconnect());
  for (const [nome, c] of Object.entries(CONJUNTOS)) {
    it(nome, async () => {
      const rodar = (p: Partial<Parameters<typeof montarConsulta>[0]>) => db.$queryRaw<unknown[]>(montarConsulta({ ...base, conjunto: nome, ...p }).consulta as Prisma.Sql);
      await rodar({ metricas: Object.keys(c.metricas).slice(0, 6), de: c.data ? '2026-01-01' : undefined, ate: c.data ? '2026-12-31' : undefined });
      for (const d of Object.keys(c.dimensoes)) await rodar({ agruparPor: [d], metricas: Object.keys(c.metricas).slice(0, 6), filtros: [{ campo: d, operador: 'contem', valor: 'a' }] });
      for (const col of Object.keys(c.colunas)) await rodar({ modo: 'lista', ordenarPor: col });
    });
  }
});
