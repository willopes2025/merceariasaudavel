import { describe, expect, it } from 'vitest';
import { afdDataHora, buildAfd, crc16Kermit } from './afd';

const base = { employerDoc: '12.345.678/0001-95', employerName: 'Mercearia Saudável Ltda', inpi: '', developerDoc: '11222333000181', from: '2026-11-01', to: '2026-11-30', generatedAt: new Date('2026-12-01T12:00:30Z') };
const rec = (nsr: number, iso: string, source = 'proprio') => ({ nsr, at: new Date(iso), cpf: '52998224725', source });

describe('AFD (Portaria 671)', () => {
  it('CRC-16/KERMIT bate com o exemplo da portaria', () => expect(crc16Kermit('123456789')).toBe('2189'));
  it('data e hora no fuso de Brasília, com segundos zerados', () => expect(afdDataHora(new Date('2026-11-03T11:44:59Z'))).toBe('2026-11-03T08:44:00-0300'));
  it('tamanhos das linhas: cabeçalho 302, marcação 137, trailer 64, assinatura 100', () => {
    const { text, count } = buildAfd({ ...base, records: [rec(1, '2026-11-03T11:00:00Z'), rec(2, '2026-11-03T15:00:00Z', 'loja')] });
    const l = text.split('\r\n');
    expect(count).toBe(2);
    expect(l.slice(0, 5).map((x) => x.length)).toEqual([302, 137, 137, 64, 100]);
    expect(l[5]).toBe('');
    expect(l[0]!.slice(250, 253)).toBe('004');
    expect(l[0]!.slice(39, 62)).toBe('Mercearia Saudavel Ltda');
    expect(crc16Kermit(l[0]!.slice(0, 298))).toBe(l[0]!.slice(298));
    expect(l[1]!.slice(0, 46)).toBe('00000000172026-11-03T08:00:00-0300052998224725');
    expect(l[2]!.slice(70, 73)).toBe('040');
    expect(l[3]).toBe('999999999' + '000000000'.repeat(5) + '000000002' + '9');
  });
  it('o hash é encadeado desde a primeira marcação, mesmo quando ela fica fora do período', () => {
    const todas = [rec(1, '2026-10-30T11:00:00Z'), rec(2, '2026-11-03T11:00:00Z')];
    const a = buildAfd({ ...base, records: todas }).text.split('\r\n');
    const so = buildAfd({ ...base, records: [todas[1]!] }).text.split('\r\n');
    expect(a).toHaveLength(5);
    expect(a[1]!.slice(0, 73)).toBe(so[1]!.slice(0, 73));
    expect(a[1]!.slice(73)).not.toBe(so[1]!.slice(73));
  });
});
