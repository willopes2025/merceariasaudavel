/** O que o sistema usa da API de pedidos do iFood (Merchant API). */
export interface IfoodEvent {
  id: string;
  /** PLC = novo pedido, CAN = cancelado, CON = concluído (há outros, que só são confirmados). */
  code: string;
  orderId: string;
}
export interface IfoodItem {
  name: string;
  quantity: number;
  /** Código do produto no cadastro da loja (o "código PDV" do cardápio do iFood). */
  externalCode?: string | null;
  totalPrice?: number;
  observations?: string | null;
  options?: Array<{ name: string; quantity?: number }>;
}
export interface IfoodOrderData {
  id: string;
  displayId?: string;
  /** DELIVERY | TAKEOUT | INDOOR */
  orderType?: string;
  customer?: { name?: string };
  items?: IfoodItem[];
  total?: { subTotal?: number; deliveryFee?: number; benefits?: number; orderAmount?: number };
  delivery?: { deliveredBy?: string; deliveryAddress?: { streetName?: string; streetNumber?: string; neighborhood?: string; complement?: string; reference?: string; formattedAddress?: string } };
  extraInfo?: string;
}
export type IfoodAction = 'confirm' | 'startPreparation' | 'readyToPickup' | 'dispatch';

export interface IfoodApi {
  kind: 'ifood' | 'teste';
  poll(): Promise<IfoodEvent[]>;
  ack(ids: string[]): Promise<void>;
  order(id: string): Promise<IfoodOrderData>;
  action(id: string, action: IfoodAction): Promise<void>;
}

const BASE = 'https://merchant-api.ifood.com.br';

/** Cliente da API do iFood: token por clientId/clientSecret (renovado sozinho) e as chamadas de pedido. */
export function ifoodApi(clientId: string, clientSecret: string, merchantId: string): IfoodApi {
  let token: { value: string; until: number } | null = null;
  const auth = async () => {
    if (token && token.until > Date.now() + 60_000) return token.value;
    const r = await fetch(`${BASE}/authentication/v1.0/oauth/token`, { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ grantType: 'client_credentials', clientId, clientSecret }), signal: AbortSignal.timeout(15_000) });
    if (!r.ok) throw new Error(`iFood recusou as chaves (${r.status}). Confira IFOOD_CLIENT_ID e IFOOD_CLIENT_SECRET.`);
    const j = (await r.json()) as { accessToken: string; expiresIn?: number };
    token = { value: j.accessToken, until: Date.now() + (j.expiresIn ?? 3600) * 1000 };
    return token.value;
  };
  const call = async (path: string, init: RequestInit = {}) => {
    const r = await fetch(BASE + path, { ...init, headers: { authorization: `Bearer ${await auth()}`, 'content-type': 'application/json', ...(init.headers as Record<string, string> | undefined) }, signal: AbortSignal.timeout(15_000) });
    if (r.status === 401) token = null;
    if (!r.ok) throw new Error(`iFood ${path.split('/').slice(-1)[0]}: ${r.status} ${(await r.text()).slice(0, 200)}`);
    return r;
  };
  return {
    kind: 'ifood',
    async poll() {
      const r = await call('/order/v1.0/events:polling', { headers: { 'x-polling-merchants': merchantId } });
      if (r.status === 204) return [];
      return ((await r.json()) as IfoodEvent[]) ?? [];
    },
    async ack(ids) {
      if (ids.length) await call('/order/v1.0/events/acknowledgment', { method: 'POST', body: JSON.stringify(ids.map((id) => ({ id }))) });
    },
    async order(id) {
      return (await (await call(`/order/v1.0/orders/${encodeURIComponent(id)}`)).json()) as IfoodOrderData;
    },
    async action(id, action) {
      await call(`/order/v1.0/orders/${encodeURIComponent(id)}/${action}`, { method: 'POST' });
    },
  };
}

/** Simulador para testes: os pedidos são colocados à mão e as ações ficam anotadas. */
export function ifoodTeste(): IfoodApi & { push(o: IfoodOrderData): void; cancel(id: string): void; actions: Array<{ id: string; action: IfoodAction }> } {
  let fila: IfoodEvent[] = [];
  const pedidos = new Map<string, IfoodOrderData>();
  const actions: Array<{ id: string; action: IfoodAction }> = [];
  let n = 0;
  return {
    kind: 'teste',
    actions,
    push(o) {
      pedidos.set(o.id, o);
      fila.push({ id: `ev${++n}`, code: 'PLC', orderId: o.id });
    },
    cancel(id) {
      fila.push({ id: `ev${++n}`, code: 'CAN', orderId: id });
    },
    async poll() {
      return [...fila];
    },
    async ack(ids) {
      fila = fila.filter((e) => !ids.includes(e.id));
    },
    async order(id) {
      const o = pedidos.get(id);
      if (!o) throw new Error('pedido não existe no simulador');
      return o;
    },
    async action(id, action) {
      actions.push({ id, action });
    },
  };
}
