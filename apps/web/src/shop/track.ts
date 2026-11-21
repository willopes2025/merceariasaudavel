import type { Origin } from '@mercearia/contracts';

/**
 * Origem das vendas e medição dos anúncios.
 * - Guarda de onde a cliente veio (utm_*, gclid, fbclid ou o site que mandou) por 30 dias
 *   e manda junto no cadastro e no pedido.
 * - Pixel do Meta e Google Analytics só carregam depois do "Aceitar" dos cookies (LGPD).
 */
const ORIGIN_KEY = 'mercearia.origem';
const CONSENT_KEY = 'mercearia.cookies';
const DAYS_30 = 30 * 86_400_000;

const read = (k: string) => {
  try {
    return localStorage.getItem(k);
  } catch {
    return null;
  }
};
const write = (k: string, v: string) => {
  try {
    localStorage.setItem(k, v);
  } catch {
    /* sem armazenamento */
  }
};
const cut = (v: string | null, n: number) => (v ? v.slice(0, n) : null);

/** Lê a origem do endereço atual (último clique vale: anúncio novo substitui o antigo). */
export function captureOrigin(): void {
  const p = new URLSearchParams(window.location.search);
  const utm = { source: p.get('utm_source'), medium: p.get('utm_medium'), campaign: p.get('utm_campaign'), content: p.get('utm_content'), term: p.get('utm_term'), gclid: p.get('gclid'), fbclid: p.get('fbclid') };
  const hasAd = Object.values(utm).some(Boolean);
  let referrer: string | null = null;
  try {
    if (document.referrer && new URL(document.referrer).host !== window.location.host) referrer = document.referrer;
  } catch {
    referrer = null;
  }
  if (!hasAd && (!referrer || currentOrigin())) return;
  const origin: Origin = {
    source: cut(utm.source, 80),
    medium: cut(utm.medium, 80),
    campaign: cut(utm.campaign, 120),
    content: cut(utm.content, 120),
    term: cut(utm.term, 120),
    gclid: cut(utm.gclid, 200),
    fbclid: cut(utm.fbclid, 300),
    referrer: cut(referrer, 200),
    landing: cut(window.location.pathname, 200),
  };
  write(ORIGIN_KEY, JSON.stringify({ ...origin, at: Date.now() }));
}

export function currentOrigin(): Origin | null {
  try {
    const raw = read(ORIGIN_KEY);
    if (!raw) return null;
    const { at, ...o } = JSON.parse(raw) as Origin & { at: number };
    return Date.now() - at < DAYS_30 ? o : null;
  } catch {
    return null;
  }
}

export type Consent = 'sim' | 'nao' | null;
export const consent = (): Consent => (read(CONSENT_KEY) as Consent) ?? null;
export function setConsent(v: 'sim' | 'nao', ids: Tracking): void {
  write(CONSENT_KEY, v);
  if (v === 'sim') initTracking(ids);
}

export interface Tracking {
  metaPixelId: string | null;
  ga4Id: string | null;
}

type Fbq = ((...args: unknown[]) => void) & { queue?: unknown[]; loaded?: boolean; version?: string; callMethod?: (...a: unknown[]) => void; push?: unknown };
declare global {
  interface Window {
    fbq?: Fbq;
    _fbq?: Fbq;
    dataLayer?: unknown[];
    gtag?: (...args: unknown[]) => void;
  }
}

let loaded = false;
/** Carrega Pixel e GA4 (só com o aceite). */
export function initTracking(ids: Tracking): void {
  if (loaded || consent() !== 'sim' || (!ids.metaPixelId && !ids.ga4Id)) return;
  loaded = true;
  if (ids.metaPixelId && /^\d{6,20}$/.test(ids.metaPixelId)) {
    const fbq: Fbq = function (...args: unknown[]) {
      if (fbq.callMethod) fbq.callMethod(...args);
      else fbq.queue!.push(args);
    } as Fbq;
    fbq.queue = [];
    fbq.loaded = true;
    fbq.version = '2.0';
    window.fbq = fbq;
    window._fbq = fbq;
    const s = document.createElement('script');
    s.async = true;
    s.src = 'https://connect.facebook.net/en_US/fbevents.js';
    document.head.appendChild(s);
    fbq('init', ids.metaPixelId);
    fbq('track', 'PageView');
  }
  if (ids.ga4Id && /^G-[A-Z0-9]{4,15}$/.test(ids.ga4Id)) {
    const s = document.createElement('script');
    s.async = true;
    s.src = `https://www.googletagmanager.com/gtag/js?id=${ids.ga4Id}`;
    document.head.appendChild(s);
    window.dataLayer = window.dataLayer ?? [];
    window.gtag = function (...args: unknown[]) {
      // O gtag oficial empurra o objeto "arguments".
      // eslint-disable-next-line prefer-rest-params
      window.dataLayer!.push(arguments);
      void args;
    };
    window.gtag('js', new Date());
    window.gtag('config', ids.ga4Id);
  }
}

type EventName = 'ViewContent' | 'AddToCart' | 'InitiateCheckout' | 'CompleteRegistration' | 'Purchase';
const GA: Record<EventName, string> = { ViewContent: 'view_item', AddToCart: 'add_to_cart', InitiateCheckout: 'begin_checkout', CompleteRegistration: 'sign_up', Purchase: 'purchase' };

/** Evento de conversão (vai para o Pixel e o GA4, se estiverem carregados). */
export function track(name: EventName, data: { value?: number; ids?: string[]; name?: string; orderId?: string } = {}): void {
  if (!loaded) return;
  if (name === 'Purchase' && data.orderId) {
    const key = `mercearia.compra.${data.orderId}`;
    if (read(key)) return;
    write(key, '1');
  }
  const value = data.value != null ? Math.round(data.value * 100) / 100 : undefined;
  window.fbq?.('track', name, { value, currency: 'BRL', content_ids: data.ids, content_name: data.name, content_type: data.ids ? 'product' : undefined });
  window.gtag?.('event', GA[name], { value, currency: 'BRL', transaction_id: data.orderId, items: data.ids?.map((id) => ({ item_id: id })) });
}
