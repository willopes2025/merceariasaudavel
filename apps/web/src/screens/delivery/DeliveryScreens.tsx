import { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  addressLine,
  courierSchema,
  deliveryZoneSchema,
  formatPhone,
  mapsLink,
  whatsappLink,
  type Courier,
  type DeliveryZone,
  type Order,
  type Store,
} from '@mercearia/contracts';
import { api, can, session } from '../../lib/api';
import { Empty, ErrorBox, Field, Loading, PageHeader } from '../../components/ui';
import { formatMoney } from '../../components/format';

// ------------------------------------------------------------------ painel de entregas

const minutes = (iso: string | null) => (iso ? Math.max(0, Math.floor((Date.now() - new Date(iso).getTime()) / 60_000)) : 0);

/** Entregas do dia: aguardando o caixa, no preparo, prontas para sair, em rota e entregues. */
export function DeliveriesScreen() {
  const client = useQueryClient();
  const stores = useQuery({ queryKey: ['stores'], queryFn: () => api<Store[]>('/stores') });
  const mine = (stores.data ?? []).filter((s) => s.active && (!session.user()?.storeIds.length || session.user()!.storeIds.includes(s.id)));
  const [storeId, setStoreId] = useState(() => localStorage.getItem('mercearia.pdv.store') ?? '');
  useEffect(() => {
    if (mine.length && !mine.some((s) => s.id === storeId)) setStoreId(mine[0]!.id);
  }, [mine, storeId]);
  const list = useQuery({ queryKey: ['deliveries', storeId], queryFn: () => api<Order[]>(`/orders/deliveries?storeId=${storeId}`), enabled: Boolean(storeId), refetchInterval: 10_000 });
  const couriers = useQuery({ queryKey: ['couriers'], queryFn: () => api<Courier[]>('/delivery/couriers') });
  const [chosen, setChosen] = useState<Record<string, string>>({});
  const refresh = () => client.invalidateQueries({ queryKey: ['deliveries'] });
  const dispatch = useMutation({ mutationFn: ({ id, courierId }: { id: string; courierId: string }) => api(`/orders/${id}/dispatch`, { method: 'POST', json: { courierId } }), onSuccess: refresh });
  const delivered = useMutation({ mutationFn: (id: string) => api(`/orders/${id}/advance`, { method: 'POST', json: { status: 'entregue' } }), onSuccess: refresh });
  const active = (couriers.data ?? []).filter((c) => c.active);
  const orders = list.data ?? [];
  const cols: Array<{ key: string; title: string; filter: (o: Order) => boolean }> = [
    { key: 'caixa', title: 'Aguardando o caixa', filter: (o) => o.status === 'aguardando_pagamento' },
    { key: 'preparo', title: 'No preparo', filter: (o) => o.status === 'na_fila' || o.status === 'preparando' },
    { key: 'pronto', title: 'Prontos para sair', filter: (o) => o.status === 'pronto' },
    { key: 'rota', title: 'Em rota', filter: (o) => o.status === 'saiu_entrega' },
  ];
  if (stores.isLoading) return <Loading />;
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-xl font-semibold">Entregas</h1>
        {mine.length > 1 && (
          <select className="input w-auto" value={storeId} onChange={(e) => setStoreId(e.target.value)} aria-label="Loja">
            {mine.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </select>
        )}
      </div>
      {!active.length && <p className="rounded-lg bg-amber-50 p-3 text-sm text-amber-800">Cadastre os entregadores em Configurações › Entrega para poder despachar.</p>}
      <ErrorBox error={list.error ?? dispatch.error ?? delivered.error} />
      <div className="grid gap-3 lg:grid-cols-4">
        {cols.map((c) => {
          const rows = orders.filter(c.filter);
          return (
            <section key={c.key} className="min-h-[40vh] rounded-2xl bg-slate-100 p-3">
              <h2 className="mb-3 flex justify-between font-semibold">
                {c.title}
                <span className="rounded-full bg-white px-2 text-sm">{rows.length}</span>
              </h2>
              <div className="space-y-3">
                {rows.map((o) => (
                  <article key={o.id} className="rounded-xl border border-slate-200 bg-white p-3 text-sm shadow-sm">
                    <div className="flex items-start justify-between gap-2">
                      <p className="text-2xl font-bold leading-none tabular-nums">{o.number}</p>
                      <span className="text-xs text-ink-soft">{o.status === 'saiu_entrega' ? `saiu há ${minutes(o.dispatchedAt)} min` : `há ${minutes(o.createdAt)} min`}</span>
                    </div>
                    <p className="mt-1 font-semibold">{o.customerName ?? o.callName}</p>
                    {o.address && (
                      <a href={mapsLink(o.address)} target="_blank" rel="noreferrer" className="block text-xs text-brand underline">
                        {addressLine(o.address)}
                      </a>
                    )}
                    {o.address?.reference && <p className="text-xs text-ink-soft">Ref.: {o.address.reference}</p>}
                    <p className="mt-1 text-xs">{o.items.map((i) => `${i.quantity}× ${i.description}`).join(', ')}</p>
                    <p className="mt-1 text-xs font-medium">
                      {formatMoney(o.estimate)} · {o.paymentNote}
                    </p>
                    {o.status === 'pronto' && (
                      <div className="mt-2 flex gap-2">
                        <select className="input py-1.5 text-sm" value={chosen[o.id] ?? active[0]?.id ?? ''} onChange={(e) => setChosen({ ...chosen, [o.id]: e.target.value })} aria-label="Entregador">
                          {active.map((x) => (
                            <option key={x.id} value={x.id}>
                              {x.name}
                              {x.onRoute ? ` (${x.onRoute} em rota)` : ''}
                            </option>
                          ))}
                        </select>
                        <button className="btn-primary px-3 py-1.5" disabled={!active.length || dispatch.isPending} onClick={() => dispatch.mutate({ id: o.id, courierId: chosen[o.id] ?? active[0]!.id })}>
                          Saiu
                        </button>
                      </div>
                    )}
                    {(o.status === 'na_fila' || o.status === 'preparando') && active.length > 0 && (
                      <button className="mt-2 text-xs text-ink-soft underline" onClick={() => dispatch.mutate({ id: o.id, courierId: chosen[o.id] ?? active[0]!.id })}>
                        Já saiu com {active.find((x) => x.id === (chosen[o.id] ?? active[0]!.id))?.name}
                      </button>
                    )}
                    {o.status === 'saiu_entrega' && (
                      <div className="mt-2 flex items-center justify-between">
                        <span className="text-xs">🛵 {o.courier?.name}</span>
                        <button className="btn-ghost px-3 py-1 text-xs" onClick={() => delivered.mutate(o.id)}>
                          Entregue
                        </button>
                      </div>
                    )}
                    {o.status === 'aguardando_pagamento' && <p className="mt-2 text-xs text-amber-700">Registre no caixa (Pedidos para cobrar) para ir ao preparo.</p>}
                  </article>
                ))}
                {!rows.length && <p className="py-6 text-center text-xs text-ink-soft">Nada aqui.</p>}
              </div>
            </section>
          );
        })}
      </div>
      {orders.some((o) => o.status === 'entregue') && (
        <p className="text-xs text-ink-soft">
          Entregues hoje:{' '}
          {orders
            .filter((o) => o.status === 'entregue')
            .map((o) => `${o.number} (${o.courier?.name ?? '—'})`)
            .join(' · ')}
        </p>
      )}
    </div>
  );
}

