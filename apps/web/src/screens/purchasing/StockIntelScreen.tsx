import { useEffect, useMemo, useState } from 'react';
import { useMutation, useQuery } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import { STOCK_STATUS, type PurchaseOrder, type StockIntel, type StockIntelRow, type StockStatus, type Store } from '@mercearia/contracts';
import { api, can, session } from '../../lib/api';
import { Empty, ErrorBox, Loading, PageHeader } from '../../components/ui';
import { formatMoney, formatQty } from '../../components/format';

const TONE: Record<StockStatus, string> = {
  ruptura: 'bg-red-100 text-red-700',
  comprar: 'bg-orange-100 text-orange-800',
  atencao: 'bg-amber-100 text-amber-800',
  ok: 'bg-brand-soft text-brand',
  excesso: 'bg-sky-100 text-sky-800',
  parado: 'bg-slate-200 text-ink',
  sem_giro: 'bg-slate-100 text-ink-soft',
};

/**
 * Inteligência de estoque: o que falta, o que comprar (e quanto), o que está
 * parado e o que vai vencer antes de vender. A compra sugerida vira pedido
 * para o fornecedor com um clique.
 */
export function StockIntelScreen() {
  const navigate = useNavigate();
  const stores = useQuery({ queryKey: ['stores'], queryFn: () => api<Store[]>('/stores') });
  const mine = (stores.data ?? []).filter((s) => s.active && (!session.user()?.storeIds.length || session.user()!.storeIds.includes(s.id)));
  const [storeId, setStoreId] = useState(() => localStorage.getItem('mercearia.pdv.store') ?? '');
  useEffect(() => {
    if (mine.length && !mine.some((s) => s.id === storeId)) setStoreId(mine[0]!.id);
  }, [mine, storeId]);
  const [days, setDays] = useState(60);
  const [cover, setCover] = useState(21);
  const [filter, setFilter] = useState<StockStatus | 'comprar_tudo' | 'vencer' | 'todos'>('comprar_tudo');
  const [abc, setAbc] = useState<'' | 'A' | 'B' | 'C'>('');
  const [q, setQ] = useState('');
  const data = useQuery({ queryKey: ['stock-intel', storeId, days, cover], queryFn: () => api<StockIntel>(`/stock/intelligence?storeId=${storeId}&days=${days}&coverTarget=${cover}`), enabled: Boolean(storeId) });

  const rows = useMemo(() => {
    const list = data.data?.rows ?? [];
    const text = q.trim().toLowerCase();
    return list.filter((r) => {
      if (filter === 'comprar_tudo' && r.suggested <= 0) return false;
      if (filter === 'vencer' && !r.expiryRisk) return false;
      if (filter !== 'todos' && filter !== 'comprar_tudo' && filter !== 'vencer' && r.status !== filter) return false;
      if (filter === 'todos' && r.status === 'sem_giro') return false;
      if (abc && r.abc !== abc) return false;
      return !text || r.name.toLowerCase().includes(text) || (r.supplierName ?? '').toLowerCase().includes(text);
    });
  }, [data.data, filter, abc, q]);

  const bySupplier = useMemo(() => {
    const map = new Map<string, { supplierId: string | null; supplierName: string; rows: StockIntelRow[]; total: number }>();
    for (const r of data.data?.rows ?? []) {
      if (r.suggested <= 0) continue;
      const key = r.supplierId ?? 'sem';
      const g = map.get(key) ?? { supplierId: r.supplierId, supplierName: r.supplierName ?? 'Sem fornecedor', rows: [], total: 0 };
      g.rows.push(r);
      g.total += r.suggestedCost;
      map.set(key, g);
    }
    return [...map.values()].sort((a, b) => b.total - a.total);
  }, [data.data]);

  const createOrder = useMutation({
    mutationFn: (g: { supplierId: string; rows: StockIntelRow[] }) =>
      api<PurchaseOrder>('/purchase-orders', { method: 'POST', json: { storeId, supplierId: g.supplierId, items: g.rows.map((r) => ({ productId: r.productId, quantity: r.suggested, unitCost: r.suggestedCost / r.suggested })) } }),
    onSuccess: (o) => navigate(`/compras?pedido=${o.id}`),
  });

  if (stores.isLoading) return <Loading />;
  const t = data.data?.totals;
  const chips: Array<[typeof filter, string]> = [
    ['comprar_tudo', 'Para comprar'],
    ['ruptura', STOCK_STATUS.ruptura],
    ['parado', STOCK_STATUS.parado],
    ['vencer', 'Vai vencer'],
    ['excesso', STOCK_STATUS.excesso],
    ['todos', 'Todos'],
  ];

  return (
    <div className="max-w-7xl space-y-4">
      <PageHeader
        title="Inteligência de estoque"
        subtitle="Pelo ritmo de saída (venda + consumo do preparo). A compra sugerida cobre o prazo do fornecedor, a folga escolhida e o estoque mínimo."
        action={
          <div className="flex flex-wrap gap-2">
            {mine.length > 1 && (
              <select className="input w-auto" value={storeId} onChange={(e) => setStoreId(e.target.value)} aria-label="Loja">
                {mine.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name}
                  </option>
                ))}
              </select>
            )}
            <select className="input w-auto" value={days} onChange={(e) => setDays(Number(e.target.value))} aria-label="Período">
              {[30, 60, 90, 180].map((d) => (
                <option key={d} value={d}>
                  Ritmo dos últimos {d} dias
                </option>
              ))}
            </select>
            <select className="input w-auto" value={cover} onChange={(e) => setCover(Number(e.target.value))} aria-label="Folga">
              {[7, 14, 21, 30, 45].map((d) => (
                <option key={d} value={d}>
                  Comprar para {d} dias
                </option>
              ))}
            </select>
          </div>
        }
      />
      <ErrorBox error={data.error ?? createOrder.error} />
      {t && (
        <div className="grid grid-cols-2 gap-3 md:grid-cols-5">
          <Kpi label="Valor em estoque" value={formatMoney(t.stockValue)} />
          <Kpi label="Dinheiro parado" value={formatMoney(t.idleValue)} tone={t.idleValue > 0 ? 'text-ink' : undefined} hint="sem saída no período" />
          <Kpi label="Em falta" value={String(t.missing)} tone={t.missing ? 'text-red-600' : undefined} />
          <Kpi label="Compra sugerida" value={formatMoney(t.suggestedCost)} hint={`${t.toBuy} produtos`} />
          <Kpi label="Risco de vencer" value={formatMoney(t.expiryRiskValue)} tone={t.expiryRiskValue ? 'text-amber-700' : undefined} hint="no ritmo atual" />
        </div>
      )}

      {can('purchase.manage') && bySupplier.length > 0 && (
        <section className="card p-4">
          <h2 className="mb-2 font-semibold">Compra sugerida por fornecedor</h2>
          <div className="grid gap-2 md:grid-cols-2 lg:grid-cols-3">
            {bySupplier.map((g) => (
              <div key={g.supplierId ?? 'sem'} className="flex items-center justify-between gap-3 rounded-lg border border-slate-200 p-3">
                <div>
                  <p className="font-medium">{g.supplierName}</p>
                  <p className="text-xs text-ink-soft">
                    {g.rows.length} produto{g.rows.length > 1 ? 's' : ''} · {formatMoney(g.total)}
                  </p>
                </div>
                {g.supplierId ? (
                  <button className="btn-primary px-3 py-1.5" disabled={createOrder.isPending} onClick={() => createOrder.mutate({ supplierId: g.supplierId!, rows: g.rows })}>
                    Criar pedido
                  </button>
                ) : (
                  <span className="text-xs text-ink-soft">Defina o fornecedor no produto</span>
                )}
              </div>
            ))}
          </div>
        </section>
      )}

      <section className="card overflow-x-auto">
        <div className="flex flex-wrap items-center gap-2 border-b border-slate-100 p-3">
          {chips.map(([k, label]) => (
            <button key={k} onClick={() => setFilter(k)} className={`rounded-full border px-3 py-1 text-sm ${filter === k ? 'border-brand bg-brand text-white' : 'border-slate-300'}`}>
              {label}
            </button>
          ))}
          <select className="input ml-auto w-auto" value={abc} onChange={(e) => setAbc(e.target.value as typeof abc)} aria-label="Curva ABC">
            <option value="">Curva A, B e C</option>
            <option value="A">Só A (80% do faturamento)</option>
            <option value="B">Só B</option>
            <option value="C">Só C</option>
          </select>
          <input className="input w-56" placeholder="Produto ou fornecedor" value={q} onChange={(e) => setQ(e.target.value)} />
        </div>
        {data.isLoading ? (
          <Loading />
        ) : !rows.length ? (
          <Empty>Nada nesta lista.</Empty>
        ) : (
          <table className="table">
            <thead>
              <tr>
                <th>Produto</th>
                <th className="text-center">ABC</th>
                <th className="text-right">Estoque</th>
                <th className="text-right">Saída/dia</th>
                <th className="text-right">Dura</th>
                <th className="text-right">Giro/ano</th>
                <th>Situação</th>
                <th className="text-right">Comprar</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.productId}>
                  <td>
                    <p className="font-medium">{r.name}</p>
                    <p className="text-xs text-ink-soft">
                      {r.supplierName ?? 'sem fornecedor'} · prazo {r.leadTimeDays} d{r.categoryName ? ` · ${r.categoryName}` : ''}
                    </p>
                    {r.expiryRisk && (
                      <p className="text-xs text-amber-700">
                        {formatQty(r.expiryRisk.quantity, r.unit)} ({formatMoney(r.expiryRisk.value)}) devem vencer até {r.expiryRisk.firstDate.split('-').reverse().join('/')}: ponha em oferta
                      </p>
                    )}
                  </td>
                  <td className="text-center font-semibold">{r.abc}</td>
                  <td className="text-right tabular-nums">
                    {formatQty(r.stock, r.unit)}
                    {r.onOrder > 0 && <p className="text-xs text-sky-700">+{formatQty(r.onOrder, r.unit)} pedido</p>}
                  </td>
                  <td className="text-right tabular-nums">{r.dailyUse ? r.dailyUse.toLocaleString('pt-BR', { maximumFractionDigits: 2 }) : '—'}</td>
                  <td className="text-right tabular-nums">{r.coverDays == null ? '—' : `${Math.round(r.coverDays)} d`}</td>
                  <td className="text-right tabular-nums">{r.turnover ?? '—'}</td>
                  <td>
                    <span className={`badge ${TONE[r.status]}`}>{STOCK_STATUS[r.status]}</span>
                    {r.status === 'parado' && r.daysSinceLastOut != null && <p className="text-xs text-ink-soft">última saída há {r.daysSinceLastOut} d</p>}
                  </td>
                  <td className="text-right tabular-nums">
                    {r.suggested > 0 ? (
                      <>
                        <b>{formatQty(r.suggested, r.unit)}</b>
                        <p className="text-xs text-ink-soft">{formatMoney(r.suggestedCost)}</p>
                      </>
                    ) : (
                      '—'
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>
    </div>
  );
}

function Kpi({ label, value, hint, tone }: { label: string; value: string; hint?: string; tone?: string }) {
  return (
    <div className="card p-4">
      <p className="text-xs text-ink-soft">{label}</p>
      <p className={`mt-1 text-xl font-semibold tabular-nums ${tone ?? ''}`}>{value}</p>
      {hint && <p className="text-xs text-ink-soft">{hint}</p>}
    </div>
  );
}
