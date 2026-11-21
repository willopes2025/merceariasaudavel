import { z } from 'zod';
import { normalizePhone } from './br';
import { saleLineSchema, type ChosenOption } from './sales';
import type { ProductKind, Unit } from './products';

/**
 * Pedido (Fase 2b). Nasce no app (cliente logada), no totem ou no balcão.
 * App e totem pagam no caixa: o caixa puxa o pedido para o PDV e cobra. Pago,
 * o pedido entra na fila da tela de preparo: na fila → preparando → pronto →
 * entregue. Venda no balcão com shake/sorvete já entra paga na fila.
 */

export const ORDER_STATUS = {
  aguardando_pagamento: 'Pagar no caixa',
  na_fila: 'Na fila',
  preparando: 'Preparando',
  pronto: 'Pronto para retirar',
  entregue: 'Entregue',
  cancelado: 'Cancelado',
} as const;
export type OrderStatus = keyof typeof ORDER_STATUS;

export const ORDER_CHANNELS = { app: 'App', totem: 'Totem', balcao: 'Balcão' } as const;
export type OrderChannel = keyof typeof ORDER_CHANNELS;

/** Andar com o pedido na tela de preparo. */
export const ORDER_NEXT: Partial<Record<OrderStatus, OrderStatus>> = {
  na_fila: 'preparando',
  preparando: 'pronto',
  pronto: 'entregue',
};

const items = z.array(saleLineSchema).min(1, 'Escolha pelo menos um produto').max(30, 'Pedido grande demais: no máximo 30 itens');
const notes = z
  .string()
  .trim()
  .max(200)
  .nullish()
  .transform((v) => v || null);

/** Pedido da cliente logada no app. */
export const shopOrderSchema = z.object({ items, notes });
export type ShopOrderInput = z.infer<typeof shopOrderSchema>;

/** Pedido no totem: sem login; nome para chamar e, se for membro, o celular ou o código do cartão. */
export const totemOrderSchema = z.object({
  items,
  notes,
  callName: z.string().trim().min(2, 'Digite seu nome para a gente chamar').max(30),
  member: z
    .string()
    .trim()
    .max(20)
    .nullish()
    .transform((v) => v || null),
});
export type TotemOrderInput = z.infer<typeof totemOrderSchema>;

/** Celular (com DDD) ou código do cartão de membro digitado no totem. */
export function memberLookupKey(v: string): { phone: string } | { code: string } | null {
  const code = v.toUpperCase().replace(/\s/g, '');
  if (/^[A-Z2-9]{6}$/.test(code) && /[A-Z]/.test(code)) return { code };
  const phone = normalizePhone(v);
  return phone ? { phone } : null;
}

export const orderAdvanceSchema = z.object({
  status: z.enum(['preparando', 'pronto', 'entregue']),
});
export type OrderAdvanceInput = z.infer<typeof orderAdvanceSchema>;

export const orderCancelSchema = z.object({
  reason: z.string().trim().min(3, 'Diga o motivo').max(200),
});
export type OrderCancelInput = z.infer<typeof orderCancelSchema>;

export interface OrderItem {
  productId: string;
  description: string;
  kind: ProductKind;
  unit: Unit;
  quantity: number;
  options: ChosenOption[];
}

export interface Order {
  id: string;
  number: number;
  storeId: string;
  channel: OrderChannel;
  status: OrderStatus;
  callName: string;
  customerId: string | null;
  customerName: string | null;
  items: OrderItem[];
  /** Valor estimado no pedido (o caixa recalcula ao cobrar). */
  estimate: number;
  notes: string | null;
  saleId: string | null;
  saleNumber: number | null;
  createdAt: string;
  paidAt: string | null;
  startedAt: string | null;
  readyAt: string | null;
  deliveredAt: string | null;
  canceledAt: string | null;
  cancelReason: string | null;
}

/** Painel de retirada (TV/tela pública): só número e primeiro nome. */
export interface PickupBoard {
  preparing: Array<{ number: number; callName: string }>;
  ready: Array<{ number: number; callName: string }>;
}

/** Itens para o caixa carregar o pedido no PDV. */
export function orderToLines(order: Pick<Order, 'items'>) {
  return order.items.map((i) => ({ productId: i.productId, quantity: i.quantity, options: i.options.map((o) => o.id) }));
}
