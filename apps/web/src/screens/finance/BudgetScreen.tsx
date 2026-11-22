import { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { formatMoney, todayBR, type BudgetReport } from '@mercearia/contracts';
import { api, can } from '../../lib/api';
import { ErrorBox, Field, Loading, PageHeader } from '../../components/ui';
import { pct } from '../../components/format';

const paraNumero = (v: string) => Number(v.replace(/\./g, '').replace(',', '.')) || 0;

/** Orçamento do mês: quanto se esperava em cada linha do DRE e quanto veio de fato. */
export function BudgetScreen() {
  const qc = useQueryClient();
  const [mes, setMes] = useState(todayBR().slice(0, 7));
  const q = useQuery({ queryKey: ['orcamento', mes], queryFn: () => api<BudgetReport>(`/budget?month=${mes}`) });
  const [valores, setValores] = useState<Record<string, string>>({});
  const [copiar, setCopiar] = useState(false);
  const gestao = can('finance.manage');
  useEffect(() => {
    if (q.data) setValores(Object.fromEntries(q.data.rows.map((r) => [r.key, r.budget ? String(r.budget).replace('.', ',') : ''])));
  }, [q.data]);
  const salvar = useMutation({
    mutationFn: () => api('/budget', { method: 'PUT', json: { month: mes, copyToYearEnd: copiar, items: (q.data?.rows ?? []).map((r) => ({ key: r.key, amount: paraNumero(valores[r.key] ?? '') })) } }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['orcamento'] }),
  });
  const rows = q.data?.rows ?? [];
  const mudou = rows.some((r) => paraNumero(valores[r.key] ?? '') !== r.budget);
  const orcadoTotal = rows.reduce((s, r) => s + r.sign * paraNumero(valores[r.key] ?? ''), 0);
  let grupo = '';
  return (
    <div className="max-w-5xl space-y-4">
      <PageHeader title="Orçamento" subtitle="Defina quanto espera vender e gastar em cada linha do DRE no mês. O realizado vem do DRE por competência; a cor mostra o que passou do combinado." />
      <ErrorBox error={q.error ?? salvar.error} />
      <div className="card flex flex-wrap items-end gap-3 p-4">
        <Field label="Mês"><input type="month" className="input w-44" value={mes} onChange={(e) => e.target.value && setMes(e.target.value)} /></Field>
        <span className="flex-1" />
        {gestao && (
          <>
            <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={copiar} onChange={(e) => setCopiar(e.target.checked)} /> Repetir até dezembro</label>
            <button className="btn-primary" disabled={salvar.isPending || (!mudou && !copiar)} onClick={() => salvar.mutate()}>Salvar orçamento</button>
          </>
        )}
      </div>
      {q.isLoading ? <Loading /> : (
        <div className="card overflow-x-auto">
          <table className="table">
            <thead><tr><th>Linha</th><th className="text-right">Orçado</th><th className="text-right">Realizado</th><th className="text-right">Diferença</th><th className="text-right">% do orçado</th></tr></thead>
            <tbody>
              {rows.map((r) => {
                const cab = r.group !== grupo ? (grupo = r.group) : null;
                const o = paraNumero(valores[r.key] ?? '');
                const dif = r.actual - o;
                // Receita abaixo ou despesa acima do orçado é ruim.
                const ruim = o > 0 && (r.sign > 0 ? dif < -0.005 : dif > 0.005);
                return [
                  cab && <tr key={`g_${cab}`} className="bg-cream/60"><td colSpan={5} className="font-medium text-ink">{cab}</td></tr>,
                  <tr key={r.key}>
                    <td className="pl-6">{r.code && <span className="mr-2 text-xs text-ink-soft tabular-nums">{r.code}</span>}{r.label}</td>
                    <td className="text-right">{gestao ? <input className="input w-32 text-right tabular-nums" inputMode="decimal" placeholder="0,00" value={valores[r.key] ?? ''} onChange={(e) => setValores({ ...valores, [r.key]: e.target.value })} /> : formatMoney(r.budget)}</td>
                    <td className="text-right tabular-nums">{formatMoney(r.actual)}</td>
                    <td className={`text-right tabular-nums ${o ? (ruim ? 'text-red-700' : 'text-emerald-700') : 'text-ink-soft'}`}>{o ? formatMoney(dif) : '—'}</td>
                    <td className={`text-right tabular-nums ${ruim ? 'font-medium text-red-700' : ''}`}>{o ? pct((r.actual / o) * 100) : '—'}</td>
                  </tr>,
                ];
              })}
              <tr className="border-t-2 border-slate-300 font-medium">
                <td>Resultado</td>
                <td className="text-right tabular-nums">{formatMoney(orcadoTotal)}</td>
                <td className="text-right tabular-nums">{formatMoney(q.data?.resultActual ?? 0)}</td>
                <td className={`text-right tabular-nums ${(q.data?.resultActual ?? 0) - orcadoTotal < 0 ? 'text-red-700' : 'text-emerald-700'}`}>{formatMoney((q.data?.resultActual ?? 0) - orcadoTotal)}</td>
                <td />
              </tr>
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
