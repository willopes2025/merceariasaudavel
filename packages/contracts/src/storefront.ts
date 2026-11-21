import { z } from 'zod';

/**
 * Loja online: vitrine pública (/loja), origem das vendas (UTM dos anúncios)
 * e ids públicos de medição (Pixel do Meta e Google Analytics 4).
 */

const text = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .nullish()
    .transform((v) => v || null);

/** De onde a cliente veio (parâmetros utm_* do link, gclid/fbclid e a página de origem). */
export const originSchema = z
  .object({
    source: text(80),
    medium: text(80),
    campaign: text(120),
    content: text(120),
    term: text(120),
    gclid: text(200),
    fbclid: text(300),
    referrer: text(200),
    landing: text(200),
  })
  .nullish()
  .transform((o) => (o && Object.values(o).some(Boolean) ? o : null));
export type Origin = NonNullable<z.infer<typeof originSchema>>;

/** Origem resumida: anúncio do Google/Meta pelo clique, senão utm_source, senão o site que mandou. */
export function originSource(o: Origin | null | undefined): string {
  if (!o) return '(direto)';
  if (o.source) return o.source.toLowerCase();
  if (o.gclid) return 'google';
  if (o.fbclid) return 'facebook';
  if (o.referrer) {
    try {
      return new URL(o.referrer).hostname.replace(/^www\./, '');
    } catch {
      return o.referrer;
    }
  }
  return '(direto)';
}
export function originMedium(o: Origin | null | undefined): string {
  if (!o) return '';
  if (o.medium) return o.medium.toLowerCase();
  if (o.gclid || o.fbclid) return 'cpc';
  if (o.referrer) return 'referral';
  return '';
}

export const storefrontSettingsSchema = z.object({
  shopDescription: text(300),
  metaPixelId: z
    .string()
    .trim()
    .nullish()
    .transform((v) => v || null)
    .refine((v) => v === null || /^\d{6,20}$/.test(v), 'O ID do Pixel tem só números (15 ou 16 dígitos)'),
  ga4Id: z
    .string()
    .trim()
    .toUpperCase()
    .nullish()
    .transform((v) => v || null)
    .refine((v) => v === null || /^G-[A-Z0-9]{4,15}$/.test(v), 'O ID do Google Analytics começa com G- (ex.: G-ABC123XYZ)'),
});
export type StorefrontSettingsInput = z.infer<typeof storefrontSettingsSchema>;
export interface StorefrontSettings extends StorefrontSettingsInput {
  /** Endereço da loja online. */
  url: string;
}

export interface OriginRow {
  source: string;
  medium: string;
  campaign: string;
  orders: number;
  paidOrders: number;
  revenue: number;
  newCustomers: number;
}
export interface OriginReport {
  days: number;
  rows: OriginRow[];
  totals: { orders: number; paidOrders: number; revenue: number; newCustomers: number };
}

/** Links prontos para cada lugar de divulgação (utm_source / utm_medium). */
export const UTM_PRESETS = [
  { key: 'instagram-bio', label: 'Bio do Instagram', source: 'instagram', medium: 'bio' },
  { key: 'instagram-stories', label: 'Stories do Instagram', source: 'instagram', medium: 'stories' },
  { key: 'meta-ads', label: 'Anúncio no Instagram/Facebook', source: 'facebook', medium: 'cpc' },
  { key: 'google-ads', label: 'Anúncio no Google', source: 'google', medium: 'cpc' },
  { key: 'google-meu-negocio', label: 'Perfil da empresa no Google', source: 'google', medium: 'perfil' },
  { key: 'whatsapp', label: 'WhatsApp (status ou lista)', source: 'whatsapp', medium: 'mensagem' },
  { key: 'panfleto', label: 'Panfleto / QR na loja', source: 'panfleto', medium: 'qr' },
] as const;

export function slugify(s: string): string {
  return s
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60);
}

/** Endereço do produto na loja online. */
export const productPath = (p: { id: string; name: string }) => `/loja/p/${p.id}/${slugify(p.name) || 'produto'}`;
