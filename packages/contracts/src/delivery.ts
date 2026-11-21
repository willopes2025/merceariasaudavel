import { z } from 'zod';
import { normalizePhone } from './br';
import { parseNumber } from './products';

/**
 * Entrega: bairros atendidos (taxa, mínimo, prazo, grátis acima de), endereço
 * da cliente e entregadores (cada um abre as entregas por um link).
 */

const money = z.preprocess((v) => (v === '' || v == null ? 0 : parseNumber(v)), z.number({ invalid_type_error: 'Valor inválido' }).min(0).max(100_000));
const optionalMoney = z.preprocess((v) => (v === '' || v == null ? null : parseNumber(v)), z.number({ invalid_type_error: 'Valor inválido' }).min(0).max(100_000).nullable());
const text = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .nullish()
    .transform((v) => v || null);

export const deliveryZoneSchema = z.object({
  name: z.string().trim().min(2, 'Informe o bairro').max(80),
  fee: money.default(0),
  minOrder: money.default(0),
  freeAbove: optionalMoney.default(null),
  etaMinutes: z.coerce.number().int().min(5, 'Prazo mínimo 5 min').max(600).default(45),
  active: z.boolean().default(true),
});
export type DeliveryZoneInput = z.infer<typeof deliveryZoneSchema>;

export interface DeliveryZone {
  id: string;
  name: string;
  fee: number;
  minOrder: number;
  freeAbove: number | null;
  etaMinutes: number;
  active: boolean;
}

/** Taxa para um valor de compra (grátis acima do limite do bairro). */
export function zoneFee(zone: Pick<DeliveryZone, 'fee' | 'freeAbove'>, subtotal: number): number {
  return zone.freeAbove != null && subtotal >= zone.freeAbove ? 0 : zone.fee;
}

export const deliverySettingsSchema = z.object({
  deliveryEnabled: z.boolean(),
  deliveryCity: text(80),
});
export type DeliverySettingsInput = z.infer<typeof deliverySettingsSchema>;

export const addressSchema = z.object({
  label: text(30),
  street: z.string().trim().min(3, 'Informe a rua').max(120),
  number: z.string().trim().min(1, 'Informe o número (ou s/n)').max(15),
  complement: text(60),
  zoneId: z.string().uuid('Escolha o bairro'),
  reference: text(120),
});
export type AddressInput = z.infer<typeof addressSchema>;

export interface CustomerAddress extends Omit<AddressInput, 'zoneId'> {
  id: string;
  zoneId: string;
  zoneName: string;
}

/** Endereço gravado no pedido. */
export interface DeliveryAddress {
  street: string;
  number: string;
  complement: string | null;
  neighborhood: string;
  reference: string | null;
  city: string | null;
}

export function addressLine(a: DeliveryAddress): string {
  return `${a.street}, ${a.number}${a.complement ? ` (${a.complement})` : ''} — ${a.neighborhood}${a.city ? `, ${a.city}` : ''}`;
}

/** Link do Google Maps para o endereço (rota a partir de onde o entregador está). */
export function mapsLink(a: DeliveryAddress): string {
  const q = `${a.street}, ${a.number} - ${a.neighborhood}${a.city ? `, ${a.city}` : ''}`;
  return `https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(q)}`;
}

export const courierSchema = z.object({
  name: z.string().trim().min(2, 'Informe o nome').max(80),
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
  active: z.boolean().default(true),
});
export type CourierInput = z.infer<typeof courierSchema>;

export interface Courier {
  id: string;
  name: string;
  phone: string | null;
  active: boolean;
  /** Caminho da página do entregador (/entregador/<token>). */
  path: string;
  /** Entregas em rota agora. */
  onRoute: number;
}

export const dispatchSchema = z.object({ courierId: z.string().uuid('Escolha o entregador') });
export type DispatchInput = z.infer<typeof dispatchSchema>;

export const PAY_ON_DELIVERY = { pix: 'Pix', cartao: 'Cartão (maquininha)', dinheiro: 'Dinheiro' } as const;
export type PayOnDelivery = keyof typeof PAY_ON_DELIVERY;

/** O que o entregador vê pelo link. */
export interface CourierRun {
  courierName: string;
  storeName: string;
  orders: Array<{
    id: string;
    number: number;
    status: 'saiu_entrega' | 'entregue';
    customerName: string;
    phone: string | null;
    address: DeliveryAddress;
    mapsUrl: string;
    /** Quanto cobrar na entrega (0 = já pago). */
    toCollect: number;
    paymentNote: string | null;
    items: string[];
    notes: string | null;
    dispatchedAt: string | null;
    deliveredAt: string | null;
  }>;
}
