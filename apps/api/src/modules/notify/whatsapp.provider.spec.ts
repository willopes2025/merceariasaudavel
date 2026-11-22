import { createHmac } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { metaProvider, metaSignatureOk, phoneVariants, zapiProvider } from './whatsapp.provider';

describe('provedores de WhatsApp', () => {
  it('Z-API: lê texto e mídia e ignora grupo', () => {
    const z = zapiProvider('i', 't', 'c');
    expect(z.parse({ type: 'ReceivedCallback', phone: '5527999998888', senderName: 'Ana', messageId: 'm1', fromMe: false, text: { message: 'oi' } }).messages).toEqual([{ externalId: 'm1', phone: '5527999998888', name: 'Ana', text: 'oi', media: null, fromMe: false }]);
    expect(z.parse({ type: 'ReceivedCallback', phone: '5527999998888', messageId: 'm2', audio: { audioUrl: 'x' } }).messages[0]!.media).toBe('audio');
    expect(z.parse({ type: 'ReceivedCallback', phone: '1203@g.us', isGroup: true, text: { message: 'oi' } }).messages).toEqual([]);
    expect(z.parse({ type: 'MessageStatusCallback' }).messages).toEqual([]);
  });
  it('Meta: mensagens, nome do contato e falhas de entrega', () => {
    const m = metaProvider('t', 'p');
    const body = { entry: [{ changes: [{ value: { contacts: [{ wa_id: '5527999998888', profile: { name: 'Bia' } }], messages: [{ from: '5527999998888', id: 'w1', type: 'text', text: { body: 'tem whey?' } }], statuses: [{ id: 'w0', status: 'failed', errors: [{ title: 'Re-engagement message' }] }] } }] }] };
    const r = m.parse(body);
    expect(r.messages[0]).toMatchObject({ externalId: 'w1', name: 'Bia', text: 'tem whey?' });
    expect(r.statuses).toEqual([{ externalId: 'w0', failed: true, error: 'Re-engagement message' }]);
  });
  it('assinatura da Meta', () => {
    const raw = Buffer.from('{"a":1}');
    const sig = `sha256=${createHmac('sha256', 'segredo').update(raw).digest('hex')}`;
    expect(metaSignatureOk('segredo', raw, sig)).toBe(true);
    expect(metaSignatureOk('outro', raw, sig)).toBe(false);
    expect(metaSignatureOk('segredo', raw, undefined)).toBe(false);
  });
  it('variações do celular (com e sem o 9)', () => {
    expect(phoneVariants('552799998888')).toEqual(expect.arrayContaining(['552799998888', '5527999998888']));
    expect(phoneVariants('27999998888')).toEqual(expect.arrayContaining(['5527999998888', '552799998888']));
  });
});
