import { useEffect, useState, type FormEvent } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { PAYABLE_CATEGORIES, formatMoney, payableSchema, todayBR, type Page, type Payable, type PayableSummary, type Store } from '@mercearia/contracts';
import { api, can } from '../../lib/api';
import { Drawer, Empty, ErrorBox, Field, Loading, PageHeader } from '../../components/ui';
import { formatDay } from '../../components/os';

const FILTERS = { open: 'Em aberto', overdue: 'Atrasadas', paid: 'Pagas', canceled: 'Canceladas', all: 'Todas' } as const;

/** Contas a pagar: fornecedores, laboratórios e despesas. */
export function PayablesScreen() {
  const client = useQueryClient();
  const [status, setStatus] = useState<keyof typeof FILTERS>('open');
  const [q, setQ] = useState('');
  const [debounced, setDebounced] = useState('');
  const [page, setPage] = useState(1);
  const [creating, setCreating] = useState(false);
  const [paying, setPaying] = useState<Payable | null>(null);
  useEffect(() => {
    const t = setTimeout(() => setDebounced(q.trim()), 300);
    return () => clearTimeout(t);
  }, [q]);
  useEffect(() => setPage(1), [status, debounced]);
  const params = new URLSearchParams({ status, page: String(page), pageSize: '30' });
  if (debounced) params.set('q', debounced);
  const list = useQuery({ queryKey: ['payables', params.toString()], queryFn: () => api<Page<Payable> & { summary: PayableSummary }>(`/payables?${params}`) });
  const refresh = () => {
    client.invalidateQueries({ queryKey: ['payables'] });
    client.invalidateQueries({ queryKey: ['report'] });
  };
  const act = useMutation({ mutationFn: ({ id, action }: { id: string; action: 'cancel' | 'reopen' }) => api(`/payables/${id}/${action}`, { method: 'POST' }), onSettled: refresh });
  const manage = can('finance.manage');
  const pages = list.data ? Math.max(1, Math.ceil(list.data.total / list.data.pageSize)) : 1;

  return (
    <div className="max-w-6xl">
      <PageHeader
        title="Contas a pagar"
        subtitle="Laboratórios, fornecedores e despesas das lojas."
        action={
          manage && (
            <button className="btn-primary" onClick={() => setCreating(true)}>
              Nova conta
            </button>
          )
        }
      />
      {list.data && (
        <div className="mb-4 grid gap-3 sm:grid-cols-3">
          <Stat label="Em aberto" value={formatMoney(list.data.summary.openAmount)} />
          <Stat label="Em atraso" value={formatMoney(list.data.summary.overdueAmount)} alert={list.data.summary.overdueAmount > 0} />
          <Stat label="Vence nos próximos 7 dias" value={formatMoney(list.data.summary.next7Days)} />
        </div>
      )}
      <div className="mb-4 flex flex-wrap gap-2">
        <select className="input w-auto" value={status} onChange={(e) => setStatus(e.target.value as keyof typeof FILTERS)} aria-label="Situação">
          {Object.entries(FILTERS).map(([k, v]) => (
            <option key={k} value={k}>
              {v}
            </option>
          ))}
        </select>
        <input className="input max-w-xs" placeholder="Descrição ou fornecedor" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Buscar" />
      </div>
      <ErrorBox error={list.error ?? act.error} />
      <div className="card overflow-x-auto">
        {list.isLoading ? (
          <Loading />
        ) : !list.data?.items.length ? (
          <Empty>Nenhuma conta com esses filtros.</Empty>
        ) : (
          <table className="table">
            <thead>
              <tr>
                <th>Conta</th>
                <th>Categoria</th>
                <th>Vencimento</th>
                <th>Situação</th>
                <th className="text-right">Valor</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {list.data.items.map((p) => (
                <tr key={p.id}>
                  <td>
                    <span className="font-medium">{p.description}</span>
                    <div className="text-xs text-ink-soft">{[p.supplier, p.storeName ?? 'Grupo'].filter(Boolean).join(' · ')}</div>
                  </td>
                  <td>{PAYABLE_CATEGORIES[p.category].split(' (')[0]}</td>
                  <td className="tabular-nums">{formatDay(p.dueDate)}</td>
                  <td>
                    {p.overdue ? (
                      <span className="badge bg-red-50 text-red-600">Atrasada</span>
                    ) : (
                      <span className={`badge ${p.status === 'paid' ? 'bg-emerald-50 text-emerald-700' : p.status === 'canceled' ? 'bg-slate-100 text-slate-500' : 'bg-sky-50 text-sky-700'}`}>
                        {p.status === 'paid' ? 'Paga' : p.status === 'canceled' ? 'Cancelada' : 'Em aberto'}
                      </span>
                    )}
                    {p.status === 'paid' && (
                      <div className="text-xs text-ink-soft">
                        {formatDay(p.paidDate)}
                        {p.note && ` · ${p.note}`}
                      </div>
                    )}
                  </td>
                  <td className="text-right tabular-nums">{formatMoney(p.amount)}</td>
                  <td className="whitespace-nowrap text-right text-sm">
                    {manage && p.status === 'open' && (
                      <>
                        <button className="mr-3 text-brand" onClick={() => setPaying(p)}>
                          Pagar
                        </button>
                        <button className="text-ink-soft hover:text-red-600" disabled={act.isPending} onClick={() => act.mutate({ id: p.id, action: 'cancel' })}>
                          Cancelar
                        </button>
                      </>
                    )}
                    {manage && p.status !== 'open' && (
                      <button className="text-ink-soft hover:text-ink" disabled={act.isPending} onClick={() => act.mutate({ id: p.id, action: 'reopen' })}>
                        Reabrir
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
      {pages > 1 && (
        <div className="mt-3 flex items-center justify-end gap-2 text-sm">
          <button className="btn-ghost" disabled={page <= 1} onClick={() => setPage((x) => x - 1)}>
            Anterior
          </button>
          <span className="text-ink-soft">
            Página {page} de {pages}
          </span>
          <button className="btn-ghost" disabled={page >= pages} onClick={() => setPage((x) => x + 1)}>
            Próxima
          </button>
        </div>
      )}
      {creating && <CreateDrawer onClose={() => setCreating(false)} onDone={() => { refresh(); setCreating(false); }} />}
      {paying && <PayDrawer payable={paying} onClose={() => setPaying(null)} onDone={() => { refresh(); setPaying(null); }} />}
    </div>
  );
}

export function Stat({ label, value, alert }: { label: string; value: string; alert?: boolean }) {
  return (
    <div className="card p-4">
      <div className="text-xs text-ink-soft">{label}</div>
      <div className={`text-lg font-semibold tabular-nums ${alert ? 'text-red-600' : ''}`}>{value}</div>
    </div>
  );
}

function CreateDrawer({ onClose, onDone }: { onClose: () => void; onDone: () => void }) {
  const stores = useQuery({ queryKey: ['stores'], queryFn: () => api<Store[]>('/stores') });
  const [description, setDescription] = useState('');
  const [supplier, setSupplier] = useState('');
  const [category, setCategory] = useState('laboratorio');
  const [storeId, setStoreId] = useState('');
  const [amount, setAmount] = useState('');
  const [dueDate, setDueDate] = useState(todayBR());
  const [repeat, setRepeat] = useState('1');
  const [error, setError] = useState<unknown>(null);
  const save = useMutation({ mutationFn: (data: unknown) => api('/payables', { method: 'POST', json: data }), onSuccess: onDone, onError: setError });
  function submit(e: FormEvent) {
    e.preventDefault();
    const parsed = payableSchema.safeParse({ description, supplier: supplier || null, category, storeId: storeId || null, amount, dueDate, repeat });
    if (!parsed.success) return setError(new Error(parsed.error.issues[0]?.message));
    save.mutate(parsed.data);
  }
  return (
    <Drawer title="Nova conta a pagar" onClose={onClose}>
      <form onSubmit={submit} className="space-y-4">
        <Field label="Descrição">
          <input className="input" value={description} onChange={(e) => setDescription(e.target.value)} autoFocus placeholder="Ex.: Lentes do pedido 4521" />
        </Field>
        <Field label="Fornecedor (opcional)">
          <input className="input" value={supplier} onChange={(e) => setSupplier(e.target.value)} />
        </Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Categoria">
            <select className="input" value={category} onChange={(e) => setCategory(e.target.value)}>
              {Object.entries(PAYABLE_CATEGORIES).map(([k, v]) => (
                <option key={k} value={k}>
                  {v}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Loja">
            <select className="input" value={storeId} onChange={(e) => setStoreId(e.target.value)}>
              <option value="">Grupo (todas)</option>
              {stores.data?.filter((s) => s.active).map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Valor (R$)">
            <input className="input tabular-nums" inputMode="decimal" placeholder="0,00" value={amount} onChange={(e) => setAmount(e.target.value)} />
          </Field>
          <Field label="Vencimento">
            <input type="date" className="input" value={dueDate} onChange={(e) => setDueDate(e.target.value)} />
          </Field>
        </div>
        <Field label="Repetir todo mês" hint="Para aluguel, internet e outras contas fixas.">
          <select className="input" value={repeat} onChange={(e) => setRepeat(e.target.value)}>
            <option value="1">Não repetir</option>
            {[2, 3, 6, 12, 24].map((n) => (
              <option key={n} value={n}>
                Por {n} meses
              </option>
            ))}
          </select>
        </Field>
        <ErrorBox error={error} />
        <button className="btn-primary w-full" disabled={save.isPending}>
          Salvar
        </button>
      </form>
    </Drawer>
  );
}

function PayDrawer({ payable, onClose, onDone }: { payable: Payable; onClose: () => void; onDone: () => void }) {
  const [paidDate, setPaidDate] = useState(todayBR());
  const [note, setNote] = useState('');
  const pay = useMutation({ mutationFn: () => api(`/payables/${payable.id}/pay`, { method: 'POST', json: { paidDate, note: note || null } }), onSuccess: onDone });
  return (
    <Drawer title="Registrar pagamento" onClose={onClose}>
      <div className="space-y-4">
        <p className="text-sm">
          {payable.description} · <strong>{formatMoney(payable.amount)}</strong>
        </p>
        <Field label="Data em que foi paga">
          <input type="date" className="input" value={paidDate} max={todayBR()} onChange={(e) => setPaidDate(e.target.value)} />
        </Field>
        <Field label="Como foi paga (opcional)">
          <input className="input" value={note} onChange={(e) => setNote(e.target.value)} placeholder="Ex.: Pix da conta do Asaas" />
        </Field>
        <ErrorBox error={pay.error} />
        <button className="btn-primary w-full" disabled={pay.isPending} onClick={() => pay.mutate()}>
          Marcar como paga
        </button>
      </div>
    </Drawer>
  );
}
