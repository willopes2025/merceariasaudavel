import { allocateNfcePayments, type FiscalPreviewItem, type NfcePayment } from '@mercearia/contracts';

export interface NfceLine {
  description: string;
  quantity: number;
  unitPrice: number;
  /** Desconto da linha inteira. */
  discount: number;
  product: { kind: string; ncm: string | null; cest?: string | null; unit: string | null; sku: string | null; barcode?: string | null } | null;
}

export interface NfceDraft {
  items: Array<FiscalPreviewItem & { code: string; unit: string; cest: string | null; ean: string | null; gross: number }>;
  excluded: Array<{ description: string; reason: string }>;
  payments: NfcePayment[];
  total: number;
  problems: string[];
}

const cents = (v: number) => Math.round(v * 100);

/** Monta os itens da NFC-e e aponta o que falta (NCM, valor). Quantidade pode ser quebrada (kg). */
export function draftNfce(lines: NfceLine[], received: Array<{ kind: string; amount: number }>, defaultNcm: string | null): NfceDraft {
  const draft: NfceDraft = { items: [], excluded: [], payments: [], total: 0, problems: [] };
  let total = 0;
  lines.forEach((l, i) => {
    const ncm = (l.product?.ncm ?? defaultNcm ?? '').replace(/\D/g, '') || null;
    const gross = Math.round(cents(l.unitPrice) * l.quantity);
    const lineTotal = gross - cents(l.discount);
    if (!ncm || ncm.length !== 8) draft.problems.push(`Falta o NCM de "${l.description}". Preencha no cadastro do produto ou defina um NCM padrão na configuração fiscal.`);
    if (lineTotal <= 0) draft.problems.push(`"${l.description}" está com valor zerado: a SEFAZ não aceita item sem valor.`);
    total += Math.max(0, lineTotal);
    draft.items.push({
      description: l.description.slice(0, 120),
      ncm,
      quantity: l.quantity,
      unitPrice: l.unitPrice,
      discount: l.discount,
      total: lineTotal / 100,
      gross: gross / 100,
      code: (l.product?.sku ?? l.product?.barcode ?? `ITEM${i + 1}`).slice(0, 60),
      unit: (l.product?.unit ?? 'UN').toUpperCase().slice(0, 6),
      cest: l.product?.cest ?? null,
      ean: l.product?.barcode && /^\d{8}$|^\d{12,14}$/.test(l.product.barcode) ? l.product.barcode : null,
    });
  });
  if (!draft.items.length) draft.problems.push('Não há produto nesta venda para colocar na nota.');
  draft.total = total / 100;
  draft.payments = total > 0 ? allocateNfcePayments(draft.total, received) : [];
  return draft;
}

/** JSON da NFC-e no formato da Focus NFe. */
export function nfcePayload(p: {
  cnpj: string;
  saleNumber: number;
  cfop: string;
  icmsOrigin: string;
  icmsCst: string;
  customer: { name: string; document: string } | null;
  draft: NfceDraft;
  now?: Date;
}): Record<string, unknown> {
  // Horário de Brasília, com o fuso, como a SEFAZ exige.
  const emission = `${new Date((p.now ?? new Date()).getTime() - 3 * 3600_000).toISOString().slice(0, 19)}-03:00`;
  const doc = p.customer?.document.replace(/\D/g, '') ?? '';
  return {
    cnpj_emitente: p.cnpj,
    data_emissao: emission,
    natureza_operacao: 'VENDA AO CONSUMIDOR',
    modalidade_frete: '9',
    local_destino: '1',
    presenca_comprador: '1',
    indicador_inscricao_estadual_destinatario: '9',
    ...(doc.length === 11 ? { cpf_destinatario: doc, nome_destinatario: p.customer!.name.slice(0, 60) } : {}),
    ...(doc.length === 14 ? { cnpj_destinatario: doc, nome_destinatario: p.customer!.name.slice(0, 60) } : {}),
    informacoes_adicionais_contribuinte: `Venda ${p.saleNumber}`,
    items: p.draft.items.map((i, n) => ({
      numero_item: String(n + 1),
      codigo_produto: i.code,
      descricao: i.description,
      codigo_ncm: i.ncm,
      cfop: p.cfop,
      unidade_comercial: i.unit,
      quantidade_comercial: i.quantity,
      valor_unitario_comercial: i.unitPrice,
      unidade_tributavel: i.unit,
      quantidade_tributavel: i.quantity,
      valor_unitario_tributavel: i.unitPrice,
      valor_bruto: i.gross,
      codigo_barras_comercial: i.ean ?? 'SEM GTIN',
      codigo_barras_tributavel: i.ean ?? 'SEM GTIN',
      ...(i.cest ? { cest: i.cest } : {}),
      ...(i.discount > 0 ? { valor_desconto: i.discount } : {}),
      icms_origem: p.icmsOrigin,
      icms_situacao_tributaria: p.icmsCst,
    })),
    formas_pagamento: p.draft.payments.map((pay) => ({
      forma_pagamento: pay.code,
      valor_pagamento: pay.amount,
      // Maquininha separada do sistema (não integrada).
      ...(['03', '04', '17'].includes(pay.code) ? { tipo_integracao: '2' } : {}),
      ...(pay.code === '99' ? { descricao_pagamento: 'Outros' } : {}),
    })),
  };
}
