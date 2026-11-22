import { useEffect, useState, type FormEvent } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { DRE_GROUPS, formatMoney, payableSchema, todayBR, type ChartAccount, type FinancialAccount, type Page, type Payable, type PayableSummary, type Store } from '@mercearia/contracts';
import { api, can } from '../../lib/api';
import { Drawer, Empty, ErrorBox, Field, Loading, PageHeader } from '../../components/ui';
import { formatDay } from '../../components/format';

const FILTERS = { open: 'Em aberto', overdue: 'Atrasadas', paid: 'Pagas', canceled: 'Canceladas', all: 'Todas' } as const;

/** Contas a pagar: fornecedores, folha e despesas, classificadas no plano de contas. */
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
        subtitle="Fornecedores, folha, impostos e despesas da loja, cada uma na sua conta do plano de contas."
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
                <th>Conta do plano</th>
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
                    <div className="text-xs text-ink-soft">{[p.supplier, p.document && `doc. ${p.document}`, p.storeName ?? 'Grupo'].filter(Boolean).join(' · ')}</div>
                  </td>
                  <td className="text-sm">{p.chartAccount ?? <span className="text-amber-700">sem conta</span>}{p.competence && p.competence.slice(0, 7) !== p.dueDate.slice(0, 7) && <div className="text-xs text-ink-soft">competência {p.competence.slice(5, 7)}/{p.competence.slice(0, 4)}</div>}</td>
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
                        {p.accountName && ` · ${p.accountName}`}{p.note && ` · ${p.note}`}
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
  const chart = useQuery({ queryKey: ['chart'], queryFn: () => api<ChartAccount[]>('/chart-accounts') });
  const suppliers = useQuery({ queryKey: ['suppliers', 'lista'], queryFn: () => api<Array<{ id: string; name: string; active: boolean }>>('/suppliers'), enabled: can('purchase.manage') });
  const [f, setF] = useState({ description: '', supplierId: '', supplier: '', chartAccountId: '', storeId: '', amount: '', dueDate: todayBR(), competence: '', document: '', repeat: '1' });
  const [error, setError] = useState<unknown>(null);
  const save = useMutation({ mutationFn: (data: unknown) => api('/payables', { method: 'POST', json: data }), onSuccess: onDone, onError: setError });
  const set = (k: keyof typeof f) => (e: { target: { value: string } }) => setF({ ...f, [k]: e.target.value });
  function submit(e: FormEvent) {
    e.preventDefault();
    if (!f.chartAccountId) return setError(new Error('Escolha a conta do plano de contas.'));
    const parsed = payableSchema.safeParse({ description: f.description, supplier: f.supplier || null, supplierId: f.supplierId || null, chartAccountId: f.chartAccountId, storeId: f.storeId || null, amount: f.amount, dueDate: f.dueDate, competence: f.competence ? `${f.competence}-01` : null, document: f.document || null, repeat: f.repeat });
    if (!parsed.success) return setError(new Error(parsed.error.issues[0]?.message));
    save.mutate(parsed.data);
  }
  const contas = (chart.data ?? []).filter((c) => c.active && !c.group);
  return (
    <Drawer title="Nova conta a pagar" onClose={onClose}>
      <form onSubmit={submit} className="space-y-4">
        <Field label="Descrição">
          <input className="input" value={f.description} onChange={set('description')} autoFocus placeholder="Ex.: Aluguel de dezembro" />
        </Field>
        <Field label="Conta do plano de contas" hint="Define em que linha do DRE a despesa aparece.">
          <select className="input" value={f.chartAccountId} onChange={set('chartAccountId')}>
            <option value="">Escolha…</option>
            {Object.entries(DRE_GROUPS).map(([g, nome]) => {
              const doGrupo = contas.filter((c) => c.dreLine === g);
              return doGrupo.length ? (
                <optgroup key={g} label={nome}>
                  {doGrupo.map((c) => <option key={c.id} value={c.id}>{c.code} · {c.name}</option>)}
                </optgroup>
              ) : null;
            })}
          </select>
        </Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Fornecedor cadastrado">
            <select className="input" value={f.supplierId} onChange={set('supplierId')}>
              <option value="">—</option>
              {suppliers.data?.filter((x) => x.active).map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}
            </select>
          </Field>
          <Field label="Ou para quem (texto)">
            <input className="input" value={f.supplier} onChange={set('supplier')} disabled={!!f.supplierId} placeholder="Ex.: Imobiliária" />
          </Field>
          <Field label="Valor (R$)">
            <input className="input tabular-nums" inputMode="decimal" placeholder="0,00" value={f.amount} onChange={set('amount')} />
          </Field>
          <Field label="Vencimento">
            <input type="date" className="input" value={f.dueDate} onChange={set('dueDate')} />
          </Field>
          <Field label="Competência (mês)" hint="Vazio = mês do vencimento.">
            <input type="month" className="input" value={f.competence} onChange={set('competence')} />
          </Field>
          <Field label="Nº da nota ou boleto">
            <input className="input" value={f.document} onChange={set('document')} />
          </Field>
          <Field label="Loja">
            <select className="input" value={f.storeId} onChange={set('storeId')}>
              <option value="">Grupo (todas)</option>
              {stores.data?.filter((s) => s.active).map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
            </select>
          </Field>
          <Field label="Repetir todo mês">
            <select className="input" value={f.repeat} onChange={set('repeat')}>
              <option value="1">Não repetir</option>
              {[2, 3, 6, 12, 24].map((n) => <option key={n} value={n}>Por {n} meses</option>)}
            </select>
          </Field>
        </div>
        <ErrorBox error={error} />
        <button className="btn-primary w-full" disabled={save.isPending}>Salvar</button>
      </form>
    </Drawer>
  );
}

