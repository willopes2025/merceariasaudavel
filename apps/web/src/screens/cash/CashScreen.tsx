import { useEffect, useState, type FormEvent } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import {
  CASH_MOVEMENT_TYPES,
  cashCloseSchema,
  cashManualSchema,
  cashOpenSchema,
  formatMoney,
  type CashSession,
  type CashSessionRow,
  type Page,
  type Store,
} from '@mercearia/contracts';
import { api, can, session as auth } from '../../lib/api';
import { Drawer, Empty, ErrorBox, Field, Loading, PageHeader } from '../../components/ui';
import { formatDateTime } from '../../components/format';

/** Caixa da loja: abrir, ver o que entrou, suprimento, sangria e fechar. Estorno é pelo cancelamento da venda. */
export function CashScreen() {
  const client = useQueryClient();
  const user = auth.user();
  const stores = useQuery({ queryKey: ['stores'], queryFn: () => api<Store[]>('/stores') });
  const allowed = (stores.data ?? []).filter((s) => s.active && (!user?.storeIds.length || user.storeIds.includes(s.id)));
  const [storeId, setStoreId] = useState('');
  useEffect(() => {
    if (!storeId && allowed.length) setStoreId(allowed[0]!.id);
  }, [allowed, storeId]);

  const current = useQuery({
    queryKey: ['cash-current', storeId],
    queryFn: () => api<{ session: CashSession | null }>(`/cash/current?storeId=${storeId}`),
    enabled: Boolean(storeId),
    refetchInterval: 30_000,
  });
  const history = useQuery({
    queryKey: ['cash-history', storeId],
    queryFn: () => api<Page<CashSessionRow>>(`/cash/sessions?storeId=${storeId}`),
    enabled: Boolean(storeId) && can('finance.view'),
  });
  const [viewing, setViewing] = useState<string | null>(null);
  const [drawer, setDrawer] = useState<'suprimento' | 'sangria' | 'close' | null>(null);
  const refresh = () => {
    client.invalidateQueries({ queryKey: ['cash-current'] });
    client.invalidateQueries({ queryKey: ['cash-history'] });
    client.invalidateQueries({ queryKey: ['service-order'] });
  };
  const s = current.data?.session ?? null;

  return (
    <div className="max-w-5xl">
      <PageHeader title="Abrir e fechar caixa" subtitle="Toda venda entra no caixa aberto da loja. Para vender, use Caixa (PDV)." action={<Link to="/vender" className="btn-primary">Ir para o PDV</Link>} />
      {allowed.length > 1 && (
        <select className="input mb-4 w-auto" value={storeId} onChange={(e) => setStoreId(e.target.value)} aria-label="Loja">
          {allowed.map((st) => (
            <option key={st.id} value={st.id}>
              {st.name}
            </option>
          ))}
        </select>
      )}
      <ErrorBox error={current.error} />
      {!storeId || current.isLoading ? (
        <Loading />
      ) : !s ? (
        <OpenForm storeId={storeId} onDone={refresh} />
      ) : (
        <>
          <div className="card p-5">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <span className="badge bg-emerald-50 text-emerald-700">Caixa aberto</span>
                <p className="mt-1 text-sm text-ink-soft">
                  {s.storeName} · aberto em {formatDateTime(s.openedAt)}
                  {s.openedByName && ` por ${s.openedByName}`} · troco inicial {formatMoney(s.openingAmount)}
                </p>
              </div>
              <div className="flex flex-wrap gap-2">
                <button className="btn-ghost" onClick={() => setDrawer('suprimento')}>
                  Suprimento
                </button>
                <button className="btn-ghost" onClick={() => setDrawer('sangria')}>
                  Sangria
                </button>
                {can('cash.close') && (
                  <button className="btn-primary" onClick={() => setDrawer('close')}>
                    Fechar caixa
                  </button>
                )}
              </div>
            </div>
            <Summary s={s} />
          </div>
          <h2 className="mb-2 mt-6 text-sm font-semibold">Lançamentos</h2>
          <Movements s={s} />
        </>
      )}

      {can('finance.view') && (
        <>
          <h2 className="mb-2 mt-8 text-sm font-semibold">Caixas anteriores</h2>
          <div className="card overflow-x-auto">
            {!history.data?.items.filter((h) => h.status === 'closed').length ? (
              <Empty>Nenhum caixa fechado ainda.</Empty>
            ) : (
              <table className="table tabular-nums">
                <thead>
                  <tr>
                    <th>Aberto</th>
                    <th>Fechado</th>
                    <th>Quem abriu</th>
                    <th className="text-right">Recebido</th>
                    <th className="text-right">Diferença</th>
                  </tr>
                </thead>
                <tbody>
                  {history.data.items
                    .filter((h) => h.status === 'closed')
                    .map((h) => (
                      <tr key={h.id} className="cursor-pointer hover:bg-slate-50" onClick={() => setViewing(h.id)}>
                        <td>{formatDateTime(h.openedAt)}</td>
                        <td>{formatDateTime(h.closedAt)}</td>
                        <td>{h.openedByName ?? '—'}</td>
                        <td className="text-right">{formatMoney(h.received)}</td>
                        <td className={`text-right ${h.difference && h.difference < 0 ? 'text-red-600' : ''}`}>{h.difference == null ? '—' : formatMoney(h.difference)}</td>
                      </tr>
                    ))}
                </tbody>
              </table>
            )}
          </div>
        </>
      )}

      {s && (drawer === 'suprimento' || drawer === 'sangria') && <ManualDrawer session={s} type={drawer} onClose={() => setDrawer(null)} onDone={() => { refresh(); setDrawer(null); }} />}
      {s && drawer === 'close' && <CloseDrawer session={s} onClose={() => setDrawer(null)} onDone={() => { refresh(); setDrawer(null); }} />}
      {viewing && <PastDrawer id={viewing} onClose={() => setViewing(null)} />}
    </div>
  );
}

