import { describe, expect, it } from 'vitest';
import { allocateNfcePayments, looksLikeFocusToken } from './fiscal';

describe('fiscal', () => {
  it('reparte o total da nota entre o recebido e o crediário', () => {
    expect(allocateNfcePayments(300, [{ kind: 'pix', amount: 100 }, { kind: 'dinheiro', amount: 50 }])).toEqual([
      { kind: 'pix', code: '17', label: 'Pix', amount: 100 },
      { kind: 'dinheiro', code: '01', label: 'Dinheiro', amount: 50 },
      { kind: 'prazo', code: '05', label: 'Crediário / a receber', amount: 150 },
    ]);
  });
  it('nunca passa do total da nota (serviço pago fica de fora)', () => {
    const p = allocateNfcePayments(80, [{ kind: 'credito', amount: 60 }, { kind: 'credito', amount: 60 }]);
    expect(p).toEqual([{ kind: 'credito', code: '03', label: 'Cartão de crédito', amount: 80 }]);
  });
  it('recusa texto de exemplo como token', () => {
    expect(looksLikeFocusToken('COLE_O_TOKEN_AQUI')).toBe(false);
    expect(looksLikeFocusToken('seutokenaquiseutokenaqui')).toBe(false);
    expect(looksLikeFocusToken('Qx7Lm2Zr9Kp4Vb8Nc1Hd6Jf3Ws5Ty0Ga')).toBe(true);
  });
});
