import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  CUSTOMER_GOALS,
  PARTNER_KINDS,
  formatPhone,
  kitSchema,
  partnerSchema,
  todayBR,
  whatsappLink,
  type CustomerGoal,
  type Kit,
  type Page,
  type Partner,
  type PartnerKind,
  type Product,
} from '@mercearia/contracts';
import { api, can } from '../../lib/api';
import { Drawer, Empty, ErrorBox, Field, Loading, PageHeader } from '../../components/ui';
import { formatMoney } from '../../components/format';

const monthLabel = (m: string) => {
  const [y, mm] = m.split('-');
  return `${['jan', 'fev', 'mar', 'abr', 'mai', 'jun', 'jul', 'ago', 'set', 'out', 'nov', 'dez'][Number(mm) - 1]}/${y}`;
};
const lastMonths = (n: number) => {
  const now = todayBR();
  return Array.from({ length: n }, (_, i) => new Date(Date.UTC(Number(now.slice(0, 4)), Number(now.slice(5, 7)) - 1 - i, 1)).toISOString().slice(0, 7));
};
const pctText = (v: number) => `${String(v).replace('.', ',')}%`;

// ------------------------------------------------------------------ parceiros

export function PartnersScreen() {
  const client = useQueryClient();
  const months = lastMonths(12);
  const [month, setMonth] = useState(months[0]!);
  const list = useQuery({ queryKey: ['partners', month], queryFn: () => api<Partner[]>(`/partners?month=${month}`) });
  const [editing, setEditing] = useState<Partner | 'new' | null>(null);
  const [closing, setClosing] = useState<Partner | null>(null);
  const refresh = () => client.invalidateQueries({ queryKey: ['partners'] });
  const rotate = useMutation({ mutationFn: (id: string) => api(`/partners/${id}/rotate`, { method: 'POST' }), onSuccess: refresh });
  const rows = list.data ?? [];
  const totals = rows.reduce((t, p) => ({ sales: t.sales + p.stats.sales, revenue: t.revenue + p.stats.revenue, commission: t.commission + p.stats.commission }), { sales: 0, revenue: 0, commission: 0 });
  const isCurrent = month === months[0];
  const url = (p: Partner) => `${window.location.origin}${p.path}`;
  return (
    <div className="space-y-4">
      <PageHeader
        title="Parceiros"
        subtitle="Nutricionistas, personais e influenciadores: cada um tem um código. A cliente ganha desconto, o parceiro ganha comissão de tudo que ela comprar."
        action={
          <button className="btn-primary" onClick={() => setEditing('new')}>
            Novo parceiro
          </button>
        }
      />
      <div className="flex flex-wrap items-center gap-3">
        <select className="input w-auto" value={month} onChange={(e) => setMonth(e.target.value)} aria-label="Mês">
          {months.map((m) => (
            <option key={m} value={m}>
              {monthLabel(m)}
            </option>
          ))}
        </select>
        <span className="text-sm text-ink-soft">
          {totals.sales} {totals.sales === 1 ? "venda" : "vendas"} · {formatMoney(totals.revenue)} vendidos · <b>{formatMoney(totals.commission)}</b> de comissão
        </span>
      </div>
      <ErrorBox error={list.error ?? rotate.error} />
      {list.isLoading ? (
        <Loading />
      ) : !rows.length ? (
        <Empty>Cadastre o primeiro parceiro. Ele recebe um link com as clientes indicadas e a comissão do mês.</Empty>
      ) : (
        <div className="card overflow-x-auto">
          <table className="table">
            <thead>
              <tr>
                <th>Parceiro</th>
                <th>Código</th>
                <th className="text-right">Desconto / comissão</th>
                <th className="text-right">Clientes</th>
                <th className="text-right">Vendas</th>
                <th className="text-right">Vendido</th>
                <th className="text-right">Comissão</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {rows.map((p) => (
                <tr key={p.id} className={p.active ? '' : 'opacity-50'}>
                  <td>
                    <p className="font-medium">{p.name}</p>
                    <p className="text-xs text-ink-soft">
                      {PARTNER_KINDS[p.kind]}
                      {p.phone && ` · ${formatPhone(p.phone)}`}
                    </p>
                  </td>
                  <td className="font-mono font-semibold">{p.code}</td>
                  <td className="text-right">
                    {p.customerDiscountPct ? pctText(p.customerDiscountPct) : '—'} / {pctText(p.commissionPct)}
                  </td>
                  <td className="text-right">
                    {p.stats.customers}
                    {p.stats.newCustomers > 0 && <span className="ml-1 text-xs text-emerald-700">+{p.stats.newCustomers}</span>}
                  </td>
                  <td className="text-right">{p.stats.sales}</td>
                  <td className="text-right">{formatMoney(p.stats.revenue)}</td>
                  <td className="text-right font-semibold">
                    {formatMoney(p.stats.commission)}
                    {p.stats.closed && <span className="badge ml-2 bg-emerald-100 text-emerald-800">fechado</span>}
                  </td>
                  <td className="whitespace-nowrap text-right text-sm">
                    <div className="flex justify-end gap-2">
                      {p.phone && (
                        <a className="text-brand" href={whatsappLink(p.phone, `Olá, ${p.name.split(' ')[0]}! Seu painel de parceiro: ${url(p)}`)} target="_blank" rel="noreferrer">
                          Mandar link
                        </a>
                      )}
                      <button className="text-brand" onClick={() => navigator.clipboard?.writeText(url(p))}>
                        Copiar link
                      </button>
                      <button className="text-brand" onClick={() => setEditing(p)}>
                        Editar
                      </button>
                      {!isCurrent && !p.stats.closed && can('finance.manage') && (
                        <button className="font-medium text-brand" onClick={() => setClosing(p)}>
                          Fechar mês
                        </button>
                      )}
                      <button className="text-xs text-ink-soft underline" title="O link antigo para de funcionar" onClick={() => rotate.mutate(p.id)}>
                        Link novo
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <p className="text-sm text-ink-soft">
        Como funciona: a cliente digita o código no caixa (ou no app) ou se cadastra pelo link do parceiro. A partir daí ela fica ligada a ele e toda compra dela gera comissão, sobre o valor pago em produtos (sem taxa de entrega). A cliente ligada ao parceiro ganha o desconto dele em toda compra, menos quando usa um cupom de campanha (não acumula).
        Depois que o mês termina, "Fechar mês" lança a comissão em Contas a pagar.
      </p>
      {editing && <PartnerDrawer partner={editing === 'new' ? null : editing} onClose={() => setEditing(null)} onSaved={() => { setEditing(null); refresh(); }} />}
      {closing && <CloseDrawer partner={closing} month={month} onClose={() => setClosing(null)} onDone={() => { setClosing(null); refresh(); }} />}
    </div>
  );
}

function PartnerDrawer({ partner, onClose, onSaved }: { partner: Partner | null; onClose: () => void; onSaved: () => void }) {
  const [f, setF] = useState({
    name: partner?.name ?? '',
    kind: (partner?.kind ?? 'nutricionista') as PartnerKind,
    document: partner?.document ?? '',
    phone: partner?.phone ? formatPhone(partner.phone) : '',
    email: partner?.email ?? '',
    code: partner?.code ?? '',
    customerDiscountPct: partner?.customerDiscountPct != null ? String(partner.customerDiscountPct).replace('.', ',') : '10',
    commissionPct: partner ? String(partner.commissionPct).replace('.', ',') : '10',
    notes: partner?.notes ?? '',
    active: partner?.active ?? true,
  });
  const [error, setError] = useState<unknown>(null);
  const save = useMutation({ mutationFn: (body: unknown) => (partner ? api(`/partners/${partner.id}`, { method: 'PUT', json: body }) : api('/partners', { method: 'POST', json: body })), onSuccess: onSaved, onError: setError });
  const set = <K extends keyof typeof f>(k: K, v: (typeof f)[K]) => setF((x) => ({ ...x, [k]: v }));
  return (
    <Drawer title={partner ? 'Editar parceiro' : 'Novo parceiro'} onClose={onClose}>
      <div className="space-y-3">
        <Field label="Nome">
          <input className="input" value={f.name} onChange={(e) => set('name', e.target.value)} />
        </Field>
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Tipo">
            <select className="input" value={f.kind} onChange={(e) => set('kind', e.target.value as PartnerKind)}>
              {Object.entries(PARTNER_KINDS).map(([k, v]) => (
                <option key={k} value={k}>
                  {v}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Código" hint="A cliente digita no caixa ou no app. Ex.: NUTRIANA">
            <input className="input font-mono uppercase" value={f.code} onChange={(e) => set('code', e.target.value.toUpperCase())} />
          </Field>
          <Field label="Desconto para a cliente (%)" hint="Vazio = sem desconto, só indicação">
            <input className="input" inputMode="decimal" value={f.customerDiscountPct} onChange={(e) => set('customerDiscountPct', e.target.value)} />
          </Field>
          <Field label="Comissão do parceiro (%)">
            <input className="input" inputMode="decimal" value={f.commissionPct} onChange={(e) => set('commissionPct', e.target.value)} />
          </Field>
          <Field label="WhatsApp">
            <input className="input" inputMode="tel" value={f.phone} onChange={(e) => set('phone', e.target.value)} />
          </Field>
          <Field label="E-mail">
            <input className="input" type="email" value={f.email} onChange={(e) => set('email', e.target.value)} />
          </Field>
          <Field label="CPF ou CNPJ" hint="Para pagar a comissão">
            <input className="input" inputMode="numeric" value={f.document} onChange={(e) => set('document', e.target.value)} />
          </Field>
          <label className="flex items-center gap-2 pt-6 text-sm">
            <input type="checkbox" checked={f.active} onChange={(e) => set('active', e.target.checked)} />
            Ativo
          </label>
        </div>
        <Field label="Observações (chave Pix, combinado etc.)">
          <textarea className="input" rows={2} value={f.notes} onChange={(e) => set('notes', e.target.value)} />
        </Field>
        <ErrorBox error={error} />
        <button
          className="btn-primary w-full"
          disabled={save.isPending}
          onClick={() => {
            const parsed = partnerSchema.safeParse(f);
            if (!parsed.success) return setError(parsed.error.issues[0]?.message);
            setError(null);
            save.mutate(parsed.data);
          }}
        >
          Salvar
        </button>
      </div>
    </Drawer>
  );
}

function CloseDrawer({ partner, month, onClose, onDone }: { partner: Partner; month: string; onClose: () => void; onDone: () => void }) {
  const [dueDate, setDueDate] = useState(() => {
    const t = todayBR();
    return `${t.slice(0, 8)}${Number(t.slice(8)) <= 10 ? '10' : t.slice(8)}`;
  });
  const close = useMutation({ mutationFn: () => api(`/partners/${partner.id}/close`, { method: 'POST', json: { month, dueDate } }), onSuccess: onDone });
  return (
    <Drawer title={`Fechar ${monthLabel(month)} · ${partner.name}`} onClose={onClose}>
      <div className="space-y-3 text-sm">
        <p>
          {partner.stats.sales} vendas, {formatMoney(partner.stats.revenue)} em produtos. Comissão de <b>{formatMoney(partner.stats.commission)}</b>.
        </p>
        {partner.stats.commission > 0 ? <p>Vai virar uma conta a pagar na categoria "Salários e comissões".</p> : <p>Sem comissão no mês: o fechamento só registra o mês como fechado.</p>}
        <Field label="Vencimento">
          <input className="input" type="date" value={dueDate} onChange={(e) => setDueDate(e.target.value)} />
        </Field>
        <ErrorBox error={close.error} />
        <button className="btn-primary w-full" disabled={close.isPending} onClick={() => close.mutate()}>
          Fechar mês
        </button>
      </div>
    </Drawer>
  );
}

// ------------------------------------------------------------------ kits

export function KitsScreen() {
  const client = useQueryClient();
  const list = useQuery({ queryKey: ['kits'], queryFn: () => api<Kit[]>('/kits') });
  const [editing, setEditing] = useState<Kit | 'new' | null>(null);
  return (
    <div className="space-y-4">
      <PageHeader
        title="Kits"
        subtitle="Monte cestas por objetivo (emagrecer, ganhar massa…) ou receitadas por um parceiro. Aparecem no app e a cliente põe tudo no carrinho com um toque."
        action={
          <button className="btn-primary" onClick={() => setEditing('new')}>
            Novo kit
          </button>
        }
      />
      <ErrorBox error={list.error} />
      {list.isLoading ? (
        <Loading />
      ) : !list.data?.length ? (
        <Empty>Nenhum kit ainda.</Empty>
      ) : (
        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
          {list.data.map((k) => (
            <article key={k.id} className={`card p-4 ${k.active ? '' : 'opacity-50'}`}>
              <div className="flex items-start justify-between gap-2">
                <div>
                  <h2 className="font-semibold">{k.name}</h2>
                  <p className="text-xs text-ink-soft">
                    {k.goal ? CUSTOMER_GOALS[k.goal] : 'Sem objetivo'}
                    {k.partnerName && ` · indicado por ${k.partnerName}`}
                  </p>
                </div>
                <button className="text-sm text-brand" onClick={() => setEditing(k)}>
                  Editar
                </button>
              </div>
              <ul className="mt-2 space-y-0.5 text-sm">
                {k.items.map((i) => (
                  <li key={i.productId}>
                    {String(i.quantity).replace('.', ',')}× {i.name}
                  </li>
                ))}
              </ul>
              <p className="mt-2 text-sm">
                {formatMoney(k.total)}
                {k.memberTotal < k.total && <span className="ml-2 font-semibold text-emerald-700">{formatMoney(k.memberTotal)} para membro</span>}
              </p>
            </article>
          ))}
        </div>
      )}
      {editing && <KitDrawer kit={editing === 'new' ? null : editing} onClose={() => setEditing(null)} onSaved={() => { setEditing(null); void client.invalidateQueries({ queryKey: ['kits'] }); }} />}
    </div>
  );
}

function KitDrawer({ kit, onClose, onSaved }: { kit: Kit | null; onClose: () => void; onSaved: () => void }) {
  const partners = useQuery({ queryKey: ['partners', 'all'], queryFn: () => api<Partner[]>('/partners') });
  const [f, setF] = useState({
    name: kit?.name ?? '',
    description: kit?.description ?? '',
    goal: (kit?.goal ?? '') as CustomerGoal | '',
    partnerId: kit?.partnerId ?? '',
    imageUrl: kit?.imageUrl ?? '',
    active: kit?.active ?? true,
    items: kit?.items.map((i) => ({ productId: i.productId, name: i.name, quantity: String(i.quantity).replace('.', ',') })) ?? [],
  });
  const [q, setQ] = useState('');
  const found = useQuery({ queryKey: ['kit-product-search', q], queryFn: () => api<Page<Product>>(`/products?q=${encodeURIComponent(q)}&pageSize=10`), enabled: q.trim().length >= 2 });
  const [error, setError] = useState<unknown>(null);
  const save = useMutation({ mutationFn: (body: unknown) => (kit ? api(`/kits/${kit.id}`, { method: 'PUT', json: body }) : api('/kits', { method: 'POST', json: body })), onSuccess: onSaved, onError: setError });
  const options = (found.data?.items ?? []).filter((p) => p.kind !== 'insumo' && !f.items.some((i) => i.productId === p.id));
  return (
    <Drawer title={kit ? 'Editar kit' : 'Novo kit'} onClose={onClose}>
      <div className="space-y-3">
        <Field label="Nome">
          <input className="input" value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} placeholder="Kit Secar 30 dias" />
        </Field>
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Objetivo">
            <select className="input" value={f.goal} onChange={(e) => setF({ ...f, goal: e.target.value as CustomerGoal | '' })}>
              <option value="">—</option>
              {Object.entries(CUSTOMER_GOALS).map(([k, v]) => (
                <option key={k} value={k}>
                  {v}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Parceiro que indica">
            <select className="input" value={f.partnerId} onChange={(e) => setF({ ...f, partnerId: e.target.value })}>
              <option value="">—</option>
              {(partners.data ?? []).map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </select>
          </Field>
        </div>
        <Field label="Descrição">
          <textarea className="input" rows={2} value={f.description} onChange={(e) => setF({ ...f, description: e.target.value })} />
        </Field>
        <Field label="Foto (link https, opcional)">
          <input className="input" value={f.imageUrl} onChange={(e) => setF({ ...f, imageUrl: e.target.value })} />
        </Field>
        <div>
          <p className="mb-1 text-sm font-medium">Produtos</p>
          <div className="space-y-2">
            {f.items.map((i, n) => (
              <div key={i.productId} className="flex items-center gap-2 text-sm">
                <input className="input w-20" inputMode="decimal" aria-label="Quantidade" value={i.quantity} onChange={(e) => setF({ ...f, items: f.items.map((x, m) => (m === n ? { ...x, quantity: e.target.value } : x)) })} />
                <span className="flex-1">{i.name}</span>
                <button className="text-xs text-red-600" onClick={() => setF({ ...f, items: f.items.filter((_, m) => m !== n) })}>
                  Tirar
                </button>
              </div>
            ))}
          </div>
          <input className="input mt-2" placeholder="Buscar produto para acrescentar…" value={q} onChange={(e) => setQ(e.target.value)} />
          {q.trim().length >= 2 && (
            <div className="mt-1 max-h-48 overflow-auto rounded-lg border border-slate-200">
              {options.map((p) => (
                <button key={p.id} className="block w-full px-3 py-2 text-left text-sm hover:bg-slate-50" onClick={() => { setF({ ...f, items: [...f.items, { productId: p.id, name: p.name, quantity: '1' }] }); setQ(''); }}>
                  {p.name} <span className="text-ink-soft">{formatMoney(p.price)}</span>
                </button>
              ))}
              {!found.isLoading && !options.length && <p className="px-3 py-2 text-sm text-ink-soft">Nada encontrado.</p>}
            </div>
          )}
        </div>
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" checked={f.active} onChange={(e) => setF({ ...f, active: e.target.checked })} />
          Ativo (aparece no app)
        </label>
        <ErrorBox error={error} />
        <button
          className="btn-primary w-full"
          disabled={save.isPending}
          onClick={() => {
            const parsed = kitSchema.safeParse({ ...f, goal: f.goal || null, partnerId: f.partnerId || null, items: f.items.map((i) => ({ productId: i.productId, quantity: i.quantity })) });
            if (!parsed.success) return setError(parsed.error.issues[0]?.message);
            setError(null);
            save.mutate(parsed.data);
          }}
        >
          Salvar kit
        </button>
      </div>
    </Drawer>
  );
}