function PayDrawer({ payable, onClose, onDone }: { payable: Payable; onClose: () => void; onDone: () => void }) {
  const contas = useQuery({ queryKey: ['contas-financeiras'], queryFn: () => api<FinancialAccount[]>('/financial-accounts') });
  const chart = useQuery({ queryKey: ['chart'], queryFn: () => api<ChartAccount[]>('/chart-accounts') });
  const [paidDate, setPaidDate] = useState(todayBR());
  const [accountId, setAccountId] = useState<string | null>(null);
  const [chartAccountId, setChartAccountId] = useState(payable.chartAccountId ?? '');
  const [note, setNote] = useState('');
  const ativas = (contas.data ?? []).filter((c) => c.active);
  const conta = accountId ?? ativas.find((c) => c.kind === 'banco')?.id ?? '';
  const pay = useMutation({
    mutationFn: async () => {
      if (chartAccountId && chartAccountId !== payable.chartAccountId) await api(`/payables/${payable.id}`, { method: 'PATCH', json: { chartAccountId } });
      return api(`/payables/${payable.id}/pay`, { method: 'POST', json: { paidDate, note: note || null, accountId: conta || null } });
    },
    onSuccess: onDone,
  });
  return (
    <Drawer title="Registrar pagamento" onClose={onClose}>
      <div className="space-y-4">
        <p className="text-sm">
          {payable.description} · <strong>{formatMoney(payable.amount)}</strong>
        </p>
        <Field label="Data em que foi paga">
          <input type="date" className="input" value={paidDate} max={todayBR()} onChange={(e) => setPaidDate(e.target.value)} />
        </Field>
        <Field label="Saiu de qual conta" hint="Entra no extrato e no saldo da conta.">
          <select className="input" value={conta} onChange={(e) => setAccountId(e.target.value)}>
            <option value="">Não lançar em conta</option>
            {ativas.map((c) => <option key={c.id} value={c.id}>{c.name} · saldo {formatMoney(c.balance)}</option>)}
          </select>
        </Field>
        <Field label="Conta do plano de contas">
          <select className="input" value={chartAccountId} onChange={(e) => setChartAccountId(e.target.value)}>
            <option value="">Sem conta (não aparece no DRE)</option>
            {(chart.data ?? []).filter((c) => c.active && !c.group).map((c) => <option key={c.id} value={c.id}>{c.code} · {c.name}</option>)}
          </select>
        </Field>
        <Field label="Observação (opcional)">
          <input className="input" value={note} onChange={(e) => setNote(e.target.value)} placeholder="Ex.: Pix" />
        </Field>
        <ErrorBox error={pay.error} />
        <button className="btn-primary w-full" disabled={pay.isPending} onClick={() => pay.mutate()}>Marcar como paga</button>
      </div>
    </Drawer>
  );
}
