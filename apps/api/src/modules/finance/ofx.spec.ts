import { describe, expect, it } from 'vitest';
import { parseOfx } from './ofx';

const SGML = `OFXHEADER:100
<OFX><BANKMSGSRSV1><STMTTRNRS><STMTRS><BANKTRANLIST>
<STMTTRN>
<TRNTYPE>DEBIT
<DTPOSTED>20261103120000[-3:BRT]
<TRNAMT>-1500.00
<FITID>202611030001
<MEMO>PIX ENVIADO ALUGUEL
</STMTTRN>
<STMTTRN><TRNTYPE>CREDIT<DTPOSTED>20261104<TRNAMT>230,45<FITID>X<MEMO>CREDITO CARTAO</STMTTRN>
<STMTTRN><TRNTYPE>CREDIT<DTPOSTED>20261104<TRNAMT>230,45<FITID>X<MEMO>CREDITO CARTAO</STMTTRN>
</BANKTRANLIST></STMTRS></STMTTRNRS></BANKMSGSRSV1></OFX>`;

describe('parseOfx', () => {
  it('lê data, valor e texto, com vírgula ou ponto', () => {
    const l = parseOfx(SGML);
    expect(l).toHaveLength(3);
    expect(l[0]).toMatchObject({ date: '2026-11-03', amount: -1500, memo: 'PIX ENVIADO ALUGUEL' });
    expect(l[1]).toMatchObject({ date: '2026-11-04', amount: 230.45 });
  });
  it('linhas iguais no mesmo dia ganham chaves diferentes, e a chave é estável', () => {
    const [, a, b] = parseOfx(SGML);
    expect(a!.fitid).not.toBe(b!.fitid);
    expect(parseOfx(SGML)[1]!.fitid).toBe(a!.fitid);
  });
  it('ignora o que não é extrato', () => expect(parseOfx('nada aqui')).toEqual([]));
});
