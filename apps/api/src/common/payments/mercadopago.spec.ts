import { createHmac } from 'node:crypto';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { MercadoPagoProvider } from './mercadopago';

const SECRET = 'segredo-de-teste';
const sign = (id: string, requestId: string, ts: string) => createHmac('sha256', SECRET).update(`id:${id};request-id:${requestId};ts:${ts};`).digest('hex');

describe('Mercado Pago', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('aceita o aviso com assinatura válida e recusa o resto', () => {
    const mp = new MercadoPagoProvider('APP_USR-x', SECRET);
    const headers = { 'x-signature': `ts=1700000000,v1=${sign('123456', 'req-1', '1700000000')}`, 'x-request-id': 'req-1' };
    expect(mp.webhookPaymentId({ headers, query: { type: 'payment', 'data.id': '123456' }, body: {} })).toBe('123456');
    expect(mp.webhookPaymentId({ headers, query: { type: 'payment', 'data.id': '999' }, body: {} })).toBeNull();
    expect(mp.webhookPaymentId({ headers: { 'x-request-id': 'req-1' }, query: { type: 'payment', 'data.id': '123456' }, body: {} })).toBeNull();
    expect(mp.webhookPaymentId({ headers, query: { type: 'merchant_order', 'data.id': '123456' }, body: {} })).toBeNull();
  });

  it('sem segredo, aceita só o id (o status vem sempre da consulta)', () => {
    const mp = new MercadoPagoProvider('TEST-x', null);
    expect(mp.testMode).toBe(true);
    expect(mp.webhookPaymentId({ headers: {}, query: {}, body: { type: 'payment', data: { id: 42 } } })).toBe('42');
    expect(mp.webhookPaymentId({ headers: {}, query: { topic: 'payment', id: 'abc' }, body: {} })).toBeNull();
  });

  it('cria o Pix com referência, vencimento no fuso de Brasília e chave de idempotência', async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ id: 777, status: 'pending', transaction_amount: 50, external_reference: 'ref', point_of_interaction: { transaction_data: { qr_code: '000201abc', qr_code_base64: 'iVBOR' } } }), { status: 201 }));
    vi.stubGlobal('fetch', fetchMock);
    const mp = new MercadoPagoProvider('APP_USR-x', null);
    const r = await mp.createPix({ reference: 'ref', amount: 50, description: 'Pedido 1', payerEmail: 'a@b.com', payerName: 'Ana Maria Souza', expiresAt: new Date('2026-11-21T13:15:00Z'), notificationUrl: 'https://x/v1/payments/webhook/mercadopago' });
    expect(r).toEqual({ ref: '777', qrCode: '000201abc', qrImage: 'iVBOR' });
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('https://api.mercadopago.com/v1/payments');
    const body = JSON.parse(String(init.body));
    expect(body).toMatchObject({ transaction_amount: 50, payment_method_id: 'pix', external_reference: 'ref', date_of_expiration: '2026-11-21T10:15:00.000-03:00', payer: { email: 'a@b.com', first_name: 'Ana', last_name: 'Maria Souza' } });
    expect((init.headers as Record<string, string>)['x-idempotency-key']).toBe('ref');
  });

  it('traduz o status e trata erro do provedor', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ id: 1, status: 'approved', transaction_amount: 10.5, external_reference: 'r' }), { status: 200 })));
    const mp = new MercadoPagoProvider('APP_USR-x', null);
    expect(await mp.getPayment('1')).toEqual({ paymentId: '1', status: 'approved', amount: 10.5, reference: 'r' });
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ message: 'invalid token' }), { status: 401 })));
    await expect(mp.refund('1')).rejects.toThrow(/401/);
  });
});
