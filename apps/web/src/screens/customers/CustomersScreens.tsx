import { useEffect, useState, type FormEvent } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link, useNavigate, useParams } from 'react-router-dom';
import {
  CASHBACK_ENTRY_TYPES,
  CUSTOMER_GOALS,
  customerSchema,
  formatCpf,
  formatPhone,
  type CashbackEntry,
  type Customer,
  type CustomerForm,
  type CustomerRow,
  type Page,
  type SaleRow,
  type TimelineItem,
} from '@mercearia/contracts';
import { api, can } from '../../lib/api';
import { Drawer, Empty, ErrorBox, Field, Loading, PageHeader } from '../../components/ui';
import { formatDateTime, formatDay, formatMoney } from '../../components/format';

export function CustomersScreen() {
  const navigate = useNavigate();
  const [q, setQ] = useState('');
  const [debounced, setDebounced] = useState('');
  const [members, setMembers] = useState('all');
  const [birthMonth, setBirthMonth] = useState('');
  const [page, setPage] = useState(1);
  const [creating, setCreating] = useState(false);
  useEffect(() => {
    const t = setTimeout(() => setDebounced(q.trim()), 300);
    return () => clearTimeout(t);
  }, [q]);
  useEffect(() => setPage(1), [debounced, members, birthMonth]);
  const params = new URLSearchParams({ members, page: String(page), pageSize: '50' });
  if (debounced) params.set('q', debounced);
  if (birthMonth) params.set('birthMonth', birthMonth);
  const list = useQuery({ queryKey: ['customers', params.toString()], queryFn: () => api<Page<CustomerRow>>(`/customers?${params}`) });
  const pages = list.data ? Math.max(1, Math.ceil(list.data.total / list.data.pageSize)) : 1;
  return (
    <div className="max-w-6xl">
      <PageHeader title="Clientes e membros" subtitle="Membro do clube paga o preço de membro e junta cashback. Para entrar basta nome e celular." action={can('customer.manage') && <button className="btn-primary" onClick={() => setCreating(true)}>Nova cliente</button>} />
      <div className="mb-4 flex flex-wrap gap-2">
        <input className="input max-w-xs" placeholder="Nome, celular ou CPF" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Buscar" />
        <select className="input w-auto" value={members} onChange={(e) => setMembers(e.target.value)} aria-label="Clube">
          <option value="all">Todas</option>
          <option value="members">Membros do clube</option>
          <option value="non_members">Ainda não são membros</option>
        </select>
        <select className="input w-auto" value={birthMonth} onChange={(e) => setBirthMonth(e.target.value)} aria-label="Aniversário">
          <option value="">Aniversário: qualquer mês</option>
          {Array.from({ length: 12 }, (_, i) => (
            <option key={i} value={i + 1}>
              Aniversário em {new Date(2026, i, 1).toLocaleDateString('pt-BR', { month: 'long' })}
            </option>
          ))}
        </select>
        {list.data && <span className="self-center text-sm text-ink-soft">{list.data.total} clientes</span>}
      </div>
      <ErrorBox error={list.error} />
      <div className="card overflow-x-auto">
        {list.isLoading ? (
          <Loading />
        ) : !list.data?.items.length ? (
          <Empty>Nenhuma cliente encontrada.</Empty>
        ) : (
          <table className="table">
            <thead>
              <tr>
                <th>Nome</th>
                <th>Celular</th>
                <th>Objetivo</th>
                <th>Clube</th>
                <th className="text-right">Cashback</th>
              </tr>
            </thead>
            <tbody>
              {list.data.items.map((c) => (
                <tr key={c.id} className="cursor-pointer hover:bg-slate-50" onClick={() => navigate(`/clientes/${c.id}`)}>
                  <td className="font-medium">{c.name}</td>
                  <td>{formatPhone(c.phone)}</td>
                  <td>{c.goal ? CUSTOMER_GOALS[c.goal] : '—'}</td>
                  <td>{c.isMember ? <span className="badge bg-brand-soft text-brand">Membro</span> : '—'}</td>
                  <td className="text-right tabular-nums">{c.cashbackBalance ? formatMoney(c.cashbackBalance) : '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
      {pages > 1 && (
        <div className="mt-3 flex justify-end gap-2 text-sm">
          <button className="btn-ghost" disabled={page <= 1} onClick={() => setPage(page - 1)}>
            Anterior
          </button>
          <span className="self-center">
            {page} de {pages}
          </span>
          <button className="btn-ghost" disabled={page >= pages} onClick={() => setPage(page + 1)}>
            Próxima
          </button>
        </div>
      )}
      {creating && <CustomerDrawer customer={null} onClose={() => setCreating(false)} onSaved={(c) => navigate(`/clientes/${c.id}`)} />}
    </div>
  );
}

export function CustomerScreen() {
  const { id } = useParams();
  const client = useQueryClient();
  const [editing, setEditing] = useState(false);
  const c = useQuery({ queryKey: ['customer', id], queryFn: () => api<Customer>(`/customers/${id}`) });
  const cashback = useQuery({ queryKey: ['customer-cashback', id], queryFn: () => api<CashbackEntry[]>(`/customers/${id}/cashback`) });
  const sales = useQuery({ queryKey: ['customer-sales', id], queryFn: () => api<Page<SaleRow>>(`/sales?customerId=${id}&pageSize=20`), enabled: can('sale.create') });
  const timeline = useQuery({ queryKey: ['customer-timeline', id], queryFn: () => api<TimelineItem[]>(`/customers/${id}/timeline`) });
  if (c.isLoading) return <Loading />;
  if (!c.data) return <ErrorBox error={c.error} />;
  const x = c.data;
  return (
    <div className="max-w-5xl space-y-4">
      <PageHeader
        title={x.name}
        subtitle={[formatPhone(x.phone), x.document && formatCpf(x.document), x.email].filter(Boolean).join(' · ')}
        action={can('customer.manage') && <button className="btn-ghost" onClick={() => setEditing(true)}>Editar</button>}
      />
      <div className="grid gap-3 sm:grid-cols-4">
        <div className="card p-4">
          <p className="text-xs text-ink-soft">Clube</p>
          <p className="mt-1 font-semibold">{x.isMember ? `Membro desde ${formatDay(x.memberSince)}` : 'Não é membro'}</p>
          {x.isMember && <p className="text-xs text-ink-soft">Entrou pela {x.memberSource === 'app' ? 'app' : 'loja'}</p>}
        </div>
        <div className="card p-4">
          <p className="text-xs text-ink-soft">Cashback</p>
          <p className="mt-1 text-2xl font-semibold text-brand">{formatMoney(x.cashbackBalance)}</p>
        </div>
        <div className="card p-4">
          <p className="text-xs text-ink-soft">Compras</p>
          <p className="mt-1 text-2xl font-semibold">{x.stats.purchases}</p>
          <p className="text-xs text-ink-soft">{formatMoney(x.stats.spent)} · ticket {formatMoney(x.stats.averageTicket)}</p>
        </div>
        <div className="card p-4">
          <p className="text-xs text-ink-soft">Última compra</p>
          <p className="mt-1 font-semibold">{formatDay(x.stats.lastPurchaseAt)}</p>
          {x.goal && <p className="text-xs text-ink-soft">Objetivo: {CUSTOMER_GOALS[x.goal]}</p>}
        </div>
      </div>
      {x.notes && <p className="card p-4 text-sm">{x.notes}</p>}
      <div className="grid gap-4 lg:grid-cols-2">
        <div className="card p-4">
          <h2 className="mb-2 font-medium">Compras</h2>
          {!sales.data?.items.length ? (
            <p className="text-sm text-ink-soft">Nenhuma compra ainda.</p>
          ) : (
            <table className="table">
              <tbody>
                {sales.data.items.map((s) => (
                  <tr key={s.id} className={s.status === 'canceled' ? 'text-ink-soft line-through' : ''}>
                    <td>
                      <Link to={`/vendas/${s.id}`} className="text-brand">
                        Venda {s.number}
                      </Link>
                    </td>
                    <td>{formatDateTime(s.createdAt)}</td>
                    <td className="text-right tabular-nums">{formatMoney(s.total)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
        <div className="card p-4">
          <h2 className="mb-2 font-medium">Extrato do cashback</h2>
          {!cashback.data?.length ? (
            <p className="text-sm text-ink-soft">Sem movimento.</p>
          ) : (
            <table className="table">
              <tbody>
                {cashback.data.map((e) => (
                  <tr key={e.id}>
                    <td className="text-xs text-ink-soft">{formatDateTime(e.at)}</td>
                    <td>
                      {CASHBACK_ENTRY_TYPES[e.type]}
                      {e.saleNumber && ` · venda ${e.saleNumber}`}
                      {e.expiresAt && <div className="text-xs text-ink-soft">vence {formatDay(e.expiresAt)}</div>}
                    </td>
                    <td className={`text-right tabular-nums ${e.amount < 0 ? 'text-red-600' : 'text-brand'}`}>{formatMoney(e.amount)}</td>
                    <td className="text-right tabular-nums text-ink-soft">{formatMoney(e.balanceAfter)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>
      <div className="card p-4">
        <h2 className="mb-2 font-medium">Histórico</h2>
        <ul className="space-y-1 text-sm">
          {timeline.data?.map((t, i) => (
            <li key={i}>
              <span className="text-ink-soft">{formatDateTime(t.at)}</span> · {t.label} {t.userName && <span className="text-ink-soft">· {t.userName}</span>}
            </li>
          ))}
        </ul>
      </div>
      {editing && (
        <CustomerDrawer
          customer={x}
          onClose={() => setEditing(false)}
          onSaved={() => {
            setEditing(false);
            client.invalidateQueries({ queryKey: ['customer', id] });
            client.invalidateQueries({ queryKey: ['customer-timeline', id] });
            client.invalidateQueries({ queryKey: ['customers'] });
          }}
        />
      )}
    </div>
  );
}

function CustomerDrawer({ customer, onClose, onSaved }: { customer: Customer | null; onClose: () => void; onSaved: (c: Customer) => void }) {
  const [f, setF] = useState<CustomerForm>(
    customer ? { ...customer } : { name: '', document: '', birthDate: '', phone: '', email: '', allowWhatsapp: true, goal: null, isMember: true, notes: '', active: true },
  );
  const [error, setError] = useState<unknown>(null);
  const save = useMutation({
    mutationFn: (body: unknown) => (customer ? api<Customer>(`/customers/${customer.id}`, { method: 'PUT', json: body }) : api<Customer>('/customers', { method: 'POST', json: body })),
    onSuccess: onSaved,
    onError: setError,
  });
  function submit(e: FormEvent) {
    e.preventDefault();
    const parsed = customerSchema.safeParse(f);
    if (!parsed.success) return setError(parsed.error.issues[0]?.message);
    save.mutate(parsed.data);
  }
  const set = <K extends keyof CustomerForm>(k: K, v: CustomerForm[K]) => setF((x) => ({ ...x, [k]: v }));
  return (
    <Drawer title={customer ? 'Editar cliente' : 'Nova cliente'} onClose={onClose}>
      <form className="space-y-3" onSubmit={submit}>
        <Field label="Nome">
          <input className="input" value={f.name} onChange={(e) => set('name', e.target.value)} autoFocus />
        </Field>
        <Field label="Celular (WhatsApp)">
          <input className="input" inputMode="tel" value={f.phone ?? ''} onChange={(e) => set('phone', e.target.value)} placeholder="(27) 99999-9999" />
        </Field>
        <Field label="CPF (opcional)">
          <input className="input" inputMode="numeric" value={f.document ?? ''} onChange={(e) => set('document', e.target.value)} />
        </Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Nascimento">
            <input type="date" className="input" value={f.birthDate ?? ''} onChange={(e) => set('birthDate', e.target.value)} />
          </Field>
          <Field label="Objetivo">
            <select className="input" value={f.goal ?? ''} onChange={(e) => set('goal', (e.target.value || null) as CustomerForm['goal'])}>
              <option value="">—</option>
              {Object.entries(CUSTOMER_GOALS).map(([k, v]) => (
                <option key={k} value={k}>
                  {v}
                </option>
              ))}
            </select>
          </Field>
        </div>
        <Field label="E-mail">
          <input className="input" value={f.email ?? ''} onChange={(e) => set('email', e.target.value)} />
        </Field>
        <Field label="Observações">
          <textarea className="input" rows={2} value={f.notes ?? ''} onChange={(e) => set('notes', e.target.value)} />
        </Field>
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" checked={Boolean(f.isMember)} onChange={(e) => set('isMember', e.target.checked)} /> Membro do clube (preço de membro e cashback)
        </label>
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" checked={Boolean(f.allowWhatsapp)} onChange={(e) => set('allowWhatsapp', e.target.checked)} /> Aceita receber WhatsApp
        </label>
        {customer && (
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" checked={Boolean(f.active)} onChange={(e) => set('active', e.target.checked)} /> Cadastro ativo
          </label>
        )}
        <ErrorBox error={error} />
        <button className="btn-primary w-full" disabled={save.isPending}>
          Salvar
        </button>
      </form>
    </Drawer>
  );
}
