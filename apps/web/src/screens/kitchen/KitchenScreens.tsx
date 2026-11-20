import { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { addDays, todayBR, type CountScope, type CountSheetLine, type ExpiringLot, type InventoryCount, type InventoryCountRow, type LossReport, type Store } from '@mercearia/contracts';
import { api, can, session } from '../../lib/api';
import { Empty, ErrorBox, Field, Loading, PageHeader } from '../../components/ui';
import { formatDateTime, formatDay, formatMoney, formatQty, pct } from '../../components/format';

function useMyStore() {
  const stores = useQuery({ queryKey: ['stores'], queryFn: () => api<Store[]>('/stores') });
  const mine = (stores.data ?? []).filter((s) => s.active && (!session.user()?.storeIds.length || session.user()!.storeIds.includes(s.id)));
  const [storeId, setStoreId] = useState('');
  useEffect(() => {
    if (!storeId && mine.length) setStoreId(mine[0]!.id);
  }, [mine, storeId]);
  return { stores: mine, storeId, setStoreId };
}

/** Lotes vencendo: o que vira promoção antes de virar perda. */
export function ExpiringScreen() {
  const [days, setDays] = useState('30');
  const lots = useQuery({ queryKey: ['expiring', days], queryFn: () => api<ExpiringLot[]>(`/products/expiring?days=${days}`) });
  const total = (lots.data ?? []).reduce((s, l) => s + l.value, 0);
  return (
    <div className="max-w-5xl">
      <PageHeader title="Validades" subtitle="Lotes que vencem logo (e os já vencidos com saldo). Ponha em promoção ou lance a perda." />
      <div className="mb-4 flex items-end gap-3">
        <Field label="Vencendo nos próximos">
          <select className="input w-auto" value={days} onChange={(e) => setDays(e.target.value)}>
            {['7', '15', '30', '60', '90'].map((d) => (
              <option key={d} value={d}>
                {d} dias
              </option>
            ))}
          </select>
        </Field>
        <p className="pb-2 text-sm text-ink-soft">Valor a custo: {formatMoney(total)}</p>
      </div>
      <ErrorBox error={lots.error} />
      <div className="card overflow-x-auto">
        {lots.isLoading ? (
          <Loading />
        ) : !lots.data?.length ? (
          <Empty>Nada vencendo nesse prazo. 🎉</Empty>
        ) : (
          <table className="table">
            <thead>
              <tr>
                <th>Produto</th>
                <th>Lote</th>
                <th>Validade</th>
                <th className="text-right">Qtd.</th>
                <th className="text-right">Valor</th>
              </tr>
            </thead>
            <tbody>
              {lots.data.map((l) => (
                <tr key={l.id}>
                  <td className="font-medium">{l.productName}</td>
                  <td>{l.code}</td>
                  <td className={l.daysLeft <= 7 ? 'font-medium text-red-600' : l.daysLeft <= 15 ? 'text-amber-700' : ''}>
                    {formatDay(l.expiresAt)} · {l.daysLeft < 0 ? 'vencido' : l.daysLeft === 0 ? 'vence hoje' : `${l.daysLeft} dias`}
                  </td>
                  <td className="text-right tabular-nums">{formatQty(l.quantity, l.unit)}</td>
                  <td className="text-right tabular-nums">{formatMoney(l.value)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}

/** Contagem do fim do dia dos insumos abertos (ou inventário geral). */
export function CountScreen() {
  const client = useQueryClient();
  const { stores, storeId, setStoreId } = useMyStore();
  const [scope, setScope] = useState<CountScope>('insumos');
  const [counted, setCounted] = useState<Record<string, string>>({});
  const [saved, setSaved] = useState<InventoryCount | null>(null);
  const sheet = useQuery({ queryKey: ['count-sheet', storeId, scope], queryFn: () => api<CountSheetLine[]>(`/kitchen/count-sheet?storeId=${storeId}&scope=${scope}`), enabled: Boolean(storeId) });
  const history = useQuery({ queryKey: ['counts'], queryFn: () => api<InventoryCountRow[]>('/kitchen/counts'), enabled: can('stock.view') });
  useEffect(() => setCounted({}), [storeId, scope]);
  const lines = Object.entries(counted).filter(([, v]) => v.trim() !== '');
  const save = useMutation({
    mutationFn: () => api<InventoryCount>('/kitchen/counts', { method: 'POST', json: { storeId, scope, lines: lines.map(([productId, v]) => ({ productId, counted: v })) } }),
    onSuccess: (c) => {
      setSaved(c);
      setCounted({});
      client.invalidateQueries({ queryKey: ['count-sheet'] });
      client.invalidateQueries({ queryKey: ['counts'] });
      client.invalidateQueries({ queryKey: ['products'] });
    },
  });
  return (
    <div className="max-w-5xl space-y-4">
      <PageHeader title="Contagem de insumos" subtitle="No fim do dia, conte o que sobrou de cada insumo aberto. A diferença para o que o sistema esperava (pelas vendas de shakes e sorvetes) é a perda." />
      <div className="flex flex-wrap items-end gap-3">
        {stores.length > 1 && (
          <Field label="Loja">
            <select className="input w-auto" value={storeId} onChange={(e) => setStoreId(e.target.value)}>
              {stores.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </select>
          </Field>
        )}
        <Field label="O que contar">
          <select className="input w-auto" value={scope} onChange={(e) => setScope(e.target.value as CountScope)}>
            <option value="insumos">Insumos do preparo</option>
            <option value="geral">Inventário geral (tudo)</option>
          </select>
        </Field>
      </div>
      {saved && (
        <div className="card border-brand bg-brand-soft p-4 text-sm">
          Contagem gravada: {saved.lines.length} itens · diferença {formatMoney(saved.diffValue)}
          {saved.lines.filter((l) => l.diff !== 0).map((l) => (
            <div key={l.productId} className={l.diff < 0 ? 'text-red-700' : ''}>
              {l.name}: sistema {formatQty(l.system)}, contado {formatQty(l.counted)} ({l.diff > 0 ? '+' : ''}
              {formatQty(l.diff, l.unit)} · {formatMoney(l.value)})
            </div>
          ))}
        </div>
      )}
      <div className="card overflow-x-auto">
        {sheet.isLoading ? (
          <Loading />
        ) : !sheet.data?.length ? (
          <Empty>Nenhum insumo cadastrado. Cadastre os insumos (tipo "Insumo") e as fichas técnicas dos preparados.</Empty>
        ) : (
          <table className="table">
            <thead>
              <tr>
                <th>Item</th>
                <th className="text-right">Sistema</th>
                <th className="w-40 text-right">Contado</th>
                <th className="text-right">Diferença</th>
              </tr>
            </thead>
            <tbody>
              {sheet.data.map((l) => {
                const raw = counted[l.productId] ?? '';
                const n = Number(raw.replace(/\./g, '').replace(',', '.'));
                const diff = raw.trim() !== '' && Number.isFinite(n) ? Math.round((n - l.system) * 1000) / 1000 : null;
                return (
                  <tr key={l.productId}>
                    <td>
                      {l.name} <span className="text-xs text-ink-soft">{l.categoryName}</span>
                    </td>
                    <td className="text-right tabular-nums text-ink-soft">{formatQty(l.system, l.unit)}</td>
                    <td className="text-right">
                      <input className="input text-right" inputMode="decimal" value={raw} onChange={(e) => setCounted((c) => ({ ...c, [l.productId]: e.target.value }))} aria-label={`Contado de ${l.name}`} />
                    </td>
                    <td className={`text-right tabular-nums ${diff != null && diff < 0 ? 'text-red-600' : ''}`}>
                      {diff == null ? '—' : `${diff > 0 ? '+' : ''}${formatQty(diff)} · ${formatMoney(Math.round(diff * l.unitCost * 100) / 100)}`}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>
      <ErrorBox error={save.error} />
      <div className="flex justify-end">
        <button className="btn-primary" disabled={!lines.length || save.isPending} onClick={() => save.mutate()}>
          Gravar contagem ({lines.length} {lines.length === 1 ? 'item' : 'itens'})
        </button>
      </div>
      {history.data && history.data.length > 0 && (
        <div className="card overflow-x-auto">
          <table className="table">
            <thead>
              <tr>
                <th>Quando</th>
                <th>Quem</th>
                <th>Tipo</th>
                <th className="text-right">Itens</th>
                <th className="text-right">Diferença</th>
              </tr>
            </thead>
            <tbody>
              {history.data.map((c) => (
                <tr key={c.id}>
                  <td>{formatDateTime(c.createdAt)}</td>
                  <td>{c.userName}</td>
                  <td>{c.scope === 'insumos' ? 'Insumos' : 'Geral'}</td>
                  <td className="text-right">{c.items}</td>
                  <td className={`text-right tabular-nums ${c.diffValue < 0 ? 'text-red-600' : ''}`}>{formatMoney(c.diffValue)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

/** Perdas do período e margem de cada preparado pela ficha técnica. */
export function LossesScreen() {
  const [from, setFrom] = useState(addDays(todayBR(), -29));
  const [to, setTo] = useState(todayBR());
  const r = useQuery({ queryKey: ['losses', from, to], queryFn: () => api<LossReport>(`/kitchen/losses?from=${from}&to=${to}`) });
  return (
    <div className="max-w-6xl space-y-4">
      <PageHeader title="Perdas e fichas técnicas" subtitle="Quanto as vendas deveriam ter gastado de cada insumo, quanto se perdeu e a margem de cada shake e sorvete." />
      <div className="flex flex-wrap items-end gap-2">
        <Field label="De">
          <input type="date" className="input" value={from} onChange={(e) => setFrom(e.target.value)} />
        </Field>
        <Field label="Até">
          <input type="date" className="input" value={to} onChange={(e) => setTo(e.target.value)} />
        </Field>
      </div>
      <ErrorBox error={r.error} />
      {r.isLoading || !r.data ? (
        <Loading />
      ) : (
        <>
          <div className="grid gap-3 sm:grid-cols-3">
            <Kpi label="Perdas no período (a custo)" value={formatMoney(r.data.totalValue)} tone={r.data.totalValue > 0 ? 'text-red-600' : ''} />
            <Kpi label="Perda dos insumos" value={pct(r.data.insumoLossPct)} hint="perda ÷ (uso previsto + perda)" />
            <Kpi label="Maior motivo" value={r.data.byReason[0] ? `${r.data.byReason[0].label} · ${formatMoney(r.data.byReason[0].value)}` : '—'} />
          </div>
          <div className="card overflow-x-auto">
            <h2 className="px-3 pt-3 font-medium">Onde está a perda</h2>
            {!r.data.byProduct.length ? (
              <Empty>Sem perdas nem consumo de insumos no período.</Empty>
            ) : (
              <table className="table">
                <thead>
                  <tr>
                    <th>Item</th>
                    <th className="text-right">Uso previsto (fichas)</th>
                    <th className="text-right">Perda lançada</th>
                    <th className="text-right">Faltou na contagem</th>
                    <th className="text-right">% sobre o uso</th>
                    <th className="text-right">Valor</th>
                  </tr>
                </thead>
                <tbody>
                  {r.data.byProduct.map((l) => (
                    <tr key={l.productId}>
                      <td className="font-medium">{l.name}</td>
                      <td className="text-right tabular-nums">{formatQty(l.expectedUse, l.unit)}</td>
                      <td className="text-right tabular-nums">{formatQty(l.lossQty)}</td>
                      <td className="text-right tabular-nums">{formatQty(l.countMissing)}</td>
                      <td className={`text-right tabular-nums ${l.pct != null && l.pct > 5 ? 'font-medium text-red-600' : ''}`}>{l.pct == null ? '—' : pct(l.pct)}</td>
                      <td className="text-right tabular-nums">{formatMoney(l.value)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
          <div className="card overflow-x-auto">
            <h2 className="px-3 pt-3 font-medium">Margem dos preparados</h2>
            {!r.data.recipes.length ? (
              <Empty>Nenhum preparado cadastrado.</Empty>
            ) : (
              <table className="table">
                <thead>
                  <tr>
                    <th>Preparado</th>
                    <th className="text-right">Custo (ficha)</th>
                    <th className="text-right">Preço</th>
                    <th className="text-right">Margem</th>
                    <th className="text-right">Preço membro</th>
                    <th className="text-right">Margem membro</th>
                    <th className="text-right">Vendidos</th>
                  </tr>
                </thead>
                <tbody>
                  {r.data.recipes.map((x) => (
                    <tr key={x.productId}>
                      <td className="font-medium">{x.name}</td>
                      <td className="text-right tabular-nums">{formatMoney(x.cost)}</td>
                      <td className="text-right tabular-nums">{formatMoney(x.price)}</td>
                      <td className={`text-right tabular-nums ${x.margin < 50 ? 'text-amber-700' : ''}`}>{pct(x.margin)}</td>
                      <td className="text-right tabular-nums">{x.memberPrice ? formatMoney(x.memberPrice) : '—'}</td>
                      <td className="text-right tabular-nums">{x.memberMargin == null ? '—' : pct(x.memberMargin)}</td>
                      <td className="text-right tabular-nums">{formatQty(x.sold)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </>
      )}
    </div>
  );
}

export function Kpi({ label, value, hint, tone = '' }: { label: string; value: string; hint?: string; tone?: string }) {
  return (
    <div className="card p-4">
      <p className="text-xs text-ink-soft">{label}</p>
      <p className={`mt-1 text-2xl font-semibold tabular-nums ${tone}`}>{value}</p>
      {hint && <p className="text-xs text-ink-soft">{hint}</p>}
    </div>
  );
}
