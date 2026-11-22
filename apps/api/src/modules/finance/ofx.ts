import { createHash } from 'node:crypto';

export interface OfxLine {
  date: string;
  amount: number;
  memo: string;
  fitid: string;
}

/**
 * Lê as movimentações de um extrato OFX (o formato que todo banco brasileiro exporta).
 * Aceita o OFX antigo (SGML, sem fechar as tags) e o novo (XML).
 */
export function parseOfx(text: string): OfxLine[] {
  const out: OfxLine[] = [];
  const vistos = new Map<string, number>();
  const blocos = text.split(/<STMTTRN>/i).slice(1);
  for (const bruto of blocos) {
    const b = bruto.split(/<\/STMTTRN>/i)[0] ?? bruto;
    const campo = (tag: string) => new RegExp(`<${tag}>([^<\\r\\n]*)`, 'i').exec(b)?.[1]?.trim() ?? '';
    const dt = campo('DTPOSTED');
    const valor = Number(campo('TRNAMT').replace(/\s/g, '').replace(/\.(?=\d{3},)/g, '').replace(',', '.'));
    if (!/^\d{8}/.test(dt) || !Number.isFinite(valor) || valor === 0) continue;
    const date = `${dt.slice(0, 4)}-${dt.slice(4, 6)}-${dt.slice(6, 8)}`;
    const memo = [campo('MEMO'), campo('NAME')].filter((x, i, a) => x && a.indexOf(x) === i).join(' · ').replace(/&amp;/g, '&').slice(0, 200);
    // Alguns bancos repetem (ou não mandam) o FITID: a chave junta dia, valor e texto, e numera as repetições.
    const base = `${campo('FITID')}|${date}|${valor.toFixed(2)}|${memo}`;
    const n = (vistos.get(base) ?? 0) + 1;
    vistos.set(base, n);
    out.push({ date, amount: Math.round(valor * 100) / 100, memo, fitid: createHash('sha1').update(`${base}|${n}`).digest('hex').slice(0, 24) });
  }
  return out;
}