function Summary({ s }: { s: CashSession }) {
  return (
    <div className="mt-4 grid gap-3 sm:grid-cols-3">
      <div className="rounded-lg bg-slate-50 p-3">
        <div className="text-xs text-ink-soft">Dinheiro na gaveta</div>
        <div className="text-lg font-semibold tabular-nums">{formatMoney(s.expectedCash)}</div>
      </div>
      <div className="rounded-lg bg-slate-50 p-3">
        <div className="text-xs text-ink-soft">Recebido no total</div>
        <div className="text-lg font-semibold tabular-nums">{formatMoney(s.received)}</div>
      </div>
      <div className="rounded-lg bg-slate-50 p-3 text-sm tabular-nums">
        {s.totals.length ? (
          s.totals.map((t) => (
            <div key={t.methodName} className="flex justify-between">
              <span className="text-ink-soft">{t.methodName}</span>
              <span>{formatMoney(t.amount)}</span>
            </div>
          ))
        ) : (
          <span className="text-ink-soft">Nada recebido ainda.</span>
        )}
      </div>
    </div>
  );
}

function Movements({ s }: { s: CashSession }) {
  return (
    <div className="card overflow-x-auto">
      {!s.movements.length ? (
        <Empty>Nenhum lançamento.</Empty>
      ) : (
        <table className="table">
          <thead>
            <tr>
              <th>Hora</th>
              <th>Lançamento</th>
              <th>Forma</th>
              <th>Quem</th>
              <th className="text-right">Valor</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {s.movements.map((m) => (
              <tr key={m.id} className={m.reversed ? 'text-ink-soft line-through decoration-slate-300' : ''}>
                <td className="tabular-nums">{formatDateTime(m.at)}</td>
                <td>
                  {m.type === 'recebimento' || m.type === 'estorno' ? (
                    <>
                      {m.type === 'estorno' && 'Estorno · '}
                      {m.saleId ? <Link to={`/vendas/${m.saleId}`} className="text-brand">Venda {m.saleNumber}</Link> : null} {m.customerName && <span className="text-ink-soft">· {m.customerName}</span>}
                    </>
                  ) : (
                    CASH_MOVEMENT_TYPES[m.type].split(' (')[0]
                  )}
                  {m.note && <div className="text-xs text-ink-soft no-underline">{m.note}</div>}
                </td>
                <td>{m.methodName ?? 'Dinheiro'}</td>
                <td>{m.userName ?? '—'}</td>
                <td className={`text-right tabular-nums ${m.amount < 0 ? 'text-red-600' : ''}`}>{formatMoney(m.amount)}</td>
                <td className="text-right">

                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}

function OpenForm({ storeId, onDone }: { storeId: string; onDone: () => void }) {
  const [amount, setAmount] = useState('');
  const [error, setError] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);
  async function submit(e: FormEvent) {
    e.preventDefault();
    const parsed = cashOpenSchema.safeParse({ storeId, openingAmount: amount || '0' });
    if (!parsed.success) return setError(new Error(parsed.error.issues[0]?.message));
    setBusy(true);
    try {
      await api('/cash/open', { method: 'POST', json: parsed.data });
      onDone();
    } catch (err) {
      setError(err);
    } finally {
      setBusy(false);
    }
  }
  return (
    <form onSubmit={submit} className="card max-w-md space-y-4 p-5">
      <p className="text-sm">O caixa desta loja está <strong>fechado</strong>. Conte o troco que está na gaveta e abra o caixa.</p>
      <Field label="Troco na gaveta (R$)">
        <input className="input tabular-nums" inputMode="decimal" placeholder="0,00" value={amount} onChange={(e) => setAmount(e.target.value)} />
      </Field>
      <ErrorBox error={error} />
      <button className="btn-primary w-full" disabled={busy}>
        Abrir caixa
      </button>
    </form>
  );
}

function ManualDrawer({ session, type, onClose, onDone }: { session: CashSession; type: 'suprimento' | 'sangria'; onClose: () => void; onDone: () => void }) {
  const [amount, setAmount] = useState('');
  const [note, setNote] = useState('');
  const [error, setError] = useState<unknown>(null);
  const save = useMutation({
    mutationFn: (data: unknown) => api(`/cash/sessions/${session.id}/movements`, { method: 'POST', json: data }),
    onSuccess: onDone,
    onError: setError,
  });
  function submit(e: FormEvent) {
    e.preventDefault();
    const parsed = cashManualSchema.safeParse({ type, amount, note });
    if (!parsed.success) return setError(new Error(parsed.error.issues[0]?.message));
    save.mutate(parsed.data);
  }
  return (
    <Drawer title={type === 'sangria' ? 'Sangria (retirar dinheiro)' : 'Suprimento (colocar troco)'} onClose={onClose}>
      <form onSubmit={submit} className="space-y-4">
        <p className="text-sm text-ink-soft">Na gaveta agora: {formatMoney(session.expectedCash)}</p>
        <Field label="Valor (R$)">
          <input className="input tabular-nums" inputMode="decimal" placeholder="0,00" value={amount} onChange={(e) => setAmount(e.target.value)} autoFocus />
        </Field>
        <Field label="Motivo">
          <input className="input" value={note} onChange={(e) => setNote(e.target.value)} placeholder={type === 'sangria' ? 'Ex.: depósito no banco' : 'Ex.: troco'} />
        </Field>
        <ErrorBox error={error} />
        <button className="btn-primary w-full" disabled={save.isPending}>
          Lançar
        </button>
      </form>
    </Drawer>
  );
}

function CloseDrawer({ session, onClose, onDone }: { session: CashSession; onClose: () => void; onDone: () => void }) {
  const [counted, setCounted] = useState('');
  const [notes, setNotes] = useState('');
  const [error, setError] = useState<unknown>(null);
  const save = useMutation({
    mutationFn: (data: unknown) => api(`/cash/sessions/${session.id}/close`, { method: 'POST', json: data }),
    onSuccess: onDone,
    onError: setError,
  });
  const parsed = cashCloseSchema.safeParse({ countedAmount: counted || undefined, notes: notes || null });
  const diff = parsed.success && counted ? Math.round((parsed.data.countedAmount - session.expectedCash) * 100) / 100 : null;
  return (
    <Drawer title="Fechar caixa" onClose={onClose}>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          if (!parsed.success || !counted) return setError(new Error('Informe quanto dinheiro tem na gaveta'));
          save.mutate(parsed.data);
        }}
        className="space-y-4"
      >
        <p className="text-sm">Conte o dinheiro da gaveta. Pelo sistema deveria ter <strong>{formatMoney(session.expectedCash)}</strong>.</p>
        <Field label="Dinheiro contado (R$)">
          <input className="input tabular-nums" inputMode="decimal" placeholder="0,00" value={counted} onChange={(e) => setCounted(e.target.value)} autoFocus />
        </Field>
        {diff !== null && (
          <p className={`text-sm ${diff === 0 ? 'text-emerald-700' : 'text-red-600'}`}>
            {diff === 0 ? 'Bateu certinho.' : diff < 0 ? `Faltam ${formatMoney(-diff)}.` : `Sobram ${formatMoney(diff)}.`}
          </p>
        )}
        <Field label="Observação">
          <input className="input" value={notes} onChange={(e) => setNotes(e.target.value)} />
        </Field>
        <ErrorBox error={error} />
        <button className="btn-primary w-full" disabled={save.isPending}>
          Fechar caixa
        </button>
      </form>
    </Drawer>
  );
}

function PastDrawer({ id, onClose }: { id: string; onClose: () => void }) {
  const q = useQuery({ queryKey: ['cash-session', id], queryFn: () => api<CashSession>(`/cash/sessions/${id}`) });
  return (
    <Drawer title="Caixa fechado" onClose={onClose} wide>
      {!q.data ? (
        <Loading />
      ) : (
        <div className="space-y-4">
          <p className="text-sm text-ink-soft">
            {q.data.storeName} · {formatDateTime(q.data.openedAt)} até {formatDateTime(q.data.closedAt)}
            {q.data.closedByName && ` · fechado por ${q.data.closedByName}`}
          </p>
          <Summary s={q.data} />
          <p className="text-sm tabular-nums">
            Contado: {formatMoney(q.data.countedAmount ?? 0)} · Diferença:{' '}
            <span className={(q.data.difference ?? 0) < 0 ? 'text-red-600' : ''}>{formatMoney(q.data.difference ?? 0)}</span>
            {q.data.notes && <span className="text-ink-soft"> · {q.data.notes}</span>}
          </p>
          <Movements s={q.data} />
        </div>
      )}
    </Drawer>
  );
}
