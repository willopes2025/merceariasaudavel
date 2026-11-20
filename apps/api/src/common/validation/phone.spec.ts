import { describe, expect, it } from 'vitest';
import { normalizePhone, phoneField } from './phone';

describe('telefone +DDI DDD número', () => {
  it('converte o que a pessoa digita', () => {
    expect(normalizePhone('(27) 99999-0000')).toBe('+5527999990000');
    expect(normalizePhone('27 3333-4444')).toBe('+552733334444');
    expect(normalizePhone('027 3333-4444')).toBe('+552733334444');
    expect(normalizePhone('55 27 99999 0000')).toBe('+5527999990000');
    expect(normalizePhone('+5527999990000')).toBe('+5527999990000');
    expect(normalizePhone('+1 305 555 0100')).toBe('+13055550100');
    expect(normalizePhone('0055 27 99999-0000')).toBe('+5527999990000');
  });
  it('vazio vira nulo; curto demais é recusado', () => {
    expect(normalizePhone('')).toBeNull();
    expect(normalizePhone(null)).toBeNull();
    expect(normalizePhone('99999-0000')).toBeUndefined();
    expect(phoneField().safeParse('9999').success).toBe(false);
    expect(phoneField().parse('(31) 98888-7777')).toBe('+5531988887777');
    expect(phoneField().parse(undefined)).toBeUndefined();
  });
});
