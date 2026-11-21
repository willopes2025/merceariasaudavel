import { z } from 'zod';
import { isValidCpf, normalizePhone, onlyDigits } from './br';
import { CUSTOMER_GOALS, type CustomerGoal } from './customers';
import type { OptionGroupView, Unit } from './products';

/**
 * App do cliente (Fase 2a). Ser membro = ter o app: o cliente se cadastra com
 * nome, celular e um PIN de 6 dígitos e passa a pagar o preço de membro e a
 * juntar cashback. O caixa acha o membro pelo celular, CPF ou código do cartão.
 */

export const PIN_RULE = /^\d{6}$/;

/** PIN fácil de adivinhar: todos iguais ou sequência. */
export function weakPin(pin: string): boolean {
  if (/^(\d)\1{5}$/.test(pin)) return true;
  const seq = '0123456789012345';
  const rev = '9876543210987654';
  return seq.includes(pin) || rev.includes(pin);
}

const pin = z
  .string()
  .trim()
  .refine((v) => PIN_RULE.test(v), 'O PIN tem 6 números')
  .refine((v) => !weakPin(v), 'PIN fácil demais: evite 123456, 111111…');

const phone = z.string().transform((v, ctx) => {
  const n = normalizePhone(v);
  if (!n) {
    ctx.addIssue({ code: 'custom', message: 'Celular inválido: use DDD + número' });
    return z.NEVER;
  }
  return n;
});

export const shopSignupSchema = z.object({
  name: z.string().trim().min(2, 'Informe seu nome').max(160),
  phone,
  /** Opcional. Obrigatório quando o celular já tem cadastro na loja (prova que é a mesma pessoa). */
  document: z
    .string()
    .optional()
    .nullable()
    .transform((v) => onlyDigits(v) || null)
    .refine((v) => v === null || (v.length === 11 && isValidCpf(v)), 'CPF inválido'),
  pin,
  goal: z
    .enum(Object.keys(CUSTOMER_GOALS) as [CustomerGoal, ...CustomerGoal[]])
    .optional()
    .nullable()
    .transform((v) => v ?? null),
  allowWhatsapp: z.boolean().default(true),
  birthDate: z
    .string()
    .nullish()
    .transform((v) => v || null)
    .refine((v) => v === null || (/^\d{4}-\d{2}-\d{2}$/.test(v) && v >= '1900-01-01' && Date.parse(v) <= Date.now()), 'Data de nascimento inválida'),
  acceptTerms: z.literal(true, { errorMap: () => ({ message: 'Aceite as regras do clube para continuar' }) }),
});
export type ShopSignupInput = z.infer<typeof shopSignupSchema>;
export type ShopSignupForm = z.input<typeof shopSignupSchema>;

export const shopLoginSchema = z.object({
  phone,
  pin: z.string().trim().regex(PIN_RULE, 'O PIN tem 6 números'),
});
export type ShopLoginInput = z.infer<typeof shopLoginSchema>;

export const shopPinSchema = z.object({
  /** PIN atual. Dispensado quando a pessoa entrou com o código do balcão. */
  current: z.string().trim().optional().nullable(),
  pin,
});
export type ShopPinInput = z.infer<typeof shopPinSchema>;

export const shopProfileSchema = z.object({
  name: z.string().trim().min(2, 'Informe seu nome').max(160),
  email: z
    .string()
    .trim()
    .toLowerCase()
    .optional()
    .nullable()
    .transform((v) => (v ? v : null))
    .refine((v) => v === null || z.string().email().safeParse(v).success, 'E-mail inválido'),
  goal: z
    .enum(Object.keys(CUSTOMER_GOALS) as [CustomerGoal, ...CustomerGoal[]])
    .optional()
    .nullable()
    .transform((v) => v ?? null),
  allowWhatsapp: z.boolean(),
  birthDate: z
    .string()
    .nullish()
    .transform((v) => v || null)
    .refine((v) => v === null || (/^\d{4}-\d{2}-\d{2}$/.test(v) && v >= '1900-01-01' && Date.parse(v) <= Date.now()), 'Data de nascimento inválida'),
});
export type ShopProfileInput = z.infer<typeof shopProfileSchema>;

/** Dados públicos da loja para o app e o cardápio. */
export interface ShopInfo {
  slug: string;
  name: string;
  storeName: string;
  phone: string | null;
  address: string | null;
  club: { cashbackPct: number; cashbackDays: number; cashbackMaxUsePct: number };
  /** App e totem aceitam pedido (paga no caixa). */
  ordersEnabled: boolean;
  /** Campanhas rodando (ofertas e cashback turbinado; cupom não aparece). */
  campaigns: Array<{ id: string; name: string; type: 'cashback' | 'oferta'; description: string | null; until: string; membersOnly: boolean; extraCashbackPct: number | null }>;
}

/** "Hora de repor": produto que a cliente costuma comprar e deve estar acabando. */
export interface ShopRepurchase {
  product: ShopProduct;
  lastPurchase: string;
  dueDate: string;
}

export interface ShopProduct {
  id: string;
  name: string;
  brand: string | null;
  categoryId: string | null;
  description: string | null;
  imageUrl: string | null;
  unit: Unit;
  soldByWeight: boolean;
  price: number;
  /** Preço de membro; igual ao preço quando não há desconto. */
  memberPrice: number;
  /** Tem no estoque (preparados sempre têm). */
  available: boolean;
  /** Montagem (sabor, adicionais) para pedir pelo app/totem. */
  optionGroups: OptionGroupView[];
  /** Oferta rodando agora (preço promocional). */
  offer: { name: string; price: number; membersOnly: boolean; until: string } | null;
}

export interface ShopCatalog {
  categories: { id: string; name: string }[];
  products: ShopProduct[];
}

export interface ShopLoginResult {
  token: string;
  /** Entrou com o código do balcão: precisa criar o próprio PIN antes de seguir. */
  mustChangePin: boolean;
}

export interface ShopMe {
  id: string;
  name: string;
  phone: string;
  email: string | null;
  goal: CustomerGoal | null;
  allowWhatsapp: boolean;
  birthDate: string | null;
  memberCode: string;
  memberSince: string | null;
  cashbackBalance: number;
  /** Cashback que vence nos próximos 30 dias. */
  expiringSoon: { amount: number; date: string } | null;
  /** Quanto já economizou com o preço de membro. */
  totalSavings: number;
  purchases: number;
  mustChangePin: boolean;
}

export interface ShopCashbackEntry {
  id: string;
  createdAt: string;
  kind: string;
  amount: number;
  description: string;
  expiresAt: string | null;
}

export interface ShopPurchase {
  id: string;
  number: number;
  createdAt: string;
  total: number;
  memberSavings: number;
  cashbackUsed: number;
  cashbackEarned: number;
  status: string;
  items: { name: string; quantity: number; unit: string; total: number }[];
}

/** Código provisório que o balcão entrega ao cliente (mostrado uma vez). */
export interface AppAccessCode {
  code: string;
  phone: string;
}

/** Alfabeto do cartão de membro: sem 0/O, 1/I/L para não confundir no balcão. */
export const MEMBER_CODE_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
export const MEMBER_CODE_RULE = /^[A-Z2-9]{6}$/;
