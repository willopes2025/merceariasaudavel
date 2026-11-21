import { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useSearchParams } from 'react-router-dom';
import {
  PURCHASE_STATUS,
  formatPhone,
  purchaseOrderText,
  supplierSchema,
  whatsappLink,
  type Page,
  type Product,
  type PurchaseOrder,
  type PurchaseStatus,
  type Store,
  type Supplier,
} from '@mercearia/contracts';
import { api, can } from '../../lib/api';
import { Drawer, Empty, ErrorBox, Field, Loading, PageHeader } from '../../components/ui';
import { formatMoney, formatQty } from '../../components/format';

// ------------------------------------------------------------------ fornecedores

export function SuppliersScreen() {
  const client = useQueryClient();
  const list = useQuery({ queryKey: ['suppliers'], queryFn: () => api<Supplier[]>('/suppliers') });
  const [editing, setEditing] = useState<Supplier | 'new' | null>(null);
  return (
    <div className="max-w-5xl space-y-4">
      <PageHeader
        title="Fornecedores"
        subtitle="Prazo de entrega e WhatsApp de cada um: a compra sugerida e o pedido saem para eles. Fornecedor de nota de entrada entra sozinho."
        action={
          can('purchase.manage') && (
            <button className="btn-primary" onClick={() => setEditing('new')}>
              Novo fornecedor
            </button>
          )
        }
      />
      <div className="card overflow-x-auto">
        {list.isLoading ? (
          <Loading />
        ) : !list.data?.length ? (
          <Empty>Nenhum fornecedor ainda.</Empty>
        ) : (
          <table className="table">
            <thead>
              <tr>
                <th>Fornecedor</th>
                <th>Contato</th>
                <th className="text-right">Prazo</th>
                <th className="text-right">Pedido mínimo</th>
                <th className="text-right">Produtos</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {list.data.map((s) => (
                <tr key={s.id} className={s.active ? '' : 'opacity-50'}>
                  <td>
                    <p className="font-medium">{s.name}</p>
                    {s.document && <p className="text-xs text-ink-soft">{s.document}</p>}
                  </td>
                  <td className="text-sm">
                    {s.contactName && <p>{s.contactName}</p>}
                    {s.phone && <p className="text-ink-soft">{formatPhone(s.phone)}</p>}
                  </td>
                  <td className="text-right">{s.leadTimeDays} dias</td>
                  <td className="text-right">{s.minOrder ? formatMoney(s.minOrder) : '—'}</td>
                  <td className="text-right">{s.products}</td>
                  <td className="text-right">
                    {can('purchase.manage') && (
                      <button className="text-sm text-brand" onClick={() => setEditing(s)}>
                        Editar
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
      {editing && <SupplierForm supplier={editing === 'new' ? null : editing} onClose={() => setEditing(null)} onSaved={() => { setEditing(null); client.invalidateQueries({ queryKey: ['suppliers'] }); }} />}
    </div>
  );
}

function SupplierForm({ supplier, onClose, onSaved }: { supplier: Supplier | null; onClose: () => void; onSaved: () => void }) {
  const [f, setF] = useState({
    name: supplier?.name ?? '',
    document: supplier?.document ?? '',
    phone: supplier?.phone ? formatPhone(supplier.phone) : '',
    email: supplier?.email ?? '',
    contactName: supplier?.contactName ?? '',
    leadTimeDays: String(supplier?.leadTimeDays ?? 7),
    minOrder: supplier?.minOrder ? String(supplier.minOrder).replace('.', ',') : '',
    notes: supplier?.notes ?? '',
    active: supplier?.active ?? true,
  });
  const [error, setError] = useState<unknown>(null);
  const save = useMutation({ mutationFn: (body: unknown) => (supplier ? api(`/suppliers/${supplier.id}`, { method: 'PUT', json: body }) : api('/suppliers', { method: 'POST', json: body })), onSuccess: onSaved, onError: setError });
  return (
    <Drawer title={supplier ? 'Editar fornecedor' : 'Novo fornecedor'} onClose={onClose}>
      <form
        className="space-y-3"
        onSubmit={(e) => {
          e.preventDefault();
          const parsed = supplierSchema.safeParse(f);
          if (!parsed.success) return setError(parsed.error.issues[0]?.message);
          save.mutate(parsed.data);
        }}
      >
        <Field label="Nome">
          <input className="input" value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} />
        </Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="CNPJ/CPF">
            <input className="input" value={f.document} onChange={(e) => setF({ ...f, document: e.target.value })} />
          </Field>
          <Field label="Vendedor/contato">
            <input className="input" value={f.contactName} onChange={(e) => setF({ ...f, contactName: e.target.value })} />
          </Field>
          <Field label="WhatsApp">
            <input className="input" inputMode="tel" value={f.phone} onChange={(e) => setF({ ...f, phone: e.target.value })} />
          </Field>
          <Field label="E-mail">
            <input className="input" type="email" value={f.email} onChange={(e) => setF({ ...f, email: e.target.value })} />
          </Field>
          <Field label="Prazo de entrega (dias)" hint="Entre pedir e chegar.">
            <input className="input" inputMode="numeric" value={f.leadTimeDays} onChange={(e) => setF({ ...f, leadTimeDays: e.target.value })} />
          </Field>
          <Field label="Pedido mínimo (R$)">
            <input className="input" inputMode="decimal" value={f.minOrder} onChange={(e) => setF({ ...f, minOrder: e.target.value })} />
          </Field>
        </div>
        <Field label="Observações">
          <textarea className="input" value={f.notes} onChange={(e) => setF({ ...f, notes: e.target.value })} placeholder="Dia de visita do vendedor, condição de pagamento…" />
        </Field>
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" checked={f.active} onChange={(e) => setF({ ...f, active: e.target.checked })} />
          Ativo
        </label>
        <ErrorBox error={error} />
        <button className="btn-primary w-full" disabled={save.isPending}>
          Salvar
        </button>
      </form>
    </Drawer>
  );
}

// ------------------------------------------------------------------ pedidos de compra

const TONE: Record<PurchaseStatus, string> = {
  rascunho: 'bg-slate-100 text-ink-soft',
  enviado: 'bg-sky-100 text-sky-800',
  recebido: 'bg-brand-soft text-brand',
  cancelado: 'bg-slate-100 text-ink-soft line-through',
};

export function PurchaseOrdersScreen() {
  const client = useQueryClient();
  const [params, setParams] = useSearchParams();
  const [status, setStatus] = useState<PurchaseStatus | 'todos'>('todos');
  const list = useQuery({ queryKey: ['purchase-orders', status], queryFn: () => api<PurchaseOrder[]>(`/purchase-orders?status=${status}`) });
  const openId = params.get('pedido');
  const [creating, setCreating] = useState(false);
  const refresh = () => client.invalidateQueries({ queryKey: ['purchase-orders'] });
  return (
    <div className="max-w-6xl space-y-4">
      <PageHeader
        title="Pedidos de compra"
        subtitle="Monte o pedido (ou crie pela compra sugerida), mande pelo WhatsApp e dê entrada quando chegar."
        action={
          <button className="btn-primary" onClick={() => setCreating(true)}>
            Novo pedido
          </button>
        }
      />
      <div className="flex flex-wrap gap-2">
        {(['todos', 'rascunho', 'enviado', 'recebido', 'cancelado'] as const).map((s) => (
          <button key={s} onClick={() => setStatus(s)} className={`rounded-full border px-3 py-1 text-sm ${status === s ? 'border-brand bg-brand text-white' : 'border-slate-300 bg-white'}`}>
            {s === 'todos' ? 'Todos' : PURCHASE_STATUS[s]}
          </button>
        ))}
      </div>
      <div className="card overflow-x-auto">
        {list.isLoading ? (
          <Loading />
        ) : !list.data?.length ? (
          <Empty>Nenhum pedido. Em Inteligência de estoque, a compra sugerida vira pedido com um clique.</Empty>
        ) : (
          <table className="table">
            <thead>
              <tr>
                <th>Nº</th>
                <th>Fornecedor</th>
                <th>Itens</th>
                <th className="text-right">Total</th>
                <th>Situação</th>
                <th>Data</th>
              </tr>
            </thead>
            <tbody>
              {list.data.map((o) => (
                <tr key={o.id} className="cursor-pointer hover:bg-slate-50" onClick={() => setParams({ pedido: o.id })}>
                  <td className="font-semibold">{o.number}</td>
                  <td>{o.supplierName}</td>
                  <td className="text-sm text-ink-soft">{o.items.map((i) => i.name).slice(0, 3).join(', ')}{o.items.length > 3 ? ` +${o.items.length - 3}` : ''}</td>
                  <td className="text-right tabular-nums">{formatMoney(o.total)}</td>
                  <td>
                    <span className={`badge ${TONE[o.status]}`}>{PURCHASE_STATUS[o.status]}</span>
                  </td>
                  <td className="text-sm">{new Date(o.createdAt).toLocaleDateString('pt-BR')}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
      {openId && <OrderDrawer id={openId} onClose={() => setParams({})} onChanged={refresh} />}
      {creating && <OrderForm order={null} onClose={() => setCreating(false)} onSaved={(o) => { setCreating(false); refresh(); setParams({ pedido: o.id }); }} />}
    </div>
  );
}

function OrderDrawer({ id, onClose, onChanged }: { id: string; onClose: () => void; onChanged: () => void }) {
  const client = useQueryClient();
  const order = useQuery({ queryKey: ['purchase-order', id], queryFn: () => api<PurchaseOrder>(`/purchase-orders/${id}`) });
  const stores = useQuery({ queryKey: ['stores'], queryFn: () => api<Store[]>('/stores') });
  const [editing, setEditing] = useState(false);
  const [addStock, setAddStock] = useState(true);
  const status = useMutation({
    mutationFn: (body: { status: 'enviado' | 'recebido' | 'cancelado'; addStock?: boolean }) => api<PurchaseOrder>(`/purchase-orders/${id}/status`, { method: 'POST', json: body }),
    onSuccess: (o) => {
      client.setQueryData(['purchase-order', id], o);
      onChanged();
    },
  });
  if (order.isLoading) return null;
  const o = order.data;
  if (!o) return null;
  if (editing) return <OrderForm order={o} onClose={() => setEditing(false)} onSaved={(saved) => { client.setQueryData(['purchase-order', id], saved); setEditing(false); onChanged(); }} />;
  const storeName = stores.data?.find((s) => s.id === o.storeId)?.name ?? 'Mercearia Saudável';
  const text = purchaseOrderText(o, storeName);
  return (
    <Drawer title={`Pedido de compra nº ${o.number}`} onClose={onClose} wide>
      <div className="space-y-4 text-sm">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <p className="font-semibold">{o.supplierName}</p>
            <p className="text-ink-soft">
              Criado em {new Date(o.createdAt).toLocaleDateString('pt-BR')}
              {o.createdByName ? ` por ${o.createdByName}` : ''}
              {o.expectedOn ? ` · precisa para ${o.expectedOn.split('-').reverse().join('/')}` : ''}
            </p>
          </div>
          <span className={`badge ${TONE[o.status]}`}>{PURCHASE_STATUS[o.status]}</span>
        </div>
        <table className="table">
          <thead>
            <tr>
              <th>Produto</th>
              <th className="text-right">Qtd.</th>
              <th className="text-right">Custo un.</th>
              <th className="text-right">Total</th>
            </tr>
          </thead>
          <tbody>
            {o.items.map((i) => (
              <tr key={i.productId}>
                <td>{i.name}</td>
                <td className="text-right tabular-nums">{formatQty(i.quantity, i.unit)}</td>
                <td className="text-right tabular-nums">{formatMoney(i.unitCost)}</td>
                <td className="text-right tabular-nums">{formatMoney(i.total)}</td>
              </tr>
            ))}
            <tr>
              <td className="font-semibold">Total</td>
              <td />
              <td />
              <td className="text-right font-semibold tabular-nums">{formatMoney(o.total)}</td>
            </tr>
          </tbody>
        </table>
        {o.notes && <p className="text-ink-soft">Obs.: {o.notes}</p>}
        <ErrorBox error={status.error} />
        {o.status === 'rascunho' && (
          <div className="flex flex-wrap gap-2">
            {o.supplierPhone ? (
              <button
                className="btn-primary"
                onClick={() => {
                  window.open(whatsappLink(o.supplierPhone!, text), '_blank', 'noopener');
                  status.mutate({ status: 'enviado' });
                }}
              >
                Enviar pelo WhatsApp
              </button>
            ) : (
              <span className="self-center text-xs text-ink-soft">Cadastre o WhatsApp do fornecedor para enviar direto.</span>
            )}
            <button className="btn-ghost" onClick={() => navigator.clipboard?.writeText(text)}>
              Copiar texto
            </button>
            <button className="btn-ghost" onClick={() => status.mutate({ status: 'enviado' })}>
              Marcar como enviado
            </button>
            <button className="btn-ghost" onClick={() => setEditing(true)}>
              Editar
            </button>
            <button className="text-xs text-red-600" onClick={() => status.mutate({ status: 'cancelado' })}>
              Cancelar pedido
            </button>
          </div>
        )}
        {o.status === 'enviado' && (
          <div className="space-y-2 rounded-lg border border-slate-200 p-3">
            <p className="font-medium">Chegou?</p>
            <label className="flex items-start gap-2">
              <input type="checkbox" className="mt-1" checked={addStock} onChange={(e) => setAddStock(e.target.checked)} />
              <span>Dar entrada no estoque com as quantidades e custos do pedido. Desmarque se vai dar entrada pela nota (XML) em Produtos.</span>
            </label>
            <div className="flex gap-2">
              <button className="btn-primary" disabled={status.isPending} onClick={() => status.mutate({ status: 'recebido', addStock })}>
                Recebido
              </button>
              <button className="text-xs text-red-600" onClick={() => status.mutate({ status: 'cancelado' })}>
                Cancelar pedido
              </button>
            </div>
          </div>
        )}
      </div>
    </Drawer>
  );
}

function OrderForm({ order, onClose, onSaved }: { order: PurchaseOrder | null; onClose: () => void; onSaved: (o: PurchaseOrder) => void }) {
  const stores = useQuery({ queryKey: ['stores'], queryFn: () => api<Store[]>('/stores') });
  const suppliers = useQuery({ queryKey: ['suppliers'], queryFn: () => api<Supplier[]>('/suppliers') });
  const [storeId, setStoreId] = useState(order?.storeId ?? localStorage.getItem('mercearia.pdv.store') ?? '');
  const [supplierId, setSupplierId] = useState(order?.supplierId ?? '');
  const [items, setItems] = useState(order?.items.map((i) => ({ productId: i.productId, name: i.name, unit: i.unit, quantity: String(i.quantity).replace('.', ','), unitCost: String(i.unitCost).replace('.', ',') })) ?? []);
  const [notes, setNotes] = useState(order?.notes ?? '');
  const [expectedOn, setExpectedOn] = useState(order?.expectedOn ?? '');
  const [q, setQ] = useState('');
  useEffect(() => {
    const active = (stores.data ?? []).filter((s) => s.active);
    if (active.length && !active.some((s) => s.id === storeId)) setStoreId(active[0]!.id);
  }, [stores.data, storeId]);
  const found = useQuery({ queryKey: ['po-product-search', q], queryFn: () => api<Page<Product>>(`/products?q=${encodeURIComponent(q)}&pageSize=10`), enabled: q.trim().length >= 2 });
  const save = useMutation({
    mutationFn: () => {
      const body = { storeId, supplierId, items: items.map((i) => ({ productId: i.productId, quantity: i.quantity, unitCost: i.unitCost })), notes: notes || null, expectedOn: expectedOn || null };
      return order ? api<PurchaseOrder>(`/purchase-orders/${order.id}`, { method: 'PUT', json: body }) : api<PurchaseOrder>('/purchase-orders', { method: 'POST', json: body });
    },
    onSuccess: onSaved,
  });
  return (
    <Drawer title={order ? `Editar pedido nº ${order.number}` : 'Novo pedido de compra'} onClose={onClose} wide>
      <div className="space-y-3">
        <div className="grid gap-3 sm:grid-cols-3">
          <Field label="Fornecedor">
            <select className="input" value={supplierId} onChange={(e) => setSupplierId(e.target.value)}>
              <option value="">Escolha</option>
              {(suppliers.data ?? []).filter((s) => s.active).map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Loja">
            <select className="input" value={storeId} onChange={(e) => setStoreId(e.target.value)}>
              {(stores.data ?? []).filter((s) => s.active).map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Precisa para">
            <input className="input" type="date" value={expectedOn} onChange={(e) => setExpectedOn(e.target.value)} />
          </Field>
        </div>
        {items.map((i, n) => (
          <div key={i.productId} className="flex items-center gap-2 text-sm">
            <span className="flex-1">{i.name}</span>
            <input className="input w-24 text-right" inputMode="decimal" value={i.quantity} onChange={(e) => setItems((xs) => xs.map((x, k) => (k === n ? { ...x, quantity: e.target.value } : x)))} aria-label="Quantidade" />
            <span className="w-8 text-xs text-ink-soft">{i.unit.toLowerCase()}</span>
            <input className="input w-28 text-right" inputMode="decimal" value={i.unitCost} onChange={(e) => setItems((xs) => xs.map((x, k) => (k === n ? { ...x, unitCost: e.target.value } : x)))} aria-label="Custo unitário" placeholder="custo" />
            <button className="text-xs text-red-600" onClick={() => setItems((xs) => xs.filter((_, k) => k !== n))}>
              Tirar
            </button>
          </div>
        ))}
        <input className="input" placeholder="Buscar produto para acrescentar" value={q} onChange={(e) => setQ(e.target.value)} />
        {found.data?.items
          .filter((p) => p.kind !== 'preparado' && !items.some((i) => i.productId === p.id))
          .map((p) => (
            <button key={p.id} className="block w-full rounded px-2 py-1 text-left text-sm hover:bg-slate-50" onClick={() => { setItems((xs) => [...xs, { productId: p.id, name: p.name, unit: p.unit, quantity: String(p.packSize ?? 1).replace('.', ','), unitCost: String(p.cost).replace('.', ',') }]); setQ(''); }}>
              + {p.name} <span className="text-xs text-ink-soft">(custo {formatMoney(p.cost)})</span>
            </button>
          ))}
        <Field label="Observações">
          <input className="input" value={notes} onChange={(e) => setNotes(e.target.value)} />
        </Field>
        <ErrorBox error={save.error} />
        <div className="flex justify-end gap-2">
          <button className="btn-ghost" onClick={onClose}>
            Cancelar
          </button>
          <button className="btn-primary" disabled={save.isPending || !supplierId || !items.length} onClick={() => save.mutate()}>
            Salvar rascunho
          </button>
        </div>
      </div>
    </Drawer>
  );
}
