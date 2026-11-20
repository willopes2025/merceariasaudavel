import { XMLParser } from 'fast-xml-parser';
import { DomainError } from '../../common/errors/domain-error';

export interface PurchaseNote {
  accessKey: string;
  number: string;
  series: string | null;
  issuedAt: string;
  supplier: { name: string; document: string };
  total: number;
  items: Array<{ index: number; code: string; ean: string | null; description: string; ncm: string | null; cest: string | null; unit: string | null; quantity: number; unitCost: number; total: number; lots: Array<{ code: string; expiresAt: string | null; quantity: number }> }>;
  installments: Array<{ number: string; dueDate: string; amount: number }>;
}

// Tudo como texto: código de barras e NCM perdem os zeros à esquerda se virarem número.
const parser = new XMLParser({ ignoreAttributes: false, attributeNamePrefix: '@', parseTagValue: false, parseAttributeValue: false, removeNSPrefix: true, isArray: (name) => name === 'det' || name === 'dup' || name === 'rastro' });

const text = (v: unknown, max = 200): string | null => {
  const s = typeof v === 'string' ? v.trim() : typeof v === 'number' ? String(v) : '';
  return s ? s.slice(0, max) : null;
};
const num = (v: unknown): number => {
  const n = Number(text(v) ?? '');
  return Number.isFinite(n) ? n : 0;
};
const bad = (message: string) => new DomainError('XML_INVALID', message, undefined, 400);

/** Lê o XML de uma NF-e (nfeProc ou NFe) e devolve só o que a entrada de estoque usa. */
export function readPurchaseNote(xml: string): PurchaseNote {
  let doc: Record<string, any>;
  try {
    doc = parser.parse(xml) as Record<string, any>;
  } catch {
    throw bad('Não consegui ler o arquivo. Envie o XML da nota (não o PDF).');
  }
  const inf = (doc.nfeProc?.NFe ?? doc.NFe ?? doc.enviNFe?.NFe)?.infNFe;
  if (!inf) throw bad(doc.CTe || doc.cteProc ? 'Esse XML é de um conhecimento de transporte (CT-e), não de uma nota de compra.' : 'Esse arquivo não é o XML de uma NF-e.');
  const accessKey = String(inf['@Id'] ?? '').replace(/\D/g, '');
  if (accessKey.length !== 44) throw bad('O XML não traz a chave de acesso da nota.');
  if (text(inf.ide?.mod) !== '55') throw bad('Só a NF-e (modelo 55) do fornecedor dá entrada no estoque.');
  const supplierDocument = text(inf.emit?.CNPJ) ?? text(inf.emit?.CPF);
  const supplierName = text(inf.emit?.xNome, 150);
  if (!supplierDocument || !supplierName) throw bad('O XML não traz o fornecedor.');
  const dets = (inf.det ?? []) as Array<Record<string, any>>;
  if (!dets.length) throw bad('A nota não tem itens.');
  const issued = text(inf.ide?.dhEmi) ?? text(inf.ide?.dEmi) ?? '';
  if (!/^\d{4}-\d{2}-\d{2}/.test(issued)) throw bad('O XML não traz a data de emissão.');
  return {
    accessKey,
    number: text(inf.ide?.nNF) ?? '',
    series: text(inf.ide?.serie),
    issuedAt: issued.slice(0, 10),
    supplier: { name: supplierName, document: supplierDocument },
    total: num(inf.total?.ICMSTot?.vNF),
    items: dets.map((d, index) => {
      const p = d.prod ?? {};
      const ean = text(p.cEAN)?.replace(/\D/g, '') ?? '';
      return {
        index,
        code: text(p.cProd, 60) ?? String(index + 1),
        // "SEM GTIN" vira vazio.
        ean: ean.length >= 8 ? ean : null,
        description: text(p.xProd, 150) ?? 'Item sem descrição',
        ncm: text(p.NCM)?.replace(/\D/g, '') || null,
        cest: text(p.CEST)?.replace(/\D/g, '') || null,
        unit: text(p.uCom, 6),
        quantity: num(p.qCom),
        unitCost: Math.round(num(p.vUnCom) * 10000) / 10000,
        total: num(p.vProd),
        // Rastreabilidade (lote e validade), quando o fornecedor informa.
        lots: ((p.rastro ?? []) as Array<Record<string, any>>)
          .map((r) => ({ code: text(r.nLote, 40) ?? '', expiresAt: /^\d{4}-\d{2}-\d{2}$/.test(text(r.dVal) ?? '') ? text(r.dVal) : null, quantity: num(r.qLote) }))
          .filter((r) => r.code && r.quantity > 0),
      };
    }),
    installments: ((inf.cobr?.dup ?? []) as Array<Record<string, any>>)
      .map((d, i) => ({ number: text(d.nDup) ?? String(i + 1), dueDate: text(d.dVenc) ?? '', amount: num(d.vDup) }))
      .filter((d) => /^\d{4}-\d{2}-\d{2}$/.test(d.dueDate) && d.amount > 0),
  };
}
