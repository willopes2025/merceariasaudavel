import { createHash } from 'node:crypto';

/**
 * Arquivo Fonte de Dados (AFD) do ponto por programa (REP-P), no leiaute 004 do Anexo V da Portaria MTP 671/2021:
 * cabeçalho (tipo 1), uma linha por marcação (tipo 7, com SHA-256 encadeado), trailer (tipo 9) e a linha de assinatura.
 * Texto ISO 8859-1, uma linha por registro, terminada em CR LF.
 */
export interface AfdInput {
  /** CNPJ (14) ou CPF (11) do empregador, só números. */
  employerDoc: string;
  employerName: string;
  /** Número de registro do programa no INPI (17 posições). */
  inpi: string;
  /** CNPJ ou CPF de quem desenvolveu o programa. */
  developerDoc: string;
  from: string;
  to: string;
  generatedAt: Date;
  /** TODAS as marcações da empresa desde a primeira, em ordem de NSR: o hash de cada uma depende da anterior. */
  records: Array<{ nsr: number; at: Date; cpf: string; source: string }>;
}

const num = (v: string | number, n: number) => String(v).replace(/\D/g, '').slice(-n).padStart(n, '0');
const txt = (v: string, n: number) => v.normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^\x20-\x7E]/g, ' ').slice(0, n).padEnd(n, ' ');

/** Data e hora no fuso de Brasília, sempre com segundos "00": 2021-04-27T16:44:00-0300. */
export function afdDataHora(d: Date): string {
  const l = new Date(d.getTime() - 3 * 3_600_000).toISOString();
  return `${l.slice(0, 16)}:00-0300`;
}

/** CRC-16/KERMIT (CCITT-TRUE), em 4 caracteres hexadecimais: "123456789" → "2189". */
export function crc16Kermit(s: string): string {
  let crc = 0;
  for (const b of Buffer.from(s, 'latin1')) {
    crc ^= b;
    for (let i = 0; i < 8; i++) crc = crc & 1 ? (crc >>> 1) ^ 0x8408 : crc >>> 1;
  }
  return crc.toString(16).toUpperCase().padStart(4, '0');
}

export function buildAfd(d: AfdInput): { text: string; count: number } {
  const linhas: string[] = [];
  const doc = d.employerDoc.replace(/\D/g, '');
  const dev = d.developerDoc.replace(/\D/g, '');
  const cab =
    '000000000' + '1' + (doc.length === 11 ? '2' : '1') + txt(doc, 14) + num('', 14) + txt(d.employerName, 150) + num(d.inpi, 17) + d.from + d.to + afdDataHora(d.generatedAt) + '004' + (dev.length === 11 ? '2' : '1') + txt(dev, 14) + txt('', 30);
  linhas.push(cab + crc16Kermit(cab));
  let anterior = '';
  let count = 0;
  for (const r of d.records) {
    const quando = afdDataHora(r.at);
    // 02 = navegador (a pessoa bate no próprio login); 04 = dispositivo da loja (com PIN).
    const corpo = num(r.nsr, 9) + '7' + quando + num(r.cpf, 12) + quando + (r.source === 'loja' ? '04' : '02') + '0';
    anterior = createHash('sha256').update(corpo + anterior).digest('hex');
    const dia = quando.slice(0, 10);
    if (dia < d.from || dia > d.to) continue;
    linhas.push(corpo + anterior);
    count++;
  }
  linhas.push('999999999' + num(0, 9).repeat(5) + num(count, 9) + '9');
  linhas.push(txt('ASSINATURA_DIGITAL_EM_ARQUIVO_P7S', 100));
  return { text: linhas.join('\r\n') + '\r\n', count };
}
