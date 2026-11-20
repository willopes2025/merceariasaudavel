import { describe, expect, it } from 'vitest';
import { NAV, activePath, visibleNav } from './nav';

describe('menu do Mercearia', () => {
  it('tem os 12 grupos do documento de arquitetura', () => {
    expect(NAV).toHaveLength(12);
  });

  it('esconde o que a pessoa não pode ver e some com grupo vazio', () => {
    const montador = new Set(['service_order.view', 'service_order.stage', 'stock.view']);
    const groups = visibleNav((p) => !p || montador.has(p));
    const labels = groups.map((g) => g.label);
    expect(labels).toContain('Ordens de Serviço');
    expect(labels).not.toContain('Configurações');
    expect(labels).not.toContain('Fiscal');
  });

  it('proprietário vê tudo', () => {
    expect(visibleNav(() => true)).toHaveLength(12);
  });

  it('acende o item mais específico', () => {
    expect(activePath('/os/etapas')).toBe('/os/etapas');
    expect(activePath('/os/123')).toBe('/os');
    expect(activePath('/')).toBe('/');
    expect(activePath('/configuracoes/lojas')).toBe('/configuracoes/lojas');
  });

  it('não repete caminho', () => {
    const paths = NAV.flatMap((g) => g.items.map((i) => i.path));
    expect(new Set(paths).size).toBe(paths.length);
  });
});
