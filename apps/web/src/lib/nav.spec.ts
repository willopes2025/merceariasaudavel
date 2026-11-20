import { describe, expect, it } from 'vitest';
import { NAV, activePath, visibleNav } from './nav';

describe('menu da Mercearia', () => {
  it('tem as áreas da proposta', () => {
    expect(NAV.map((g) => g.label)).toEqual(['Gestão', 'Vender', 'Operar', 'Crescer', 'Financeiro e fiscal', 'Configurações']);
  });

  it('a equipe do preparo vê estoque e contagem, mas não o caixa nem configurações', () => {
    const preparo = new Set(['stock.view', 'stock.loss']);
    const items = visibleNav((p) => !p || preparo.has(p)).flatMap((g) => g.items.map((i) => i.path));
    expect(items).toContain('/insumos/contagem');
    expect(items).not.toContain('/vender');
    expect(items).not.toContain('/configuracoes/lojas');
  });

  it('acende o item mais específico', () => {
    expect(activePath('/insumos/contagem')).toBe('/insumos/contagem');
    expect(activePath('/vendas/123')).toBe('/vendas');
    expect(activePath('/')).toBe('/');
  });

  it('não repete caminho', () => {
    const paths = NAV.flatMap((g) => g.items.map((i) => i.path));
    expect(new Set(paths).size).toBe(paths.length);
  });
});
