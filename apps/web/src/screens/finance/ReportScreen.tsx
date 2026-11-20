import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { PAYABLE_CATEGORIES, addDays, formatMoney, todayBR, type PeriodReport, type Store } from '@mercearia/contracts';
import { api } from '../../lib/api';
import { ErrorBox, Loading, PageHeader } from '../../components/ui';
import { Stat } from './PayablesScreen';

const monthStart = (iso: string) => `${iso.slice(0, 8)}01`;

/** Resumo do período: vendas, margem, clube, perdas, recebimentos e despesas. */
export function ReportScreen() {
  const today = todayBR();
  const [from, setFrom] = useState(monthStart(today));
  const [to, setTo] = useState(today);
  const [storeId, setStoreId] = useState('');
  const stores = useQuery({ queryKey: ['stores'], queryFn: () => api<Store[]>('/stores') });
  const params = new URLSearchParams({ from, to });
  if (storeId) params.set('storeId', storeId);
  const report = useQuery({ queryKey: ['report', params.toString()], queryFn: () => api<PeriodReport>(`/reports/period?${params}`), enabled: from <= to });
  const r = report.data;
  const preset = (f: string, t: string) => {
    setFrom(f);
    setTo(t);
  };
  const lastMonthEnd = addDays(monthStart(today), -1);

  return (
    <div className="max-w-6xl">
      <PageHeader title="Resumo do período" subtitle="Vendido = vendas do caixa (fora as canceladas), contando o cashback usado. Recebido = o que entrou no caixa." />
      <div className="mb-4 flex flex-wrap items-end gap-2">
        <label className="text-sm">
          <span className="mb-1 block text-xs text-ink-soft">De</span>
          <input type="date" className="input" value={from} onChange={(e) => setFrom(e.target.value)} />
        </label>
        <label className="text-sm">
          <span className="mb-1 block text-xs text-ink-soft">Até</span>
          <input type="date" className="input" value={to} onChange={(e) => setTo(e.target.value)} />
        </label>
        {(stores.data?.length ?? 0) > 1 && (
          <select className="input w-auto" value={storeId} onChange={(e) => setStoreId(e.target.value)} aria-label="Loja">
            <option value="">Todas as lojas</option>
            {stores.data?.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </select>
        )}
        <button className="btn-ghost" onClick={() => preset(today, today)}>
          Hoje
        </button>
        <button className="btn-ghost" onClick={() => preset(monthStart(today), today)}>
          Este mês
        </button>
        <button className="btn-ghost" onClick={() => preset(monthStart(lastMonthEnd), lastMonthEnd)}>
          Mês passado
        </button>
      </div>
      <ErrorBox error={report.error} />
      {from > to ? (
        <p className="text-sm text-red-600">A data final é antes da inicial.</p>
      ) : !r ? (
        <Loading />
      ) : (
        <div className="space-y-4">
          <div className="grid gap-3 sm:grid-cols-4">
            <Stat label="Vendido" value={formatMoney(r.sales.total)} />
            <Stat label="Vendas · ticket médio" value={`${r.sales.count} · ${formatMoney(r.sales.averageTicket)}`} />
            <Stat label="Margem bruta" value={`${r.sales.grossMargin.toLocaleString('pt-BR')}%`} />
            <Stat label="Recebido" value={formatMoney(r.received.total)} />
          </div>
          <div className="grid gap-3 sm:grid-cols-4">
            <Stat label="Faturamento de membros" value={`${r.sales.memberShare.toLocaleString('pt-BR')}%`} />
            <Stat label="Economia dada aos membros" value={formatMoney(r.sales.memberSavings)} />
            <Stat label="Cashback ganho · usado" value={`${formatMoney(r.cashback.earned)} · ${formatMoney(r.cashback.used)}`} />
            <Stat label="Perdas (a custo)" value={formatMoney(r.losses.total)} alert={r.losses.total > 0} />
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            <Stat label="Despesas pagas" value={formatMoney(r.payables.paid)} />
            <Stat label="Recebido − despesas" value={formatMoney(r.result)} alert={r.result < 0} />
          </div>
          <div className="grid gap-4 md:grid-cols-2">
            <Block title="Por categoria (venda · margem)">
              <Rows rows={r.byCategory.map((c) => [c.name, `${formatMoney(c.total)} · ${c.margin.toLocaleString('pt-BR')}%`])} empty="Nenhuma venda no período." />
            </Block>
            <Block title="Por pessoa da equipe">
              <Rows rows={r.bySeller.map((s) => [`${s.name} · ${s.count} vendas`, formatMoney(s.total)])} empty="Nenhuma venda no período." />
            </Block>
            <Block title="Recebido por forma">
              <Rows rows={r.received.byMethod.map((m) => [m.name, formatMoney(m.amount)])} empty="Nada recebido no período." />
            </Block>
            <Block title="Perdas por motivo">
              <Rows rows={r.losses.byReason.map((l) => [l.reason, formatMoney(l.amount)])} empty="Nenhuma perda no período." />
            </Block>
            <Block title="Despesas pagas por categoria">
              <Rows rows={r.payables.byCategory.map((c) => [PAYABLE_CATEGORIES[c.category].split(' (')[0]!, formatMoney(c.amount)])} empty="Nenhuma despesa paga no período." />
            </Block>
          </div>
          <p className="text-xs text-ink-soft">{r.sales.canceled} vendas canceladas no período.</p>
        </div>
      )}
    </div>
  );
}

function Block({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="card p-5">
      <h2 className="mb-3 text-sm font-semibold">{title}</h2>
      {children}
    </section>
  );
}

function Rows({ rows, empty }: { rows: Array<[string, string]>; empty: string }) {
  if (!rows.length) return <p className="text-sm text-ink-soft">{empty}</p>;
  return (
    <dl className="text-sm tabular-nums">
      {rows.map(([k, v]) => (
        <div key={k} className="flex justify-between gap-4 border-b border-slate-100 py-1.5 last:border-0">
          <dt className="text-ink-soft">{k}</dt>
          <dd>{v}</dd>
        </div>
      ))}
    </dl>
  );
}
