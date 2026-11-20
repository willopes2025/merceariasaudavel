import { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { FISCAL_STATUS, SALE_CHANNELS, saleCancelSchema, todayBR, type Page, type Sale, type SaleRow } from '@mercearia/contracts';
import { api, can } from '../../lib/api';
import { Drawer, Empty, ErrorBox, Field, Loading, PageHeader } from '../../components/ui';
import { formatDateTime, formatMoney, formatQty } from '../../components/format';
import { SaleFiscal } from '../../components/fiscal';

export function SalesScreen() {
  const [from, setFrom] = useState(todayBR());
  const [to, setTo] = useState(todayBR());
  const [status, setStatus] = useState('all');
  const [page, setPage] = useState(1);
  const navigate = useNavigate();
  useEffect(() => setPage(1), [from, to, status]);
  const params = new URLSearchParams({ from, to, status, page: String(page) });
  const list = useQuery({ queryKey: ['sales', params.toString()], queryFn: () => api<Page<SaleRow>>(`/sales?${params}`) });
  const pages = list.data ? Math.max(1, Math.ceil(list.data.total / list.data.pageSize)) : 1;
  const totals = (list.data?.items ?? []).filter((s) => s.status === 'completed').reduce((s, r) => s + r.total, 0);
  return (
    <div className="max-w-6xl">
      <PageHeader title="Vendas" subtitle="Vendas do caixa. Clique na venda para ver os itens, a nota e cancelar." action={<Link to="/vender" className="btn-primary">Nova venda</Link>} />
      <div className="mb-4 flex flex-wrap items-end gap-2">
        <Field label="De">
          <input type="date" className="input" value={from} onChange={(e) => setFrom(e.target.value)} />
        </Field>
        <Field label="Até">
          <input type="date" className="input" value={to} onChange={(e) => setTo(e.target.value)} />
        </Field>
        <select className="input w-auto" value={status} onChange={(e) => setStatus(e.target.value)} aria-label="Situação">
          <option value="all">Todas</option>
          <option value="completed">Concluídas</option>
          <option value="canceled">Canceladas</option>
        </select>
        <span className="ml-auto text-sm text-ink-soft">Nesta página: {formatMoney(totals)}</span>
      </div>
      <ErrorBox error={list.error} />
      <div className="card overflow-x-auto">
        {list.isLoading ? (
          <Loading />
        ) : !list.data?.items.length ? (
          <Empty>Nenhuma venda nesse período.</Empty>
        ) : (
          <table className="table">
            <thead>
              <tr>
                <th>Nº</th>
                <th>Quando</th>
                <th>Cliente</th>
                <th>Quem vendeu</th>
                <th>Nota</th>
                <th className="text-right">Total</th>
              </tr>
            </thead>
            <tbody>
              {list.data.items.map((s) => (
                <tr key={s.id} className={`cursor-pointer hover:bg-slate-50 ${s.status === 'canceled' ? 'text-ink-soft line-through' : ''}`} onClick={() => navigate(`/vendas/${s.id}`)}>
                  <td className="font-medium">{s.number}</td>
                  <td>{formatDateTime(s.createdAt)}</td>
                  <td>
                    {s.customerName ?? '—'} {s.memberPricing && <span className="badge ml-1 bg-brand-soft text-brand no-underline">Membro</span>}
                  </td>
                  <td>{s.sellerName ?? '—'}</td>
                  <td>{s.fiscalStatus ? FISCAL_STATUS[s.fiscalStatus as keyof typeof FISCAL_STATUS] : '—'}</td>
                  <td className="text-right tabular-nums">{formatMoney(s.total)}</td>
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
    </div>
  );
}

export function SaleScreen() {
  const { id } = useParams();
  const client = useQueryClient();
  const sale = useQuery({ queryKey: ['sale', id], queryFn: () => api<Sale>(`/sales/${id}`) });
  const [canceling, setCanceling] = useState(false);
  if (sale.isLoading) return <Loading />;
  if (!sale.data) return <ErrorBox error={sale.error} />;
  const s = sale.data;
  return (
    <div className="max-w-4xl space-y-4">
      <PageHeader
        title={`Venda nº ${s.number}`}
        subtitle={`${formatDateTime(s.createdAt)} · ${s.storeName} · ${SALE_CHANNELS[s.channel]}${s.sellerName ? ` · ${s.sellerName}` : ''}`}
        action={
          s.status === 'completed' && can('sale.cancel') ? (
            <button className="btn-ghost text-red-600" onClick={() => setCanceling(true)}>
              Cancelar venda
            </button>
          ) : s.status === 'canceled' ? (
            <span className="badge bg-red-50 text-red-600">Cancelada</span>
          ) : null
        }
      />
      {s.status === 'canceled' && (
        <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">
          Cancelada em {formatDateTime(s.canceledAt)}: {s.cancelReason}
        </p>
      )}
      <div className="card p-4">
        <p className="text-sm">
          Cliente: {s.customerId ? <Link to={`/clientes/${s.customerId}`} className="text-brand">{s.customerName}</Link> : 'não identificada'}
          {s.memberPricing && <span className="badge ml-2 bg-brand text-white">Membro</span>}
        </p>
        <table className="table mt-3">
          <thead>
            <tr>
              <th>Produto</th>
              <th className="text-right">Qtd.</th>
              <th className="text-right">Preço</th>
              <th className="text-right">Total</th>
            </tr>
          </thead>
          <tbody>
            {s.items.map((i, n) => (
              <tr key={n}>
                <td>{i.description}</td>
                <td className="text-right tabular-nums">{formatQty(i.quantity, i.unit === 'UN' ? undefined : i.unit)}</td>
                <td className="text-right tabular-nums">
                  {i.unitPrice < i.listPrice && <span className="mr-1 text-xs text-ink-soft line-through">{formatMoney(i.listPrice)}</span>}
                  {formatMoney(i.unitPrice)}
                </td>
                <td className="text-right tabular-nums">{formatMoney(i.total)}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <dl className="ml-auto mt-3 max-w-xs space-y-1 text-sm">
          <Line label="Produtos" value={formatMoney(s.grossTotal)} />
          {s.memberSavings > 0 && <Line label="Preço de membro" value={`− ${formatMoney(s.memberSavings)}`} />}
          {s.discount > 0 && <Line label="Desconto" value={`− ${formatMoney(s.discount)}`} />}
          {s.cashbackUsed > 0 && <Line label="Cashback usado" value={`− ${formatMoney(s.cashbackUsed)}`} />}
          <Line label="Total pago" value={formatMoney(s.total)} bold />
          {s.change > 0 && <Line label="Troco" value={formatMoney(s.change)} />}
          {s.cashbackEarned > 0 && <Line label="Cashback ganho" value={formatMoney(s.cashbackEarned)} />}
        </dl>
      </div>
      <div className="card p-4">
        <p className="mb-2 text-sm font-medium">Pagamentos</p>
        {s.payments.map((p) => (
          <div key={p.id} className={`flex justify-between text-sm ${p.reversed ? 'text-ink-soft line-through' : ''}`}>
            <span>
              {p.amount < 0 ? 'Estorno · ' : ''}
              {p.methodName}
            </span>
            <span className="tabular-nums">{formatMoney(p.amount)}</span>
          </div>
        ))}
      </div>
      {can('fiscal.view') && (
        <div className="card p-4">
          <SaleFiscal saleId={s.id} />
        </div>
      )}
      {canceling && <CancelDrawer sale={s} onClose={() => setCanceling(false)} onDone={() => { setCanceling(false); client.invalidateQueries({ queryKey: ['sale', id] }); client.invalidateQueries({ queryKey: ['sales'] }); }} />}
    </div>
  );
}

function Line({ label, value, bold }: { label: string; value: string; bold?: boolean }) {
  return (
    <div className={`flex justify-between ${bold ? 'border-t border-slate-200 pt-1 font-semibold' : ''}`}>
      <dt className="text-ink-soft">{label}</dt>
      <dd className="tabular-nums">{value}</dd>
    </div>
  );
}

function CancelDrawer({ sale, onClose, onDone }: { sale: Sale; onClose: () => void; onDone: () => void }) {
  const [reason, setReason] = useState('');
  const [error, setError] = useState<unknown>(null);
  const cancel = useMutation({ mutationFn: () => api(`/sales/${sale.id}/cancel`, { method: 'POST', json: { reason } }), onSuccess: onDone, onError: setError });
  return (
    <Drawer title={`Cancelar a venda nº ${sale.number}`} onClose={onClose}>
      <form
        className="space-y-4"
        onSubmit={(e) => {
          e.preventDefault();
          const r = saleCancelSchema.safeParse({ reason });
          if (!r.success) return setError(r.error.issues[0]?.message);
          cancel.mutate();
        }}
      >
        <p className="text-sm text-ink-soft">
          O dinheiro sai do caixa aberto agora, os produtos voltam ao estoque (nos mesmos lotes) e o cashback é desfeito.
          {sale.fiscal?.status === 'authorized' && ' A NFC-e é cancelada antes; se a SEFAZ recusar, a venda continua valendo.'}
        </p>
        <Field label="Motivo">
          <input className="input" value={reason} onChange={(e) => setReason(e.target.value)} autoFocus />
        </Field>
        <ErrorBox error={error} />
        <button className="btn-primary w-full bg-red-600 hover:bg-red-700" disabled={cancel.isPending}>
          Cancelar venda
        </button>
      </form>
    </Drawer>
  );
}