// ------------------------------------------------------------------ configuração

export function DeliverySettingsScreen() {
  const client = useQueryClient();
  const settings = useQuery({ queryKey: ['delivery-settings'], queryFn: () => api<{ deliveryEnabled: boolean; deliveryCity: string | null }>('/delivery/settings') });
  const zones = useQuery({ queryKey: ['delivery-zones'], queryFn: () => api<DeliveryZone[]>('/delivery/zones') });
  const couriers = useQuery({ queryKey: ['couriers'], queryFn: () => api<Courier[]>('/delivery/couriers') });
  const [city, setCity] = useState('');
  useEffect(() => setCity(settings.data?.deliveryCity ?? ''), [settings.data]);
  const saveSettings = useMutation({ mutationFn: (body: unknown) => api('/delivery/settings', { method: 'PUT', json: body }), onSuccess: () => client.invalidateQueries({ queryKey: ['delivery-settings'] }) });
  const editable = can('settings.manage');
  if (settings.isLoading) return <Loading />;
  const s = settings.data!;
  return (
    <div className="max-w-5xl space-y-4">
      <PageHeader title="Entrega" subtitle="Bairros atendidos, taxa e entregadores. A cliente pede pelo app, paga na entrega e o motoboy abre as entregas pelo link." />
      <section className="card space-y-3 p-4">
        <label className="flex items-center gap-2 font-medium">
          <input type="checkbox" disabled={!editable} checked={s.deliveryEnabled} onChange={(e) => saveSettings.mutate({ deliveryEnabled: e.target.checked, deliveryCity: city || null })} />
          Entrega pelo app ligada
        </label>
        <div className="flex flex-wrap items-end gap-2">
          <Field label="Cidade (vai no endereço do mapa)">
            <input className="input w-64" value={city} disabled={!editable} onChange={(e) => setCity(e.target.value)} placeholder="Natal - RN" />
          </Field>
          {editable && (
            <button className="btn-ghost" onClick={() => saveSettings.mutate({ deliveryEnabled: s.deliveryEnabled, deliveryCity: city || null })}>
              Salvar cidade
            </button>
          )}
        </div>
        <ErrorBox error={saveSettings.error} />
      </section>
      <ZonesCard zones={zones.data ?? []} editable={editable} onChanged={() => client.invalidateQueries({ queryKey: ['delivery-zones'] })} />
      <CouriersCard couriers={couriers.data ?? []} editable={editable} onChanged={(list) => client.setQueryData(['couriers'], list)} />
    </div>
  );
}

