import { describe, expect, it } from 'vitest';
import { formatCpf, formatPhone, isValidCnpj, isValidCpf, normalizePhone, normalizeText, properName, searchText, addDays, todayBR } from './br';

describe('CPF e CNPJ', () => {
  it('aceita CPF válido com ou sem máscara', () => {
    expect(isValidCpf('529.982.247-25')).toBe(true);
    expect(isValidCpf('52998224725')).toBe(true);
  });
  it('recusa dígito errado e sequência repetida', () => {
    expect(isValidCpf('529.982.247-24')).toBe(false);
    expect(isValidCpf('111.111.111-11')).toBe(false);
    expect(isValidCpf('123')).toBe(false);
  });
  it('valida CNPJ', () => {
    expect(isValidCnpj('11.222.333/0001-81')).toBe(true);
    expect(isValidCnpj('11.222.333/0001-80')).toBe(false);
  });
  it('formata', () => {
    expect(formatCpf('52998224725')).toBe('529.982.247-25');
  });
});

describe('telefone', () => {
  it('deixa tudo no formato do WhatsApp (55 + DDD + número)', () => {
    expect(normalizePhone('(27) 99999-1234')).toBe('5527999991234');
    expect(normalizePhone('+55 27 9 9999-1234')).toBe('5527999991234');
    expect(normalizePhone('027 99999-1234')).toBe('5527999991234');
    expect(normalizePhone('(27) 3333-1234')).toBe('552733331234');
  });
  it('acrescenta o 9 que falta em celular antigo', () => {
    expect(normalizePhone('27 9999-1234')).toBe('5527999991234');
  });
  it('não inventa número', () => {
    expect(normalizePhone('1234')).toBeNull();
    expect(normalizePhone('')).toBeNull();
  });
  it('formata para mostrar', () => {
    expect(formatPhone('5527999991234')).toBe('(27) 99999-1234');
  });
});

describe('busca', () => {
  it('tira acento e junta os campos', () => {
    expect(normalizeText('João  Conceição')).toBe('joao conceicao');
    expect(searchText(['Maria José', '52998224725', null])).toBe('maria jose 52998224725');
  });
  it('arruma nome em caixa alta', () => {
    expect(properName('MARIA DA SILVA  SANTOS')).toBe('Maria da Silva Santos');
  });
});

describe('datas no horário de Brasília', () => {
  it('às 21h30 de Brasília ainda é hoje, não amanhã', () => {
    expect(todayBR(new Date('2026-11-20T00:30:00Z'))).toBe('2026-11-19');
    expect(todayBR(new Date('2026-11-20T15:00:00Z'))).toBe('2026-11-20');
  });
  it('soma dias virando o mês', () => {
    expect(addDays('2026-11-28', 7)).toBe('2026-12-05');
  });
});
