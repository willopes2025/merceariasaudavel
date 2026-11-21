import { z } from 'zod';
import { normalizePhone, onlyDigits } from './br';
import { CUSTOMER_GOALS, type CustomerGoal } from './customers';
import { parseNumber } from './products';
import type { ShopProduct } from './shop';

/**
 * Parceiros (nutricionista, personal, influenciador): código próprio que dá
 * desconto à cliente e comissão ao parceiro. A cliente fica ligada ao parceiro
 * (link de indicação no app ou código no caixa) e as compras dela geram comissão.
 * Kits: produtos montados para um objetivo (ou receitados por um parceiro).
 */

export const PARTNER_KINDS = { nutricionista: 'Nutricionista', personal: 'Personal trainer', influenciador: 'Influenciador(a)', outro: 'Outro' } as const;
export type PartnerKind = keyof typeof PARTNER_KINDS;

const pct = (msg: string) => z.preprocess((v) => (v === '' || v == null ? null : parseNumber(v)), z.number({ invalid_type_error: msg }).min(0).max(100, 'No máximo 100%').nullable());

export const partnerSchema = z.object({
  name: z.string().trim().min(2, 'Informe o nome').max(120),
  kind: z.enum(['nutricionista', 'personal', 'influenciador', 'outro']).default('nutricionista'),
  document: z
    .string()
    .nullish()
    .transform((v) => onlyDigits(v) || null)
    .refine((v) => v === null || v.length === 11 || v.length === 14, 'CPF ou CNPJ inválido'),
  phone: z
    .string()
    .nullish()
    .transform((v, ctx) => {
      if (!v || !v.trim()) return null;
      const n = normalizePhone(v);
      if (!n) {
        ctx.addIssue({ code: 'custom', message: 'WhatsApp inválido' });
        return z.NEVER;
      }
      return n;
    }),
  email: z
    .string()
    .trim()
    .toLowerCase()
    .nullish()
    .transform((v) => v || null)
    .refine((v) => v === null || z.string().email().safeParse(v).success, 'E-mail inválido'),
  code: z
    .string()
    .trim()
    .toUpperCase()
    .refine((v) => /^[A-Z0-9-]{3,20}$/.test(v), 'Código: 3 a 20 letras, números ou hífen'),
  customerDiscountPct: pct('Desconto inválido').refine((v) => v === null || v > 0, 'Desconto maior que zero (ou deixe vazio)').default(null),
  commissionPct: pct('Comissão inválida').transform((v) => v ?? 0).default(0),
  notes: z
    .string()
    .trim()
    .max(500)
    .nullish()
    .transform((v) => v || null),
  active: z.boolean().default(true),
});
export type PartnerInput = z.infer<typeof partnerSchema>;

export interface PartnerMonth {
  month: string;
  customers: number;
  newCustomers: number;
  sales: number;
  revenue: number;
  commission: number;
  /** Já fechado (virou conta a pagar). */
  closed: boolean;
}

export interface Partner {
  id: string;
  name: string;
  kind: PartnerKind;
  document: string | null;
  phone: string | null;
  email: string | null;
  code: string;
  customerDiscountPct: number | null;
  commissionPct: number;
  notes: string | null;
  active: boolean;
  /** Caminho do portal do parceiro (/parceiro/<token>). */
  path: string;
  /** Mês escolhido na lista. */
  stats: PartnerMonth;
}

export const partnerCloseSchema = z.object({
  month: z.string().regex(/^\d{4}-\d{2}$/, 'Mês inválido'),
  /** Data de vencimento da conta a pagar. */
  dueDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Data inválida'),
});
export type PartnerCloseInput = z.infer<typeof partnerCloseSchema>;

/** Portal do parceiro (pelo link, sem login): só primeiro nome das clientes. */
export interface PartnerPortal {
  name: string;
  storeName: string;
  code: string;
  customerDiscountPct: number | null;
  commissionPct: number;
  /** Caminho do cadastro no app já com o código (o front monta a URL). */
  signupPath: string;
  months: PartnerMonth[];
  customers: Array<{ firstName: string; since: string; purchases: number }>;
  kits: Array<{ id: string; name: string; path: string }>;
}

// ------------------------------------------------------------ kits

export const kitSchema = z.object({
  name: z.string().trim().min(3, 'Dê um nome ao kit').max(80),
  description: z
    .string()
    .trim()
    .max(400)
    .nullish()
    .transform((v) => v || null),
  goal: z
    .enum(Object.keys(CUSTOMER_GOALS) as [CustomerGoal, ...CustomerGoal[]])
    .nullish()
    .transform((v) => v ?? null),
  partnerId: z.string().uuid().nullish().transform((v) => v ?? null),
  imageUrl: z
    .string()
    .trim()
    .nullish()
    .transform((v) => v || null)
    .refine((v) => v === null || /^https:\/\/\S+$/.test(v), 'A foto precisa ser um link https'),
  items: z
    .array(z.object({ productId: z.string().uuid(), quantity: z.preprocess((v) => parseNumber(v), z.number({ invalid_type_error: 'Quantidade inválida' }).positive('Quantidade maior que zero').max(1000)) }))
    .min(2, 'Um kit tem pelo menos 2 produtos')
    .max(20),
  active: z.boolean().default(true),
});
export type KitInput = z.infer<typeof kitSchema>;

export interface Kit {
  id: string;
  name: string;
  description: string | null;
  goal: CustomerGoal | null;
  partnerId: string | null;
  partnerName: string | null;
  imageUrl: string | null;
  active: boolean;
  items: Array<{ productId: string; name: string; quantity: number; price: number; memberPrice: number | null }>;
  /** Soma dos preços (normal e de membro). */
  total: number;
  memberTotal: number;
}

/** Kit no app: produtos prontos para pôr no carrinho. */
export interface ShopKit {
  id: string;
  name: string;
  description: string | null;
  goal: CustomerGoal | null;
  partnerName: string | null;
  imageUrl: string | null;
  items: Array<{ product: ShopProduct; quantity: number }>;
  total: number;
  memberTotal: number;
}