function ZonesCard({ zones, editable, onChanged }: { zones: DeliveryZone[]; editable: boolean; onChanged: () => void }) {
  const empty = { name: '', fee: '', minOrder: '', freeAbove: '', etaMinutes: '45', active: true };
  const [f, setF] = useState(empty);
  const [editing, setEditing] = useState<string | null>(null);
  const [error, setError] = useState<unknown>(null);
  const save = useMutation({
    mutationFn: (body: unknown) => (editing ? api(`/delivery/zones/${editing}`, { method: 'PUT', json: body }) : api('/delivery/zones', { method: 'POST', json: body })),
    onSuccess: () => {
      setF(empty);
      setEditing(null);
      onChanged();
    },
    onError: setError,
  });
  const submit = () => {
    const parsed = deliveryZoneSchema.safeParse(f);
    if (!parsed.success) return setError(parsed.error.issues[0]?.message);
    setError(null);
    save.mutate(parsed.data);
  };
  return (
    <section className="card overflow-x-auto">
      <h2 className="p-4 pb-2 font-semibold">Bairros atendidos</h2>
      {!zones.length ? (
        <Empty>Cadastre os bairros que a loja entrega.</Empty>
      ) : (
        <table className="table">
          <thead>
            <tr>
              <th>Bairro</th>
              <th className="text-right">Taxa</th>
              <th className="text-right">Mínimo</th>
              <th className="text-right">Grátis acima de</th>
              <th className="text-right">Prazo</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {zones.map((z) => (
              <tr key={z.id} className={z.active ? '' : 'opacity-50'}>
                <td className="font-medium">{z.name}</td>
                <td className="text-right">{formatMoney(z.fee)}</td>
                <td className="text-right">{z.minOrder ? formatMoney(z.minOrder) : '—'}</td>
                <td className="text-right">{z.freeAbove != null ? formatMoney(z.freeAbove) : '—'}</td>
                <td className="text-right">{z.etaMinutes} min</td>
                <td className="text-right">
                  {editable && (
                    <button className="text-sm text-brand" onClick={() => { setEditing(z.id); setF({ name: z.name, fee: String(z.fee).replace('.', ','), minOrder: z.minOrder ? String(z.minOrder).replace('.', ',') : '', freeAbove: z.freeAbove != null ? String(z.freeAbove).replace('.', ',') : '', etaMinutes: String(z.etaMinutes), active: z.active }); }}>
                      Editar
                    </button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      {editable && (
        <div className="grid items-end gap-2 border-t border-slate-100 p-4 sm:grid-cols-7">
          <Field label="Bairro">
            <input className="input" value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} />
          </Field>
          <Field label="Taxa (R$)">
            <input className="input" inputMode="decimal" value={f.fee} onChange={(e) => setF({ ...f, fee: e.target.value })} />
          </Field>
          <Field label="Mínimo (R$)">
            <input className="input" inputMode="decimal" value={f.minOrder} onChange={(e) => setF({ ...f, minOrder: e.target.value })} />
          </Field>
          <Field label="Grátis acima">
            <input className="input" inputMode="decimal" value={f.freeAbove} onChange={(e) => setF({ ...f, freeAbove: e.target.value })} />
          </Field>
          <Field label="Prazo (min)">
            <input className="input" inputMode="numeric" value={f.etaMinutes} onChange={(e) => setF({ ...f, etaMinutes: e.target.value })} />
          </Field>
          <label className="flex items-center gap-2 pb-2 text-sm">
            <input type="checkbox" checked={f.active} onChange={(e) => setF({ ...f, active: e.target.checked })} />
            Ativo
          </label>
          <button className="btn-primary" disabled={save.isPending} onClick={submit}>
            {editing ? 'Salvar' : 'Acrescentar'}
          </button>
          <div className="sm:col-span-7">
            <ErrorBox error={error} />
          </div>
        </div>
      )}
    </section>
  );
}

function CouriersCard({ couriers, editable, onChanged }: { couriers: Courier[]; editable: boolean; onChanged: (list: Courier[]) => void }) {
  const [f, setF] = useState({ name: '', phone: '' });
  const [error, setError] = useState<unknown>(null);
  const create = useMutation({ mutationFn: (body: unknown) => api<Courier[]>('/delivery/couriers', { method: 'POST', json: body }), onSuccess: (list) => { setF({ name: '', phone: '' }); onChanged(list); }, onError: setError });
  const update = useMutation({ mutationFn: (c: Courier) => api<Courier[]>(`/delivery/couriers/${c.id}`, { method: 'PUT', json: { name: c.name, phone: c.phone, active: !c.active } }), onSuccess: onChanged, onError: setError });
  const rotate = useMutation({ mutationFn: (id: string) => api<Courier[]>(`/delivery/couriers/${id}/rotate`, { method: 'POST' }), onSuccess: onChanged, onError: setError });
  const url = (c: Courier) => `${window.location.origin}${c.path}`;
  return (
    <section className="card p-4">
      <h2 className="mb-1 font-semibold">Entregadores</h2>
      <p className="mb-3 text-sm text-ink-soft">Cada um recebe um link: abre no celular, vê as entregas, o caminho no mapa e marca "entregue". Sem login.</p>
      <div className="space-y-2">
        {couriers.map((c) => (
          <div key={c.id} className={`flex flex-wrap items-center gap-2 rounded-lg border border-slate-200 p-3 text-sm ${c.active ? '' : 'opacity-50'}`}>
            <span className="flex-1 font-medium">
              {c.name}
              {c.phone && <span className="ml-2 font-normal text-ink-soft">{formatPhone(c.phone)}</span>}
              {c.onRoute > 0 && <span className="badge ml-2 bg-sky-100 text-sky-800">{c.onRoute} em rota</span>}
            </span>
            {c.phone && (
              <a className="btn-ghost px-3 py-1" href={whatsappLink(c.phone, `Seu link de entregas da loja: ${url(c)}`)} target="_blank" rel="noreferrer">
                Mandar link
              </a>
            )}
            <button className="btn-ghost px-3 py-1" onClick={() => navigator.clipboard?.writeText(url(c))}>
              Copiar link
            </button>
            {editable && (
              <>
                <button className="btn-ghost px-3 py-1" onClick={() => rotate.mutate(c.id)} title="O link antigo para de funcionar">
                  Link novo
                </button>
                <button className="text-xs text-ink-soft underline" onClick={() => update.mutate(c)}>
                  {c.active ? 'Desativar' : 'Ativar'}
                </button>
              </>
            )}
          </div>
        ))}
      </div>
      {editable && (
        <div className="mt-3 flex flex-wrap items-end gap-2">
          <Field label="Nome">
            <input className="input" value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} />
          </Field>
          <Field label="WhatsApp">
            <input className="input" inputMode="tel" value={f.phone} onChange={(e) => setF({ ...f, phone: e.target.value })} />
          </Field>
          <button
            className="btn-primary"
            disabled={create.isPending}
            onClick={() => {
              const parsed = courierSchema.safeParse(f);
              if (!parsed.success) return setError(parsed.error.issues[0]?.message);
              setError(null);
              create.mutate(parsed.data);
            }}
          >
            Acrescentar
          </button>
        </div>
      )}
      <ErrorBox error={error} />
    </section>
  );
}
