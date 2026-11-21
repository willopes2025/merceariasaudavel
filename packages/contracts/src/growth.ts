import { z } from 'zod';

/**
 * Recompra e relacionamento: quem está para repor um produto, quem sumiu e
 * quem faz aniversário. A equipe manda a mensagem pronta pelo WhatsApp (link)
 * e marca o contato, para ninguém receber duas vezes.
 */

export interface RepurchaseRow {
  customerId: string;
  customerName: string;
  phone: string | null;
  allowWhatsapp: boolean;
  isMember: boolean;
  cashbackBalance: number;
  productId: string;
  productName: string;
  /** Compras deste produto nos últimos 12 meses. */
  purchases: number;
  lastPurchase: string;
  /** Intervalo usado (da cliente, ou a duração do produto). */
  intervalDays: number;
  /** De onde veio o intervalo. */
  basis: 'cliente' | 'produto';
  dueDate: string;
  /** Positivo = atrasada; negativo = ainda vai vencer. */
  daysLate: number;
  lastContactAt: string | null;
}

export interface LapsedRow {
  customerId: string;
  customerName: string;
  phone: string | null;
  allowWhatsapp: boolean;
  isMember: boolean;
  cashbackBalance: number;
  purchases: number;
  totalSpent: number;
  lastPurchase: string;
  daysAway: number;
  lastContactAt: string | null;
}

export interface BirthdayRow {
  customerId: string;
  customerName: string;
  phone: string | null;
  allowWhatsapp: boolean;
  isMember: boolean;
  birthDate: string;
  /** Dia do aniversário neste mês. */
  day: number;
  lastContactAt: string | null;
}

export interface GrowthSummary {
  repurchaseDue: number;
  lapsed: number;
  birthdays: number;
  /** Cupom de aniversário ativo (para pôr na mensagem). */
  birthdayCoupon: { code: string; summary: string } | null;
  /** Endereço do app (para pôr na mensagem). */
  appUrl: string | null;
  messages: GrowthMessages;
}

export const CONTACT_KINDS = { recompra: 'Recompra', sumida: 'Cliente sumida', aniversario: 'Aniversário' } as const;
export type ContactKind = keyof typeof CONTACT_KINDS;

export const contactSchema = z.object({
  customerId: z.string().uuid(),
  productId: z.string().uuid().nullish(),
  kind: z.enum(['recompra', 'sumida', 'aniversario']),
});
export type ContactInput = z.infer<typeof contactSchema>;

/** Mensagens com {nome}, {produto}, {cashback}, {cupom}, {loja} e {app}. */
export const DEFAULT_MESSAGES = {
  repurchase: 'Oi, {nome}! Aqui é da {loja} 🌿 Pelas nossas contas o seu {produto} já deve estar acabando. Quer que a gente separe um para você? Membro paga o preço de membro e ainda ganha cashback.',
  lapsed: 'Oi, {nome}! Sentimos sua falta aqui na {loja} 🌿 Você tem {cashback} de cashback esperando para usar. Passa aqui ou peça pelo app: {app}',
  birthday: 'Feliz aniversário, {nome}! 🎉 A {loja} preparou um presente: use o cupom {cupom} na sua próxima compra este mês. Te esperamos!',
} as const;

export const growthMessagesSchema = z.object({
  repurchase: z.string().trim().max(600).nullish().transform((v) => v || null),
  lapsed: z.string().trim().max(600).nullish().transform((v) => v || null),
  birthday: z.string().trim().max(600).nullish().transform((v) => v || null),
});
export type GrowthMessagesInput = z.infer<typeof growthMessagesSchema>;
export interface GrowthMessages {
  repurchase: string;
  lapsed: string;
  birthday: string;
}

export function fillMessage(template: string, vars: Partial<Record<'nome' | 'produto' | 'cashback' | 'cupom' | 'loja' | 'app', string>>): string {
  return template.replace(/\{(nome|produto|cashback|cupom|loja|app)\}/g, (_, k: keyof typeof vars) => vars[k] ?? '').replace(/\s{2,}/g, ' ').trim();
}

/** Link do WhatsApp com a mensagem pronta (o telefone já vem com 55). */
export function whatsappLink(phone: string, text: string): string {
  return `https://wa.me/${phone.replace(/\D/g, '')}?text=${encodeURIComponent(text)}`;
}
