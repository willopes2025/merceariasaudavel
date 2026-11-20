import { z } from 'zod';

/**
 * Fiscal: NFC-e da venda do caixa pela Focus NFe, uma configuração por loja.
 * Nada é emitido enquanto a loja não estiver ligada, com CNPJ e token do ambiente.
 */

export const FISCAL_ENVIRONMENTS = {
  homologacao: 'Homologação (teste, sem valor fiscal)',
  producao: 'Produção (nota de verdade)',
} as const;
export type FiscalEnvironment = keyof typeof FISCAL_ENVIRONMENTS;

export const FISCAL_STATUS = {
  processing: 'Processando',
  authorized: 'Autorizada',
  rejected: 'Rejeitada',
  canceled: 'Cancelada',
  error: 'Não enviada',
} as const;
export type FiscalStatus = keyof typeof FISCAL_STATUS;

/** O token da Focus NFe é uma sequência de letras e números; texto de exemplo não passa. */
export function looksLikeFocusToken(v: string): boolean {
  return /^[A-Za-z0-9]{20,80}$/.test(v) && !/(token|exemplo|cole|aqui|teste|xxxx)/i.test(v);
}

/** undefined = não mexe; null = apaga; texto = grava. */
const token = z
  .string()
  .trim()
  .refine(looksLikeFocusToken, 'Isso não parece um token da Focus NFe. Copie o token no painel da Focus, em Empresas.')
  .nullish();

export const fiscalConfigSchema = z.object({
  enabled: z.boolean(),
  /** Emite a NFC-e sozinha quando a venda é finalizada no caixa. */
  autoEmit: z.boolean().default(true),
  environment: z.enum(['homologacao', 'producao']),
  tokenHomologacao: token,
  tokenProducao: token,
  cfop: z.string().trim().regex(/^\d{4}$/, 'CFOP tem 4 números').default('5102'),
  /** Origem da mercadoria (0 = nacional). */
  icmsOrigin: z.string().trim().regex(/^[0-8]$/, 'Origem de 0 a 8').default('0'),
  /** CSOSN (Simples Nacional, ex.: 102) ou CST. */
  icmsCst: z.string().trim().regex(/^\d{2,3}$/, 'CSOSN/CST com 2 ou 3 números').default('102'),
  /** Usado quando o produto não tem NCM. */
  defaultNcm: z
    .string()
    .trim()
    .transform((v) => v.replace(/\D/g, ''))
    .refine((v) => v === '' || v.length === 8, 'NCM tem 8 números')
    .nullish()
    .transform((v) => v || null),
});
export type FiscalConfigInput = z.infer<typeof fiscalConfigSchema>;

export interface FiscalConfig {
  storeId: string;
  storeName: string;
  cnpj: string | null;
  enabled: boolean;
  autoEmit: boolean;
  environment: FiscalEnvironment;
  /** O token nunca volta para a tela: só se está gravado. */
  tokenHomologacaoSet: boolean;
  tokenProducaoSet: boolean;
  cfop: string;
  icmsOrigin: string;
  icmsCst: string;
  defaultNcm: string | null;
  /** Pronta para emitir no ambiente escolhido. */
  ready: boolean;
  missing: string[];
}

export interface FiscalDocument {
  id: string;
  kind: 'nfce';
  storeId: string;
  storeName: string;
  saleId: string;
  saleNumber: number | null;
  customerName: string | null;
  environment: FiscalEnvironment;
  status: FiscalStatus;
  number: string | null;
  series: string | null;
  accessKey: string | null;
  total: number;
  message: string | null;
  danfeUrl: string | null;
  xmlUrl: string | null;
  createdAt: string;
  userName: string | null;
  canceledAt: string | null;
  cancelReason: string | null;
}

/** Formas de pagamento da nota (tabela da SEFAZ). */
export const NFCE_PAYMENT = {
  dinheiro: { code: '01', label: 'Dinheiro' },
  credito: { code: '03', label: 'Cartão de crédito' },
  debito: { code: '04', label: 'Cartão de débito' },
  pix: { code: '17', label: 'Pix' },
  outro: { code: '99', label: 'Outros' },
  prazo: { code: '05', label: 'Crediário / a receber' },
} as const;
export type NfcePaymentKind = keyof typeof NFCE_PAYMENT;

export interface NfcePayment {
  kind: NfcePaymentKind;
  code: string;
  label: string;
  amount: number;
}

/**
 * Reparte o total da nota entre o que já foi recebido (por forma) e, o que
 * sobrar, como crediário/a receber. A soma sempre bate com o total da nota.
 */
export function allocateNfcePayments(total: number, received: Array<{ kind: string; amount: number }>): NfcePayment[] {
  const cents = (v: number) => Math.round(v * 100);
  let left = cents(total);
  const byKind = new Map<NfcePaymentKind, number>();
  for (const r of received) {
    if (left <= 0) break;
    const kind = (r.kind in NFCE_PAYMENT && r.kind !== 'prazo' ? r.kind : 'outro') as NfcePaymentKind;
    const take = Math.min(left, Math.max(0, cents(r.amount)));
    if (!take) continue;
    byKind.set(kind, (byKind.get(kind) ?? 0) + take);
    left -= take;
  }
  if (left > 0) byKind.set('prazo', left);
  return [...byKind.entries()].map(([kind, c]) => ({ kind, code: NFCE_PAYMENT[kind].code, label: NFCE_PAYMENT[kind].label, amount: c / 100 }));
}

export interface FiscalPreviewItem {
  description: string;
  ncm: string | null;
  quantity: number;
  unitPrice: number;
  discount: number;
  total: number;
}

/** O que vai na nota desta venda, antes de emitir. */
export interface FiscalPreview {
  /** A loja está configurada e ligada. */
  ready: boolean;
  missing: string[];
  environment: FiscalEnvironment;
  customer: { name: string; document: string | null };
  items: FiscalPreviewItem[];
  /** Itens que não entram na NFC-e (serviço). */
  excluded: Array<{ description: string; reason: string }>;
  payments: NfcePayment[];
  total: number;
  /** O que impede a emissão. Vazio = pode emitir. */
  problems: string[];
  documents: FiscalDocument[];
}

export const fiscalEmitSchema = z.object({
  /** Identificar o cliente (CPF/CNPJ) na nota. */
  includeCustomer: z.boolean().default(true),
  /** CPF/CNPJ digitado no caixa (cliente sem cadastro que pediu CPF na nota). */
  cpf: z
    .string()
    .nullish()
    .transform((v) => (v ? v.replace(/\D/g, '') : null))
    .refine((v) => v === null || v.length === 11 || v.length === 14, 'CPF ou CNPJ inválido'),
});
export type FiscalEmitInput = z.infer<typeof fiscalEmitSchema>;

export const fiscalCancelSchema = z.object({
  reason: z.string().trim().min(15, 'A SEFAZ exige um motivo com pelo menos 15 letras').max(255),
});

const isoDay = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
export const fiscalListQuery = z.object({
  from: isoDay.optional(),
  to: isoDay.optional(),
  storeId: z.string().uuid().optional(),
  status: z.enum(['all', 'processing', 'authorized', 'rejected', 'canceled', 'error']).default('all'),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(30),
});
export type FiscalListQuery = z.infer<typeof fiscalListQuery>;
