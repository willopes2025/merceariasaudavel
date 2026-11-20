import { z } from 'zod';
import { isValidCnpj, isValidCpf, normalizePhone, onlyDigits } from './br';

// ------------------------------------------------------------- campos

const optionalText = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .optional()
    .nullable()
    .transform((v) => (v ? v : null));

const phone = z
  .string()
  .optional()
  .nullable()
  .transform((v, ctx) => {
    if (!v || !onlyDigits(v)) return null;
    const normalized = normalizePhone(v);
    if (!normalized) {
      ctx.addIssue({ code: 'custom', message: 'Telefone inválido: use DDD + número' });
      return z.NEVER;
    }
    return normalized;
  });

const isoDate = z
  .string()
  .optional()
  .nullable()
  .transform((v) => (v ? v : null))
  .refine((v) => v === null || (/^\d{4}-\d{2}-\d{2}$/.test(v) && !Number.isNaN(Date.parse(v))), 'Data inválida')
  .refine((v) => v === null || Date.parse(v) <= Date.now(), 'A data não pode ser no futuro');

// ------------------------------------------------------------- cliente

/** Objetivo declarado pela cliente: ajuda o atendimento e, depois, o montador de kit. */
export const CUSTOMER_GOALS = {
  massa: 'Ganho de massa',
  emagrecer: 'Emagrecimento',
  low_carb: 'Low carb',
  vegano: 'Vegano',
  sem_gluten: 'Sem glúten',
  sem_lactose: 'Sem lactose',
  energia: 'Energia e desempenho',
  saude: 'Saúde e bem-estar',
} as const;
export type CustomerGoal = keyof typeof CUSTOMER_GOALS;

/**
 * Cadastro. Para virar membro basta nome + celular (no caixa, em segundos).
 * CPF é opcional; quando vem tem que ser válido e é único na organização.
 */
export const customerSchema = z
  .object({
    name: z.string().trim().min(2, 'Informe o nome').max(160),
    document: z
      .string()
      .optional()
      .nullable()
      .transform((v) => onlyDigits(v) || null)
      .refine((v) => v === null || (v.length === 11 ? isValidCpf(v) : v.length === 14 ? isValidCnpj(v) : false), 'CPF ou CNPJ inválido'),
    birthDate: isoDate,
    phone,
    email: z
      .string()
      .trim()
      .toLowerCase()
      .optional()
      .nullable()
      .transform((v) => (v ? v : null))
      .refine((v) => v === null || z.string().email().safeParse(v).success, 'E-mail inválido'),
    allowWhatsapp: z.boolean().default(true),
    goal: z
      .enum(Object.keys(CUSTOMER_GOALS) as [CustomerGoal, ...CustomerGoal[]])
      .optional()
      .nullable()
      .transform((v) => v ?? null),
    /** Membro do clube: paga o preço de membro e junta cashback. */
    isMember: z.boolean().default(false),
    notes: optionalText(1000),
    active: z.boolean().default(true),
  })
  .refine((c) => !c.isMember || c.phone, { path: ['phone'], message: 'Membro precisa de celular (é por ele que o caixa acha a cliente)' });
export type CustomerInput = z.infer<typeof customerSchema>;
/** O que a tela manda (antes das transformações). */
export type CustomerForm = z.input<typeof customerSchema>;

export interface Customer {
  id: string;
  name: string;
  document: string | null;
  birthDate: string | null;
  phone: string | null;
  email: string | null;
  allowWhatsapp: boolean;
  goal: CustomerGoal | null;
  isMember: boolean;
  memberSince: string | null;
  memberSource: 'loja' | 'app' | null;
  cashbackBalance: number;
  notes: string | null;
  active: boolean;
  createdAt: string;
  updatedAt: string;
  /** Resumo de compras. */
  stats: { purchases: number; spent: number; lastPurchaseAt: string | null; averageTicket: number };
}

/** Linha da lista: o que cabe numa tabela. */
export interface CustomerRow {
  id: string;
  name: string;
  document: string | null;
  phone: string | null;
  isMember: boolean;
  cashbackBalance: number;
  goal: CustomerGoal | null;
  active: boolean;
  createdAt: string;
}

export const customerListQuery = z.object({
  q: z.string().trim().max(100).optional(),
  members: z.enum(['all', 'members', 'non_members']).default('all'),
  status: z.enum(['active', 'inactive', 'all']).default('active'),
  /** Aniversariantes do mês (1–12). */
  birthMonth: z.coerce.number().int().min(1).max(12).optional(),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(10).max(100).default(50),
});
export type CustomerListQuery = z.infer<typeof customerListQuery>;

export interface Page<T> {
  items: T[];
  total: number;
  page: number;
  pageSize: number;
}

/** Para achar a cliente no caixa: por celular, CPF ou nome. */
export interface CustomerOption {
  id: string;
  name: string;
  phone: string | null;
  document: string | null;
  isMember: boolean;
  cashbackBalance: number;
}

export const CASHBACK_ENTRY_TYPES = {
  credito: 'Cashback da compra',
  uso: 'Usado na compra',
  estorno: 'Estorno (venda cancelada)',
  vencido: 'Venceu',
  ajuste: 'Ajuste',
} as const;
export type CashbackEntryType = keyof typeof CASHBACK_ENTRY_TYPES;

export interface CashbackEntry {
  id: string;
  type: CashbackEntryType;
  amount: number;
  balanceAfter: number;
  saleNumber: number | null;
  expiresAt: string | null;
  note: string | null;
  at: string;
}

/** Item do histórico do cliente. */
export interface TimelineItem {
  at: string;
  action: string;
  label: string;
  userName: string | null;
}

// ------------------------------------------------------------- regras do clube

const pct = z.preprocess(
  (v) => (typeof v === 'string' ? Number(v.replace(',', '.')) : v),
  z.number({ invalid_type_error: 'Número inválido' }).min(0, 'Não pode ser negativo').max(100, 'No máximo 100%'),
);

export const clubSettingsSchema = z.object({
  /** % do valor pago que volta como cashback ao membro (0 = sem cashback). */
  cashbackPct: pct,
  /** Dias até o cashback vencer (0 = não vence). */
  cashbackDays: z.coerce.number().int().min(0).max(3650),
  /** Até quanto % de uma compra pode ser pago com cashback. */
  cashbackMaxUsePct: pct,
});
export type ClubSettings = z.infer<typeof clubSettingsSchema>;
